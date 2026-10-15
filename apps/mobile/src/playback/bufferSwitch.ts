import type Database from "better-sqlite3";

/**
 * Whether live TV moves to another feed of the same channel as soon as the picture stops to buffer. On by default; turned
 * off in Settings it only reloads the same feed, as before. Kept on this device in `schema_meta` beside the other
 * viewing options, not synced; the Fire TV app keeps the same choice under the same key.
 */
const KEY = "ui:switchOnBuffering";

export function readSwitchOnBuffering(db: Database.Database): boolean {
  try {
    return (db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get(KEY) as { value: string } | undefined)?.value !== "0";
  } catch {
    return true;
  }
}

export function writeSwitchOnBuffering(db: Database.Database, on: boolean): void {
  try {
    db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(KEY, on ? "1" : "0");
  } catch {
    // Only the next visit would miss it.
  }
}
