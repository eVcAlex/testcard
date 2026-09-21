import type Database from "better-sqlite3";
import type { SourceContent } from "@testcard/sync-schema";

/**
 * Saves which content types a source loads. Turning one off removes it from this device (its favourites and
 * progress rows are left alone, and re-attach by id if it is turned back on). Returns true when something was
 * turned on, so the caller knows the source needs importing again.
 */
export function applySourceContent(db: Database.Database, sourceId: string, next: SourceContent): boolean {
  const prev = db
    .prepare(`SELECT include_live AS live, include_movies AS movies, include_series AS series FROM sources WHERE id = ?`)
    .get(sourceId) as { live: number; movies: number; series: number } | undefined;
  if (prev === undefined) return false;
  db.transaction(() => {
    db.prepare(`UPDATE sources SET include_live = ?, include_movies = ?, include_series = ? WHERE id = ?`).run(next.live ? 1 : 0, next.movies ? 1 : 0, next.series ? 1 : 0, sourceId);
    if (prev.live === 1 && !next.live) {
      db.prepare(`DELETE FROM channels WHERE source_id = ?`).run(sourceId);
      db.prepare(`DELETE FROM categories WHERE source_id = ?`).run(sourceId);
    }
    if (prev.movies === 1 && !next.movies) {
      db.prepare(`DELETE FROM movies WHERE source_id = ?`).run(sourceId);
      db.prepare(`DELETE FROM movie_categories WHERE source_id = ?`).run(sourceId);
    }
    if (prev.series === 1 && !next.series) {
      db.prepare(`DELETE FROM series WHERE source_id = ?`).run(sourceId);
      db.prepare(`DELETE FROM series_categories WHERE source_id = ?`).run(sourceId);
    }
  })();
  return (prev.live === 0 && next.live) || (prev.movies === 0 && next.movies) || (prev.series === 0 && next.series);
}
