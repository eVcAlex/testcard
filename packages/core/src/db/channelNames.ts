import type Database from "better-sqlite3";
import { DISPLAY_NAME_VERSION, channelDisplayName } from "../normalise/displayName.js";

/**
 * Redoes every stored channel name from its `raw_name` when the tidying rules have changed, so an
 * improvement reaches existing installs without waiting for a refresh. Ids are untouched (they key on
 * `parseName`), so favourites and recents stay put. Only names that actually change are written, to
 * spare the search index. Idempotent: a no-op once `schema_meta.display_name_version` matches.
 */
export function renameChannels(db: Database.Database): void {
  const stored = db.prepare(`SELECT value FROM schema_meta WHERE key = 'display_name_version'`).get() as { value: string } | undefined;
  if (stored !== undefined && Number(stored.value) === DISPLAY_NAME_VERSION) return;

  db.transaction(() => {
    const rows = db.prepare(`SELECT id, raw_name AS rawName, normalised_name AS name FROM channels`).all() as { id: string; rawName: string; name: string }[];
    const update = db.prepare(`UPDATE channels SET normalised_name = ? WHERE id = ?`);
    for (const row of rows) {
      const name = channelDisplayName(row.rawName);
      if (name !== row.name) update.run(name, row.id);
    }
    db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('display_name_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
      String(DISPLAY_NAME_VERSION),
    );
  })();
}
