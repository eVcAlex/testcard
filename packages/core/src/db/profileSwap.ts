import type Database from "better-sqlite3";

/**
 * Profiles on one device (the TV app's "Who's watching?"). Everything a person has of their own lives in the usual
 * tables, which always hold the profile that is watching now; the others' rows wait in `profile_stash` until their
 * profile is picked. Switching swaps the two in one transaction, so every query in the app reads the right person's
 * rows without knowing profiles exist.
 *
 * Only the account's own profile may sync: the caller holds syncing off while any other one is in the tables, or
 * that person's history would be pushed as the account's. Pending sync deletes (`sync_tombstones`) move with their
 * profile for the same reason.
 */

/** A person's own rows: what they have starred, watched and pinned. The catalogue, sources and sync state are shared. */
export const PERSONAL_TABLES: readonly string[] = [
  "favourites",
  "recents",
  "movie_favourites",
  "movie_recents",
  "series_favourites",
  "series_recents",
  "playback_progress",
  "home_pins",
  "sync_tombstones",
];

const STASH_SQL = `
CREATE TABLE IF NOT EXISTS profile_stash (
  profile_id  TEXT NOT NULL,
  table_name  TEXT NOT NULL,   -- a PERSONAL_TABLES name, or 'schema_meta' for the caller's per-profile settings
  row         TEXT NOT NULL    -- the row as JSON, column name to value
);
CREATE INDEX IF NOT EXISTS idx_profile_stash_profile ON profile_stash(profile_id);
`;

type Row = Record<string, unknown>;

function columns(db: Database.Database, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name));
}

/**
 * Puts `from`'s rows away and brings `to`'s out. `metaKeys` are `schema_meta` keys that belong to a profile too
 * (caption and audio preferences, say); they move the same way. A stashed row that no longer fits (its source was
 * removed since, so a pin's foreign key fails) is dropped rather than failing the switch.
 */
export function swapProfile(db: Database.Database, from: string, to: string, metaKeys: readonly string[] = []): void {
  if (from === to) return;
  db.exec(STASH_SQL);
  const stash = db.prepare(`INSERT INTO profile_stash (profile_id, table_name, row) VALUES (?, ?, ?)`);
  const metaFilter = metaKeys.length > 0 ? `key IN (${metaKeys.map(() => "?").join(", ")})` : null;
  const parts: { table: string; where: string | null; args: readonly string[] }[] = [
    ...PERSONAL_TABLES.map((table) => ({ table, where: null, args: [] })),
    ...(metaFilter !== null ? [{ table: "schema_meta", where: metaFilter, args: metaKeys }] : []),
  ];
  db.transaction(() => {
    for (const { table, where, args } of parts) {
      const filter = where !== null ? ` WHERE ${where}` : "";
      for (const row of db.prepare(`SELECT * FROM ${table}${filter}`).all(...args) as Row[]) stash.run(from, table, JSON.stringify(row));
      db.prepare(`DELETE FROM ${table}${filter}`).run(...args);
    }
    const waiting = db.prepare(`SELECT table_name AS tableName, row FROM profile_stash WHERE profile_id = ?`).all(to) as { tableName: string; row: string }[];
    const known = new Map<string, Set<string>>();
    for (const { tableName, row } of waiting) {
      if (!parts.some((part) => part.table === tableName)) continue;
      let have = known.get(tableName);
      if (have === undefined) {
        have = columns(db, tableName);
        known.set(tableName, have);
      }
      // Only the columns the table still has: a stashed row outlives schema changes.
      const entries = Object.entries(JSON.parse(row) as Row).filter(([name]) => have.has(name));
      if (entries.length === 0) continue;
      try {
        db.prepare(`INSERT OR REPLACE INTO ${tableName} (${entries.map(([name]) => name).join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`).run(
          ...entries.map(([, value]) => value),
        );
      } catch {
        // No longer fits (see above).
      }
    }
    db.prepare(`DELETE FROM profile_stash WHERE profile_id = ?`).run(to);
  })();
}

/** Forgets a profile that is not the one in the tables now. */
export function forgetProfile(db: Database.Database, id: string): void {
  db.exec(STASH_SQL);
  db.prepare(`DELETE FROM profile_stash WHERE profile_id = ?`).run(id);
}
