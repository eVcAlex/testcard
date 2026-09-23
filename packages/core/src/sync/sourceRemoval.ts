import type Database from "better-sqlite3";

/**
 * Removes a source and what only existed because of it. The cascade takes its categories, channels,
 * films, series and episodes; the rest (favourites, recents and progress carry no foreign key on
 * purpose, so a title missing from one refresh does not drop a favourite) is pruned here, because a
 * removed source is permanent.
 *
 * A removal the user makes is recorded as a tombstone so it reaches their other devices. One that
 * arrived from another device is not (`recordTombstone: false`), since that device already said it.
 */
export function removeSourceRows(db: Database.Database, sourceId: string, options: { readonly recordTombstone: boolean }): void {
  const row = db.prepare(`SELECT remote_key FROM sources WHERE id = ?`).get(sourceId) as { remote_key: string | null } | undefined;
  if (row === undefined) return;
  db.transaction(() => {
    if (options.recordTombstone && row.remote_key !== null) {
      db.prepare(`INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) VALUES ('sources', ?, ?)`).run(row.remote_key, Date.now());
    }
    db.prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId);
    // The synced favourites and recents pruned below need tombstones too: left on the server, they point at
    // titles no device will import again, and a newly signed-in device would hold its sync cursor back on them.
    if (options.recordTombstone) {
      const now = Date.now();
      for (const [table, column, parent] of [
        ["movie_favourites", "movie_id", "movies"],
        ["movie_recents", "movie_id", "movies"],
        ["series_favourites", "series_id", "series"],
        ["series_recents", "series_id", "series"],
      ] as const) {
        db.prepare(
          `INSERT INTO sync_tombstones (table_name, remote_key, deleted_at)
           SELECT '${table}', remote_key, ? FROM ${table} WHERE remote_key IS NOT NULL AND ${column} NOT IN (SELECT id FROM ${parent})`,
        ).run(now);
      }
    }
    db.prepare(`DELETE FROM favourites WHERE channel_id NOT IN (SELECT id FROM channels)`).run();
    db.prepare(`DELETE FROM recents WHERE channel_id NOT IN (SELECT id FROM channels)`).run();
    db.prepare(`DELETE FROM movie_favourites WHERE movie_id NOT IN (SELECT id FROM movies)`).run();
    db.prepare(`DELETE FROM movie_recents WHERE movie_id NOT IN (SELECT id FROM movies)`).run();
    db.prepare(`DELETE FROM series_favourites WHERE series_id NOT IN (SELECT id FROM series)`).run();
    db.prepare(`DELETE FROM series_recents WHERE series_id NOT IN (SELECT id FROM series)`).run();
    // Polymorphic (item_type + item_id, no foreign key): the cascade cannot reach it. A synced position is cleared
    // rather than dropped, as clearPlaybackProgress does, so the clear reaches the other devices; one that never
    // synced has nobody to tell.
    const orphaned = `((item_type = 'movie' AND item_id NOT IN (SELECT id FROM movies)) OR (item_type = 'episode' AND item_id NOT IN (SELECT id FROM episodes)))`;
    if (options.recordTombstone) {
      const now = Date.now();
      db.prepare(
        `UPDATE playback_progress SET position_secs = 0, watched = 0, updated_at = ?, deleted_at = ?
         WHERE ${orphaned} AND remote_key IS NOT NULL AND deleted_at IS NULL`,
      ).run(now, now);
    }
    db.prepare(`DELETE FROM playback_progress WHERE ${orphaned} AND (remote_key IS NULL OR ?)`).run(options.recordTombstone ? 0 : 1);
  })();
}
