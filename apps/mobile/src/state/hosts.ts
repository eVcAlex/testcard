import type Database from "better-sqlite3";
import { probeXtream, type XtreamCredentials } from "@testcard/core/src/source/xtream/detect.js";
import { parseBackupUrls } from "@testcard/core/src/sync/localChanges.js";
import { getStoredCredentials, serverFor, setServerInUse } from "../platform/secrets";

/**
 * A provider often gives more than one address for the same account, and moves between them. A source keeps its main
 * address (the one its history is matched by across devices) and any backups; when the main one cannot be reached, the
 * first backup that answers is used for everything (lists, streams, the guide) until the main one is back.
 */

/** How long one address is given to answer before the next is tried. */
const ANSWER_WITHIN_MS = 8000;
const metaKey = (sourceId: string) => `server:${sourceId}`;

function backupsOf(db: Database.Database, sourceId: string): string[] {
  const row = db.prepare(`SELECT kind, backup_urls AS backups FROM sources WHERE id = ?`).get(sourceId) as { kind: string; backups: string | null } | undefined;
  return row?.kind === "xtream" ? parseBackupUrls(row.backups) : [];
}

export const hasBackups = (db: Database.Database, sourceId: string) => backupsOf(db, sourceId).length > 0;

async function answers(credentials: XtreamCredentials): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANSWER_WITHIN_MS);
  try {
    const result = await probeXtream(credentials, (input, init) => fetch(input, { ...init, signal: controller.signal }));
    return result.authenticated;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Takes up, at launch, the backup each source was on last time (asked again the next time it is checked). */
export function loadServersInUse(db: Database.Database): void {
  for (const row of db.prepare(`SELECT key, value FROM schema_meta WHERE key LIKE 'server:%'`).all() as { key: string; value: string }[]) {
    const sourceId = row.key.slice("server:".length);
    if (backupsOf(db, sourceId).includes(row.value)) setServerInUse(sourceId, row.value);
    else db.prepare(`DELETE FROM schema_meta WHERE key = ?`).run(row.key);
  }
}

/**
 * Finds the address that answers, the main one first, and uses it from now on. Returns whether a different one is in
 * use than before (so a failed request is worth trying again). A source with no backups is left alone.
 */
export async function pickServer(db: Database.Database, sourceId: string): Promise<boolean> {
  const backups = backupsOf(db, sourceId);
  if (backups.length === 0) return false;
  const stored = await getStoredCredentials(sourceId).catch(() => undefined);
  if (stored === undefined) return false;
  const before = serverFor(sourceId) ?? stored.baseUrl;
  for (const server of [stored.baseUrl, ...backups]) {
    if (!(await answers({ ...stored, baseUrl: server }))) continue;
    const backup = server === stored.baseUrl ? null : server;
    setServerInUse(sourceId, backup);
    if (backup === null) db.prepare(`DELETE FROM schema_meta WHERE key = ?`).run(metaKey(sourceId));
    else db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(metaKey(sourceId), backup);
    return server !== before;
  }
  return false;
}

/** The backup address a source is on, for its card; undefined while on its main one. */
export const backupInUse = (sourceId: string): string | undefined => serverFor(sourceId);

/** Whether a failure means the server could not be reached at all (worth another address), not a refusal. */
export const unreachable = (message: string) => /UnknownHost|resolve host|ENOTFOUND|No address associated|Unable to connect|ConnectException|ECONNREFUSED|Network request failed|timed? ?out|SocketTimeout|did not respond/i.test(message);
