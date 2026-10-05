import type Database from "better-sqlite3";
import { parseBackupUrls, probeXtream, type XtreamCredentials } from "@testcard/core";
import { getStoredCredentials, setServerInUse } from "./credentials.js";

/**
 * A provider often gives more than one address for the same account. A source keeps its main address (the one its
 * history is matched by across devices) and any backups; when the main one cannot be reached, the first backup that
 * answers is used for everything (lists, streams, the guide) until the main one is back. Same behaviour as the phone app.
 */

/** How long one address is given to answer before the next is tried. */
const ANSWER_WITHIN_MS = 8000;
/** A source's address is re-checked at most this often, however many lookups ask. */
const RECHECK_AFTER_MS = 60_000;
const metaKey = (sourceId: string) => `server:${sourceId}`;

function backupsOf(db: Database.Database, sourceId: string): string[] {
  const row = db.prepare(`SELECT kind, backup_urls AS backups FROM sources WHERE id = ?`).get(sourceId) as { kind: string; backups: string | null } | undefined;
  return row?.kind === "xtream" ? parseBackupUrls(row.backups) : [];
}

async function answers(credentials: XtreamCredentials): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANSWER_WITHIN_MS);
  try {
    return (await probeXtream(credentials, (input, init) => fetch(input, { ...init, signal: controller.signal }))).authenticated;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Takes up, at launch, the backup each source was on last time. */
export function loadServersInUse(db: Database.Database): void {
  for (const row of db.prepare(`SELECT key, value FROM schema_meta WHERE key LIKE 'server:%'`).all() as { key: string; value: string }[]) {
    const sourceId = row.key.slice("server:".length);
    if (backupsOf(db, sourceId).includes(row.value)) setServerInUse(sourceId, row.value);
    else db.prepare(`DELETE FROM schema_meta WHERE key = ?`).run(row.key);
  }
}

async function pickServer(db: Database.Database, sourceId: string): Promise<void> {
  const backups = backupsOf(db, sourceId);
  if (backups.length === 0) {
    setServerInUse(sourceId, null);
    return;
  }
  const stored = await getStoredCredentials(sourceId).catch(() => undefined);
  if (stored === undefined) return;
  for (const server of [stored.baseUrl, ...backups]) {
    if (!(await answers({ ...stored, baseUrl: server }))) continue;
    const backup = server === stored.baseUrl ? null : server;
    setServerInUse(sourceId, backup);
    if (backup === null) db.prepare(`DELETE FROM schema_meta WHERE key = ?`).run(metaKey(sourceId));
    else db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(metaKey(sourceId), backup);
    return;
  }
}

const checking = new Map<string, Promise<void>>();
const checkedAt = new Map<string, number>();

/**
 * Makes sure the source is on an address that answers, before it is used. A source with no backups costs nothing; one
 * with backups is probed at most once a minute, and concurrent callers share the probe.
 */
export async function ensureServer(db: Database.Database, sourceId: string): Promise<void> {
  const pending = checking.get(sourceId);
  if (pending !== undefined) return pending;
  if (Date.now() - (checkedAt.get(sourceId) ?? 0) < RECHECK_AFTER_MS || backupsOf(db, sourceId).length === 0) return;
  const run = pickServer(db, sourceId)
    .catch(() => undefined)
    .finally(() => {
      checkedAt.set(sourceId, Date.now());
      checking.delete(sourceId);
    });
  checking.set(sourceId, run);
  return run;
}

/** Forces a fresh check next time the source is used (after its backup list or login is edited). */
export function recheckServer(sourceId: string): void {
  checkedAt.delete(sourceId);
}
