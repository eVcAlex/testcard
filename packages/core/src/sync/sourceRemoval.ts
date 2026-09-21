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
    db.prepare(`DELETE FROM favourites WHERE channel_id NOT IN (SELECT id FROM channels)`).run();
    db.prepare(`DELETE FROM recents WHERE channel_id NOT IN (SELECT id FROM channels)`).run();
    db.prepare(`DELETE FROM movie_favourites WHERE movie_id NOT IN (SELECT id FROM movies)`).run();
    db.prepare(`DELETE FROM movie_recents WHERE movie_id NOT IN (SELECT id FROM movies)`).run();
    db.prepare(`DELETE FROM series_favourites WHERE series_id NOT IN (SELECT id FROM series)`).run();
    db.prepare(`DELETE FROM series_recents WHERE series_id NOT IN (SELECT id FROM series)`).run();
    // Polymorphic (item_type + item_id, no foreign key): the cascade cannot reach it.
    db.prepare(
      `DELETE FROM playback_progress
       WHERE (item_type = 'movie'   AND item_id NOT IN (SELECT id FROM movies))
          OR (item_type = 'episode' AND item_id NOT IN (SELECT id FROM episodes))`,
    ).run();
  })();
}
