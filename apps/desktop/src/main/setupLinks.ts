import type Database from "better-sqlite3";
import {
  buildSetupPayload,
  generateSetupLink,
  openSetupProfile,
  parseSetupLinkText,
  remoteKeyFor,
  remoteKeyForPlaylist,
  sealSetupProfile,
  setupLinkUrl,
  setupProof,
  summariseSetup,
  type SetupSummary,
} from "@testcard/core";
import type { AddSourceInput, SetupOutcome, SharedLink } from "../shared/ipc.js";
import { getStoredCredentials } from "./credentials.js";
import { syncPlatform } from "./syncController.js";

/**
 * Sources shared by link (docs/adr/0019-setup-links.md). Everything secret stays in this process: the renderer is given an
 * opaque id and a name and host to show, and the decrypted login goes straight into the same `sources.add` path a hand-typed
 * source takes (so it is checked with the provider and kept in the platform's secure storage). Nothing here is logged, and
 * errors are plain sentences with no addresses in them.
 */

type SetupProfilePayload = ReturnType<typeof buildSetupPayload>;

const TIMEOUT_MS = 15_000;

class Failure extends Error {}

async function call(path: string, init: RequestInit, token?: string): Promise<Response> {
  try {
    return await fetch(`${syncPlatform.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Failure("Couldn't reach Testcard. Check your connection and try again.");
  }
}

function sessionToken(db: Database.Database): string {
  const row = db.prepare(`SELECT session_token AS token FROM sync_state WHERE id = 1`).get() as { token: string | null } | undefined;
  if (!row?.token) throw new Failure("Sign in to your Testcard account to share a source.");
  return row.token;
}

// ---------------------------------------------------------------------------------------------
// receiving

interface Pending {
  readonly payload: SetupProfilePayload;
  readonly summary: SetupSummary;
}

const pending = new Map<string, Pending>();
let outcome: SetupOutcome | null = null;

/** Claims the link with the Worker, opens it, and holds the result until the person agrees. Throws a sentence to show. */
export async function previewSetupLink(text: string): Promise<{ readonly id: string; readonly summary: SetupSummary }> {
  const link = parseSetupLinkText(text);
  if (link === null) throw new Failure("That doesn't look like a Testcard setup link.");

  const { proof } = await setupProof(link.secret);
  const response = await call("/share/claim", { method: "POST", body: JSON.stringify({ id: link.id, proof }) });
  if (response.status === 429) throw new Failure("Too many tries. Wait a while and try again.");
  if (!response.ok) throw new Failure("This link has expired, has already been used, or was withdrawn. Ask whoever sent it for a new one.");

  let payload: SetupProfilePayload;
  try {
    payload = await openSetupProfile((await response.json()) as { blob: string; iv: string }, link);
  } catch {
    throw new Failure("This link is damaged or incomplete. Ask whoever sent it for a new one.");
  }
  const id = crypto.randomUUID();
  pending.set(id, { payload, summary: summariseSetup(payload) });
  return { id, summary: summariseSetup(payload) };
}

/** A link handed over by the system (the app was opened from one): previewed, with the answer kept for the window to pick up. */
export async function receiveSetupLink(text: string): Promise<void> {
  try {
    const { id, summary } = await previewSetupLink(text);
    outcome = { kind: "ready", id, summary };
  } catch (error) {
    outcome = { kind: "error", message: error instanceof Failure ? error.message : "That link couldn't be opened." };
  }
}

/** What the window should show now, once. */
export function takeSetupOutcome(): SetupOutcome | null {
  const current = outcome;
  outcome = null;
  return current;
}

/** A preview the person asked for by pasting a link: the window shows its question the same way it does for one the system opened. */
export function holdSetupOutcome(id: string, summary: SetupSummary): void {
  outcome = { kind: "ready", id, summary };
}

export function cancelSetupLink(id: string): void {
  pending.delete(id);
  if (outcome?.kind === "ready" && outcome.id === id) outcome = null;
}

/**
 * Adds the source the person agreed to, through `add` (the app's normal path). A provider the person already has is left
 * alone and reported, never overwritten or added twice.
 */
export async function confirmSetupLink(
  db: Database.Database,
  id: string,
  add: (input: AddSourceInput) => Promise<unknown>,
): Promise<{ readonly status: "added" | "duplicate"; readonly name: string }> {
  const held = pending.get(id);
  if (held === undefined) throw new Failure("This setup link is no longer waiting. Open it again.");
  const { payload } = held;
  const { source } = payload;

  const key = "playlistUrl" in source ? await remoteKeyForPlaylist(source.playlistUrl) : await remoteKeyFor(source.host, "source");
  const existing = db.prepare(`SELECT name FROM sources WHERE remote_key = ? AND sync_deleted_at IS NULL`).get(key) as { name: string } | undefined;
  if (existing !== undefined) {
    pending.delete(id);
    return { status: "duplicate", name: existing.name };
  }

  const common = {
    name: payload.name,
    ...(source.content !== undefined ? { content: source.content } : {}),
    ...(source.epgUrl !== undefined ? { epgUrl: source.epgUrl } : {}),
    ...(payload.epgOptimise === true ? { epgOptimise: true } : {}),
  };
  try {
    await add(
      "playlistUrl" in source
        ? { ...common, via: "url", pastedUrl: source.playlistUrl }
        : {
            ...common,
            via: "xtream",
            baseUrl: source.host,
            username: source.username,
            password: source.password,
            ...(source.backupHosts !== undefined ? { backupUrls: source.backupHosts } : {}),
          },
    );
  } catch (error) {
    // Kept, so a provider that was briefly down can be tried again without a new link.
    throw new Failure(error instanceof Error ? error.message : "That source couldn't be added.");
  }
  pending.delete(id);
  return { status: "added", name: payload.name };
}

// ---------------------------------------------------------------------------------------------
// sending

/** Seals one of this device's sources and registers it, returning the link to give out. */
export async function createShare(
  db: Database.Database,
  sourceId: string,
  options: { readonly expiresInDays?: number; readonly maxClaims?: number } = {},
): Promise<{ readonly id: string; readonly url: string; readonly expiresAt: number }> {
  const token = sessionToken(db);
  const row = db
    .prepare(
      `SELECT kind, name, base_url AS baseUrl, playlist_url AS playlistUrl, epg_url AS epgUrl, backup_urls AS backupUrls,
              include_live AS live, include_movies AS movies, include_series AS series, epg_optimise AS epgOptimise
       FROM sources WHERE id = ? AND sync_deleted_at IS NULL`,
    )
    .get(sourceId) as
    | { kind: "xtream" | "m3u"; name: string; baseUrl: string | null; playlistUrl: string | null; epgUrl: string | null; backupUrls: string | null; live: number; movies: number; series: number; epgOptimise: number }
    | undefined;
  if (row === undefined) throw new Failure("That source no longer exists.");

  let backupHosts: string[] = [];
  try {
    backupHosts = row.backupUrls === null ? [] : (JSON.parse(row.backupUrls) as string[]);
  } catch {
    backupHosts = [];
  }
  const login = row.kind === "xtream" ? await getStoredCredentials(sourceId) : undefined;
  const payload = buildSetupPayload({
    name: row.name,
    epgOptimise: row.epgOptimise !== 0,
    epgUrl: row.epgUrl,
    ...(row.kind === "xtream" ? { content: { live: row.live !== 0, movies: row.movies !== 0, series: row.series !== 0 } } : {}),
    source:
      row.kind === "xtream"
        ? { kind: "xtream", host: login!.baseUrl, username: login!.username, password: login!.password, backupHosts }
        : { kind: "m3u", playlistUrl: row.playlistUrl! },
  });

  const link = generateSetupLink();
  const { claimHash } = await setupProof(link.secret);
  const sealed = await sealSetupProfile(payload, link);
  const response = await call(
    "/share",
    { method: "POST", body: JSON.stringify({ id: link.id, claimHash, label: row.name, ...sealed, ...(options.expiresInDays !== undefined ? { expiresInDays: options.expiresInDays } : {}), ...(options.maxClaims !== undefined ? { maxClaims: options.maxClaims } : {}) }) },
    token,
  );
  await expectOk(response);
  const { expiresAt } = (await response.json()) as { expiresAt: number };
  return { id: link.id, url: setupLinkUrl(link), expiresAt };
}

async function expectOk(response: Response): Promise<void> {
  if (response.ok) return;
  if (response.status === 401) throw new Failure("Your Testcard session has expired. Sign in again to share.");
  if (response.status === 429) throw new Failure("You have too many active links. Withdraw one first.");
  throw new Failure("Couldn't do that just now. Try again.");
}

export async function listShares(db: Database.Database): Promise<readonly SharedLink[]> {
  const response = await call("/share", { method: "GET" }, sessionToken(db));
  await expectOk(response);
  return ((await response.json()) as { profiles: SharedLink[] }).profiles;
}

export async function revokeShare(db: Database.Database, id: string): Promise<void> {
  await expectOk(await call(`/share/${encodeURIComponent(id)}`, { method: "DELETE" }, sessionToken(db)));
}
