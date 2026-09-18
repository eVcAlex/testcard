import type Database from "better-sqlite3";
import {
  applyRemoteChanges,
  clearTombstones,
  collectLocalChanges,
  generateSalt,
  getSyncState,
  setSyncState,
  SyncClient,
} from "@testcard/core";
import type { SyncStatus } from "../shared/ipc.js";
import { getCredentials, saveCredentials } from "./credentials.js";

const SYNC_WORKER_URL = process.env.TESTCARD_SYNC_URL ?? "https://sync.testcard.app";
const PERIODIC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Owns the one in-memory secret this feature needs: the account password, used to derive the
 * credential-encryption key (Task 7's `credentialCrypto.ts`). It is never persisted — only the
 * resulting session token, account email, and PBKDF2 salt live in `sync_state` (Task 2), so a
 * relaunch always needs a fresh sign-in to sync again. That's the direct consequence of the
 * design spec's "Credential encryption" trade-off: no password, no decrypting synced sources.
 * The salt itself isn't secret (see Task 9's `/sync/salt`) and is safe to persist — it's what
 * lets a *second* device, after signing in, derive the exact same key the first device used.
 */
export class SyncController {
  private client: SyncClient;
  private accountPassword: string | undefined;
  private salt: string | undefined;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private lastError: string | undefined;

  constructor(private readonly db: Database.Database) {
    this.client = new SyncClient({ baseUrl: SYNC_WORKER_URL, getSessionToken: () => this.sessionToken() });
    const row = this.db.prepare(`SELECT sync_salt FROM sync_state WHERE id = 1`).get() as { sync_salt: string | null } | undefined;
    this.salt = row?.sync_salt ?? undefined;
  }

  private sessionToken(): string | undefined {
    const row = this.db.prepare(`SELECT session_token FROM sync_state WHERE id = 1`).get() as { session_token: string | null } | undefined;
    return row?.session_token ?? undefined;
  }

  status(): SyncStatus {
    const row = this.db.prepare(`SELECT account_email, last_pulled_at FROM sync_state WHERE id = 1`).get() as
      | { account_email: string | null; last_pulled_at: number }
      | undefined;
    if (!row || row.account_email === null) return { account: "signed-out", ...(this.lastError !== undefined ? { lastError: this.lastError } : {}) };
    if (this.accountPassword === undefined) {
      return { account: "needs-password", email: row.account_email, ...(this.lastError !== undefined ? { lastError: this.lastError } : {}) };
    }
    return {
      account: "signed-in",
      email: row.account_email,
      ...(row.last_pulled_at ? { lastSyncedAt: row.last_pulled_at } : {}),
      ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
    };
  }

  async signUp(email: string, password: string): Promise<SyncStatus> {
    const result = await this.client.signUp(email, password);
    const salt = generateSalt();
    await this.client.setSalt(salt); // set-once; safe even if a retry races, see handleSetSalt's ON CONFLICT DO NOTHING
    this.persistSession(email, result.sessionToken, password, salt);
    this.startPeriodicSync();
    return this.status();
  }

  async signIn(email: string, password: string): Promise<SyncStatus> {
    const result = await this.client.signIn(email, password);
    let salt = await this.client.getSalt();
    if (salt === undefined) {
      // Defensive fallback only: every account should have set one during signUp. Recovering
      // here means a first-ever sync still works even if that step was somehow interrupted.
      salt = generateSalt();
      await this.client.setSalt(salt);
    }
    this.persistSession(email, result.sessionToken, password, salt);
    this.startPeriodicSync();
    await this.runOnce();
    return this.status();
  }

  async signOut(): Promise<SyncStatus> {
    await this.client.signOut().catch(() => undefined); // best-effort — sign the device out locally regardless
    this.accountPassword = undefined;
    this.salt = undefined;
    this.db
      .prepare(`UPDATE sync_state SET account_email = NULL, session_token = NULL, sync_salt = NULL, last_pulled_at = 0, last_pushed_at = 0 WHERE id = 1`)
      .run();
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    return this.status();
  }

  async triggerNow(): Promise<SyncStatus> {
    await this.runOnce();
    return this.status();
  }

  async reenterPassword(password: string): Promise<SyncStatus> {
    this.accountPassword = password;
    this.startPeriodicSync();
    await this.runOnce();
    return this.status();
  }

  private persistSession(email: string, sessionToken: string, password: string, salt: string): void {
    getSyncState(this.db); // ensures the singleton row exists
    this.db.prepare(`UPDATE sync_state SET account_email = ?, session_token = ?, sync_salt = ? WHERE id = 1`).run(email, sessionToken, salt);
    this.accountPassword = password;
    this.salt = salt;
  }

  private startPeriodicSync(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.intervalHandle = setInterval(() => {
      this.runOnce().catch(() => undefined);
    }, PERIODIC_INTERVAL_MS);
  }

  private async runOnce(): Promise<void> {
    if (this.accountPassword === undefined || this.salt === undefined) return; // signed out, or a fresh launch with no re-entered password yet
    const password = this.accountPassword;
    const salt = this.salt;
    try {
      const state = getSyncState(this.db);
      const push = await collectLocalChanges(this.db, state.lastPushedAt, password, salt, (sourceId) => getCredentials(sourceId));
      const tombstoneCutoff = Math.max(
        0,
        ...[...push.movieFavourites, ...push.movieRecents, ...push.seriesFavourites, ...push.seriesRecents, ...push.progress]
          .map((row) => row.deletedAt)
          .filter((deletedAt): deletedAt is number => deletedAt !== null),
      );
      const pushResult = await this.client.push(push);
      setSyncState(this.db, { lastPushedAt: Math.max(state.lastPushedAt, pushResult.newCursor) });
      clearTombstones(this.db, tombstoneCutoff);

      const pull = await this.client.pull(state.lastPulledAt);
      const applyResult = await applyRemoteChanges(this.db, pull, password, salt, async (remoteKey, label, credentials) => {
        const existing = this.db.prepare(`SELECT id FROM sources WHERE remote_key = ?`).get(remoteKey) as { id: string } | undefined;
        if (existing) return; // already have this provider configured locally — never overwrite a live source's id
        const id = crypto.randomUUID();
        await saveCredentials(id, { baseUrl: credentials.host, username: credentials.username, password: credentials.password });
        this.db
          .prepare(`INSERT INTO sources (id, kind, name, base_url, created_at, remote_key) VALUES (?, 'xtream', ?, ?, ?, ?)`)
          .run(id, label, credentials.host, Date.now(), remoteKey);
      });
      const nextPulledAt =
        applyResult.deferredBeforeMs !== undefined ? Math.min(pull.serverCursor, applyResult.deferredBeforeMs - 1) : pull.serverCursor;
      setSyncState(this.db, { lastPulledAt: nextPulledAt });
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Sync failed.";
      // Best-effort: a failed sync never blocks playback/browsing — see the design spec's
      // "Error handling". The next periodic tick (or a manual triggerNow) retries.
    }
  }

  dispose(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }
}
