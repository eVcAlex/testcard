import type Database from "better-sqlite3";
import type { XtreamCredentials } from "../source/xtream/detect.js";
import { generateSalt } from "./credentialCrypto.js";
import { SyncClient } from "./client.js";
import { removeSourceRows } from "./sourceRemoval.js";
import { applySourceContent } from "./sourceContent.js";
import { applySourcePosition } from "./sourceOrder.js";
import { applyRemoteChanges, clearTombstones, collectLocalChanges, getSyncState, setSyncState } from "./localChanges.js";

export type SyncAccountStatus = "signed-out" | "signed-in" | "needs-password";

export interface SyncStatus {
  readonly account: SyncAccountStatus;
  readonly email?: string;
  readonly lastSyncedAt?: number;
  /** When a sync last brought in anything new from the account. Screens re-read their data on this, not on every sync. */
  readonly lastChangedAt?: number;
  readonly lastError?: string;
}

/**
 * Everything the sync loop needs from the host it runs in (Electron's safeStorage on desktop, the
 * Android keystore on the phone and Fire TV app). Keeps this file free of any platform import.
 */
export interface SyncPlatform {
  readonly baseUrl: string;
  getCredentials(sourceId: string): Promise<XtreamCredentials>;
  saveCredentials(sourceId: string, credentials: XtreamCredentials): Promise<void>;
  /** Forgets a source's stored login, when the source is removed here because another device removed it. */
  deleteCredentials?(sourceId: string): Promise<void>;
  /** Synchronous: the controller reads it in its constructor to resume a session after a relaunch. */
  loadAccountPassword(): string | undefined;
  saveAccountPassword(password: string): void;
  clearAccountPassword(): void;
  randomId(): string;
}

const PERIODIC_INTERVAL_MS = 60 * 1000;
// Local edits (favourites, progress, sources...) sync shortly after they happen, but never more
// often than this - playback progress is written every few seconds while watching.
const CHANGE_SYNC_DELAY_MS = 3000;
const CHANGE_SYNC_MIN_GAP_MS = 15_000;

/** The server's own message from a JSON error body ({"message": ...} / {"error": ...}), if it sent one. */
function serverMessage(error: unknown): string | undefined {
  const text = error instanceof Error ? error.message : undefined;
  if (text === undefined) return undefined;
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (typeof body.message === "string") return body.message;
    if (typeof body.error === "string") return body.error;
  } catch {
    /* not JSON */
  }
  return undefined;
}

/** Sign-in / sign-up failures, in words a person can act on. Thrown to the renderer as the Error message. */
function authFailure(error: unknown, action: "signIn" | "signUp"): Error {
  const status = (error as { status?: number } | null)?.status;
  if (status === undefined) return new Error("Can't reach the sync server. Check your connection and try again.");
  const detail = serverMessage(error);
  if (action === "signIn" && (status === 401 || status === 400)) return new Error("That email and password don't match an account.");
  if (action === "signUp" && (status === 422 || status === 409)) return new Error("An account with that email already exists. Sign in instead.");
  if (status >= 500) return new Error("The sync server had a problem. Try again in a moment.");
  return new Error(detail ?? "That didn't work. Check your details and try again.");
}

/** Turns a transport/HTTP error into something a person can act on (never raw JSON). */
function describeSyncError(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  if (status === 401) return "Sync isn't authorised. Sign in again.";
  if (status !== undefined && status >= 500) return "The sync server had a problem. It will retry shortly.";
  if (status === undefined) return "Can't reach the sync server. It will retry shortly.";
  return error instanceof Error && error.message !== "" ? error.message : "Sync failed.";
}

/**
 * Owns the account password, used to derive the credential-encryption key (Task 7's
 * `credentialCrypto.ts`). The password is kept in memory and also stored encrypted with the OS
 * keystore (accountSecret.ts) so a relaunch resumes syncing without a new sign-in. The session
 * token, account email and PBKDF2 salt live in `sync_state`. The salt isn't secret (see Task 9's
 * `/sync/salt`) - it's what lets a *second* device derive the same key the first one used.
 */
export class SyncController {
  private client: SyncClient;
  private accountPassword: string | undefined;
  private salt: string | undefined;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private lastError: string | undefined;
  // Wall-clock time of the last successful sync run. Not `sync_state.last_pulled_at`: that's the
  // newest *data* timestamp pulled, so it stays put whenever there's nothing new to pull.
  private lastSyncedAt: number | undefined;
  private lastChangedAt: number | undefined;
  private running: Promise<void> | undefined;
  private rerunRequested = false;
  private changeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRunStartedAt = 0;

  constructor(
    private readonly db: Database.Database,
    private readonly platform: SyncPlatform,
    /** Called with the ids of sources that arrived from another device, so they can be refreshed (imported) right away. */
    private readonly onSourcesAdded: (sourceIds: readonly string[]) => void = () => undefined,
  ) {
    this.client = new SyncClient({ baseUrl: platform.baseUrl, getSessionToken: () => this.sessionToken() });
    const row = this.db.prepare(`SELECT sync_salt, account_email FROM sync_state WHERE id = 1`).get() as
      | { sync_salt: string | null; account_email: string | null }
      | undefined;
    this.salt = row?.sync_salt ?? undefined;
    if (row?.account_email) {
      // Resume the previous session: no re-login needed after a relaunch.
      this.accountPassword = this.platform.loadAccountPassword();
      if (this.accountPassword !== undefined && this.salt !== undefined) {
        this.startPeriodicSync();
        void this.runOnce();
      }
    }
  }

  /** Call after any local change to synced data. Coalesced: one sync shortly after, rate-limited. */
  notifyLocalChange(): void {
    if (this.accountPassword === undefined || this.changeTimer !== undefined) return;
    const wait = Math.max(CHANGE_SYNC_DELAY_MS, this.lastRunStartedAt + CHANGE_SYNC_MIN_GAP_MS - Date.now());
    this.changeTimer = setTimeout(() => {
      this.changeTimer = undefined;
      void this.runOnce();
    }, wait);
  }

  private sessionToken(): string | undefined {
    const row = this.db.prepare(`SELECT session_token FROM sync_state WHERE id = 1`).get() as { session_token: string | null } | undefined;
    return row?.session_token ?? undefined;
  }

  status(): SyncStatus {
    const row = this.db.prepare(`SELECT account_email FROM sync_state WHERE id = 1`).get() as { account_email: string | null } | undefined;
    if (!row || row.account_email === null) return { account: "signed-out", ...(this.lastError !== undefined ? { lastError: this.lastError } : {}) };
    if (this.accountPassword === undefined) {
      return { account: "needs-password", email: row.account_email, ...(this.lastError !== undefined ? { lastError: this.lastError } : {}) };
    }
    return {
      account: "signed-in",
      email: row.account_email,
      ...(this.lastSyncedAt !== undefined ? { lastSyncedAt: this.lastSyncedAt } : {}),
      ...(this.lastChangedAt !== undefined ? { lastChangedAt: this.lastChangedAt } : {}),
      ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
    };
  }

  async signUp(email: string, password: string): Promise<SyncStatus> {
    const result = await this.client.signUp(email, password).catch((error: unknown) => {
      throw authFailure(error, "signUp");
    });
    // Persist the token before any authenticated call: getSessionToken() (passed to SyncClient
    // above) reads it back out of sync_state, so setSalt below would otherwise go out with no
    // Bearer token and 401.
    this.persistToken(email, result.sessionToken);
    const salt = generateSalt();
    await this.client.setSalt(salt); // set-once; safe even if a retry races, see handleSetSalt's ON CONFLICT DO NOTHING
    this.finaliseSession(password, salt);
    this.startPeriodicSync();
    await this.runOnce();
    return this.status();
  }

  async signIn(email: string, password: string): Promise<SyncStatus> {
    const result = await this.client.signIn(email, password).catch((error: unknown) => {
      throw authFailure(error, "signIn");
    });
    this.persistToken(email, result.sessionToken); // see signUp's comment — getSalt/setSalt below need it in the DB first
    let salt = await this.client.getSalt();
    if (salt === undefined) {
      // Defensive fallback only: every account should have set one during signUp. Recovering
      // here means a first-ever sync still works even if that step was somehow interrupted.
      salt = generateSalt();
      await this.client.setSalt(salt);
    }
    this.finaliseSession(password, salt);
    this.startPeriodicSync();
    await this.runOnce();
    return this.status();
  }

  async signOut(): Promise<SyncStatus> {
    await this.client.signOut().catch(() => undefined); // best-effort — sign the device out locally regardless
    this.lastError = undefined;
    this.forgetSession();
    return this.status();
  }

  /** Drops the local session (token, password, salt, cursors) without telling the server. */
  private forgetSession(): void {
    this.accountPassword = undefined;
    this.salt = undefined;
    this.lastSyncedAt = undefined;
    this.lastChangedAt = undefined;
    this.platform.clearAccountPassword();
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = undefined;
    this.db
      .prepare(`UPDATE sync_state SET account_email = NULL, session_token = NULL, sync_salt = NULL, last_pulled_at = 0, last_pushed_at = 0 WHERE id = 1`)
      .run();
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }

  async triggerNow(): Promise<SyncStatus> {
    await this.runOnce();
    return this.status();
  }

  async reenterPassword(password: string): Promise<SyncStatus> {
    this.accountPassword = password;
    this.platform.saveAccountPassword(password);
    this.startPeriodicSync();
    await this.runOnce();
    return this.status();
  }

  private persistToken(email: string, sessionToken: string): void {
    getSyncState(this.db); // ensures the singleton row exists
    this.db.prepare(`UPDATE sync_state SET account_email = ?, session_token = ? WHERE id = 1`).run(email, sessionToken);
  }

  private finaliseSession(password: string, salt: string): void {
    this.db.prepare(`UPDATE sync_state SET sync_salt = ? WHERE id = 1`).run(salt);
    this.platform.saveAccountPassword(password);
    this.accountPassword = password;
    this.salt = salt;
  }

  private startPeriodicSync(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.intervalHandle = setInterval(() => {
      this.runOnce().catch(() => undefined);
    }, PERIODIC_INTERVAL_MS);
  }

  /** One sync at a time; a request that arrives mid-run triggers exactly one follow-up run. */
  private runOnce(): Promise<void> {
    if (this.running) {
      this.rerunRequested = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerunRequested = false;
          this.lastRunStartedAt = Date.now();
          await this.syncCycle(true);
        } while (this.rerunRequested);
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  /** Session tokens expire; with the stored password we can quietly sign in again instead of asking. */
  private async reauthenticate(): Promise<"ok" | "rejected" | "unreachable"> {
    const row = this.db.prepare(`SELECT account_email FROM sync_state WHERE id = 1`).get() as { account_email: string | null } | undefined;
    if (!row?.account_email || this.accountPassword === undefined) return "rejected";
    try {
      const result = await this.client.signIn(row.account_email, this.accountPassword);
      this.persistToken(row.account_email, result.sessionToken);
      return "ok";
    } catch (error) {
      // The server answered and said no (unknown account, wrong password): the session is gone for
      // good. No answer at all (offline) is temporary — keep the session and retry next tick.
      const status = (error as { status?: number }).status;
      return status !== undefined && status >= 400 && status < 500 ? "rejected" : "unreachable";
    }
  }

  private async syncCycle(allowReauth: boolean): Promise<void> {
    if (this.accountPassword === undefined || this.salt === undefined) return; // signed out, or no stored password available
    const password = this.accountPassword;
    const salt = this.salt;
    try {
      const state = getSyncState(this.db);
      const push = await collectLocalChanges(this.db, state.lastPushedAt, password, salt, (sourceId) => this.platform.getCredentials(sourceId));
      const tombstoneCutoff = Math.max(
        0,
        ...[...push.sources, ...push.movieFavourites, ...push.movieRecents, ...push.seriesFavourites, ...push.seriesRecents, ...push.progress]
          .map((row) => row.deletedAt)
          .filter((deletedAt): deletedAt is number => deletedAt !== null),
      );
      const pushResult = await this.client.push(push);
      setSyncState(this.db, { lastPushedAt: Math.max(state.lastPushedAt, pushResult.newCursor) });
      clearTombstones(this.db, tombstoneCutoff);

      // Devices before this change ignored a source edited elsewhere (a rename, new login, content switches). Read the
      // account's sources once from the start so edits already made are picked up; applying them again is harmless.
      const reread = this.db.prepare(`SELECT 1 FROM schema_meta WHERE key = 'sync_source_edits_reread'`).get() === undefined;
      const pull = await this.client.pull(reread ? 0 : state.lastPulledAt);
      const addedSourceIds: string[] = [];
      const applyResult = await applyRemoteChanges(this.db, pull, password, salt, async (remoteKey, label, payload, updatedAt) => {
        const existing = this.db.prepare(`SELECT id, sync_updated_at AS updatedAt FROM sources WHERE remote_key = ?`).get(remoteKey) as { id: string; updatedAt: number | null } | undefined;
        if (existing) {
          // Already configured here: the id stays, but a newer edit made elsewhere (a rename, new login, content switches) is taken.
          if (existing.updatedAt !== null && existing.updatedAt >= updatedAt) return;
          if ("playlistUrl" in payload) {
            this.db.prepare(`UPDATE sources SET name = ?, playlist_url = ?, sync_updated_at = ? WHERE id = ?`).run(label, payload.playlistUrl, updatedAt, existing.id);
          } else {
            await this.platform.saveCredentials(existing.id, { baseUrl: payload.host, username: payload.username, password: payload.password });
            this.db.prepare(`UPDATE sources SET name = ?, base_url = ?, sync_updated_at = ? WHERE id = ?`).run(label, payload.host, updatedAt, existing.id);
          }
          if (payload.content !== undefined && applySourceContent(this.db, existing.id, payload.content)) addedSourceIds.push(existing.id);
          if (payload.position !== undefined) applySourcePosition(this.db, existing.id, payload.position);
          return;
        }
        const id = this.platform.randomId();
        if ("playlistUrl" in payload) {
          this.db
            .prepare(`INSERT INTO sources (id, kind, name, playlist_url, created_at, remote_key, sync_updated_at) VALUES (?, 'm3u', ?, ?, ?, ?, ?)`)
            .run(id, label, payload.playlistUrl, Date.now(), remoteKey, updatedAt);
        } else {
          await this.platform.saveCredentials(id, { baseUrl: payload.host, username: payload.username, password: payload.password });
          this.db
            .prepare(`INSERT INTO sources (id, kind, name, base_url, created_at, remote_key, sync_updated_at) VALUES (?, 'xtream', ?, ?, ?, ?, ?)`)
            .run(id, label, payload.host, Date.now(), remoteKey, updatedAt);
        }
        // Taken with the source's own clock, so this device does not push it back as if it had just edited it.
        if (payload.content !== undefined) applySourceContent(this.db, id, payload.content);
        if (payload.position !== undefined) applySourcePosition(this.db, id, payload.position);
        addedSourceIds.push(id);
      }, async (remoteKey, deletedAt) => {
        const existing = this.db.prepare(`SELECT id, sync_updated_at AS updatedAt FROM sources WHERE remote_key = ?`).get(remoteKey) as { id: string; updatedAt: number | null } | undefined;
        if (existing === undefined) return;
        // A source added again here after it was removed elsewhere is newer than the removal: keep it.
        if (existing.updatedAt !== null && existing.updatedAt > deletedAt) return;
        removeSourceRows(this.db, existing.id, { recordTombstone: false });
        await this.platform.deleteCredentials?.(existing.id);
      });
      const nextPulledAt =
        applyResult.deferredBeforeMs !== undefined ? Math.min(pull.serverCursor, applyResult.deferredBeforeMs - 1) : pull.serverCursor;
      setSyncState(this.db, { lastPulledAt: nextPulledAt });
      if (reread) this.db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('sync_source_edits_reread', '1')`).run();
      this.lastSyncedAt = Date.now();
      this.lastError = undefined;
      if (pull.sources.length + pull.movieFavourites.length + pull.movieRecents.length + pull.seriesFavourites.length + pull.seriesRecents.length + pull.progress.length > 0) this.lastChangedAt = Date.now();
      if (addedSourceIds.length > 0) this.onSourcesAdded(addedSourceIds);
    } catch (error) {
      if (allowReauth && (error as { status?: number }).status === 401) {
        const outcome = await this.reauthenticate();
        if (outcome === "ok") return this.syncCycle(false);
        if (outcome === "rejected") {
          // The account this device was signed in to no longer exists (or the password changed).
          // Say so and go back to the sign-in form instead of failing forever.
          this.forgetSession();
          this.lastError = "Your session expired. Sign in again to keep syncing.";
          return;
        }
      }
      this.lastError = describeSyncError(error);
      // Best-effort: a failed sync never blocks playback/browsing — see the design spec's
      // "Error handling". The next periodic tick (or a manual triggerNow) retries.
    }
  }

  dispose(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    if (this.changeTimer) clearTimeout(this.changeTimer);
  }
}
