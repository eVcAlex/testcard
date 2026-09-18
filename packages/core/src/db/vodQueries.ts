import type Database from "better-sqlite3";
import type { Source } from "../source/types.js";

export interface MovieRow {
  readonly id: string;
  readonly source_id: string;
  readonly category_id: string;
  readonly name: string;
  readonly poster_url: string | null;
  readonly rating: string | null;
  readonly plot: string | null;
  readonly duration_secs: number | null;
  readonly details_fetched_at: number | null;
  readonly is_favourite: 0 | 1;
  readonly position_secs: number | null;
  readonly watched: 0 | 1;
}

const MOVIE_COLUMNS = `m.id, m.source_id, m.category_id, m.name, m.poster_url, m.rating, m.plot,
  COALESCE(m.duration_secs, (SELECT duration_secs FROM playback_progress pp WHERE pp.item_type = 'movie' AND pp.item_id = m.id)) AS duration_secs,
  m.details_fetched_at,
  (SELECT 1 FROM movie_favourites f WHERE f.movie_id = m.id) IS NOT NULL AS is_favourite,
  (SELECT position_secs FROM playback_progress pp WHERE pp.item_type = 'movie' AND pp.item_id = m.id) AS position_secs,
  COALESCE((SELECT watched FROM playback_progress pp WHERE pp.item_type = 'movie' AND pp.item_id = m.id), 0) AS watched`;

/** FTS5 search over movie titles. Same prefix-query shape as `searchChannels`. */
export function searchMovies(db: Database.Database, query: string, limit = 200, sourceId?: string): MovieRow[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const ftsQuery = trimmed.split(/\s+/).map((token) => `${token.replace(/["*]/g, "")}*`).join(" ");
  return db
    .prepare(
      `SELECT ${MOVIE_COLUMNS}
       FROM movies_fts
       JOIN movies m ON m.rowid = movies_fts.rowid
       WHERE movies_fts MATCH ?${sourceId !== undefined ? " AND m.source_id = ?" : ""}
       ORDER BY rank
       LIMIT ?`,
    )
    .all(...(sourceId !== undefined ? [ftsQuery, sourceId] : [ftsQuery]), limit) as MovieRow[];
}

/** The default poster grid: every movie, optionally narrowed to one category. Provider order. */
export function browseMovies(
  db: Database.Database,
  opts: { categoryId?: string; sourceId?: string; genre?: string; limit?: number; offset?: number } = {},
): MovieRow[] {
  const limit = opts.limit ?? 300;
  const offset = opts.offset ?? 0;
  const clauses: string[] = [];
  const filters: unknown[] = [];
  if (opts.categoryId !== undefined) {
    clauses.push("m.category_id = ?");
    filters.push(opts.categoryId);
  }
  if (opts.sourceId !== undefined) {
    clauses.push("m.source_id = ?");
    filters.push(opts.sourceId);
  }
  if (opts.genre !== undefined) {
    clauses.push("m.category_id IN (SELECT id FROM movie_categories WHERE genre = ?)");
    filters.push(opts.genre);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(`SELECT ${MOVIE_COLUMNS} FROM movies m ${where} ORDER BY m.rowid LIMIT ? OFFSET ?`)
    .all(...filters, limit, offset) as MovieRow[];
}

export interface MovieCategoryRow {
  readonly id: string;
  readonly name: string;
  readonly country: string | null;
  readonly movie_count: number;
  /** Advisory classification (see normalise/classifyCategory.ts): null/'' when unrecognised. */
  readonly genre: string | null;
  readonly language: string | null;
  readonly service: string | null;
  readonly tags: string;
}

/** Every movie category that still has movies, for `MoviesView`'s category tree. */
export function listMovieCategories(db: Database.Database, sourceId?: string): MovieCategoryRow[] {
  return db
    .prepare(
      `SELECT cat.id, cat.raw_name AS name, cat.country, cat.genre, cat.language, cat.service, cat.tags, COUNT(m.id) AS movie_count
       FROM movie_categories cat
       JOIN movies m ON m.category_id = cat.id
       ${sourceId !== undefined ? "WHERE cat.source_id = ?" : ""}
       GROUP BY cat.id
       ORDER BY cat.rowid`,
    )
    .all(...(sourceId !== undefined ? [sourceId] : [])) as MovieCategoryRow[];
}

export function listFavouriteMovies(db: Database.Database): MovieRow[] {
  return db
    .prepare(`SELECT ${MOVIE_COLUMNS} FROM movie_favourites f JOIN movies m ON m.id = f.movie_id ORDER BY f.added_at DESC`)
    .all() as MovieRow[];
}

export function listRecentMovies(db: Database.Database, limit = 24): MovieRow[] {
  return db
    .prepare(`SELECT ${MOVIE_COLUMNS} FROM movie_recents r JOIN movies m ON m.id = r.movie_id ORDER BY r.played_at DESC LIMIT ?`)
    .all(limit) as MovieRow[];
}

export function toggleMovieFavourite(db: Database.Database, movieId: string): boolean {
  const existing = db.prepare(`SELECT 1 FROM movie_favourites WHERE movie_id = ?`).get(movieId);
  if (existing) {
    const row = db.prepare(`SELECT remote_key FROM movie_favourites WHERE movie_id = ?`).get(movieId) as { remote_key: string | null };
    db.prepare(`DELETE FROM movie_favourites WHERE movie_id = ?`).run(movieId);
    if (row.remote_key !== null) {
      db.prepare(`INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) VALUES ('movie_favourites', ?, ?)`).run(row.remote_key, Date.now());
    }
    return false;
  }
  const movie = db.prepare(`SELECT remote_key FROM movies WHERE id = ?`).get(movieId) as { remote_key: string | null } | undefined;
  db.prepare(`INSERT INTO movie_favourites (movie_id, added_at, remote_key, updated_at) VALUES (?, ?, ?, ?)`).run(
    movieId,
    Date.now(),
    movie?.remote_key ?? null,
    Date.now(),
  );
  return true;
}

export function recordMovieRecent(db: Database.Database, movieId: string): void {
  const movie = db.prepare(`SELECT remote_key FROM movies WHERE id = ?`).get(movieId) as { remote_key: string | null } | undefined;
  db.prepare(
    `INSERT INTO movie_recents (movie_id, played_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(movie_id) DO UPDATE SET played_at = excluded.played_at, remote_key = excluded.remote_key, updated_at = excluded.updated_at`,
  ).run(movieId, Date.now(), movie?.remote_key ?? null, Date.now());
}

/** A single movie row by id, for the detail pane after `ensureMovieDetails` has run. */
export function getMovieById(db: Database.Database, movieId: string): MovieRow | undefined {
  return db.prepare(`SELECT ${MOVIE_COLUMNS} FROM movies m WHERE m.id = ?`).get(movieId) as MovieRow | undefined;
}

/** Everything the main process needs to build a movie's playable stream URL. */
export interface MoviePlaybackTarget {
  readonly movieId: string;
  readonly movieName: string;
  readonly providerStreamId: string;
  readonly containerExtension: string | null;
  /** The catalog's `movies.duration_secs` — NULL until `ensureMovieDetails`'s lazy fetch has run. */
  readonly durationSecs: number | null;
  readonly source: Source;
}

export function getMoviePlaybackTarget(db: Database.Database, movieId: string): MoviePlaybackTarget | undefined {
  const row = db
    .prepare(
      `SELECT m.id AS movieId, m.name AS movieName, m.provider_stream_id AS providerStreamId, m.container_extension AS containerExtension,
              m.duration_secs AS durationSecs,
              s.id AS sourceId, s.kind AS kind, s.name AS sourceName, s.base_url AS baseUrl
       FROM movies m
       JOIN sources s ON s.id = m.source_id
       WHERE m.id = ?`,
    )
    .get(movieId) as
    | {
        movieId: string;
        movieName: string;
        providerStreamId: string;
        containerExtension: string | null;
        durationSecs: number | null;
        sourceId: string;
        kind: "xtream" | "m3u";
        sourceName: string;
        baseUrl: string | null;
      }
    | undefined;
  if (!row) return undefined;

  // Movies are Xtream-only (design spec "Scope"), but the source row shape is generic — build
  // whichever kind it actually is so a stale row fails loudly downstream rather than here.
  const source: Source =
    row.kind === "xtream"
      ? { id: row.sourceId, kind: "xtream", name: row.sourceName, baseUrl: row.baseUrl ?? "" }
      : { id: row.sourceId, kind: "m3u", name: row.sourceName, playlistUrl: "" };

  return {
    movieId: row.movieId,
    movieName: row.movieName,
    providerStreamId: row.providerStreamId,
    containerExtension: row.containerExtension,
    durationSecs: row.durationSecs,
    source,
  };
}

export interface MovieShelf {
  readonly category: MovieCategoryRow;
  readonly items: MovieRow[];
}

/** Category tags that mark a row as not worth a landing-page shelf (adult is still browsable by name). */
const HIDDEN_FROM_SHELVES: ReadonlySet<string> = new Set(["junk", "separator", "adult"]);

/**
 * The landing page's category rows: the biggest categories that have enough titles to fill a row,
 * each with its best-rated titles first (those with a poster ahead of those without). Divider,
 * junk and adult categories are skipped. One indexed query per shelf, so it stays cheap on a
 * catalogue of tens of thousands.
 */
export function movieShelves(
  db: Database.Database,
  opts: { sourceId?: string; shelves?: number; perShelf?: number; minTitles?: number } = {},
): MovieShelf[] {
  const perShelf = opts.perShelf ?? 20;
  const minTitles = opts.minTitles ?? 6;
  const chosen = listMovieCategories(db, opts.sourceId)
    .filter((category) => category.movie_count >= minTitles && !category.tags.split(" ").some((tag) => HIDDEN_FROM_SHELVES.has(tag)))
    .sort((a, b) => b.movie_count - a.movie_count)
    .slice(0, opts.shelves ?? 12);
  const select = db.prepare(
    `SELECT ${MOVIE_COLUMNS} FROM movies m WHERE m.category_id = ?
     ORDER BY (m.poster_url IS NULL OR m.poster_url = ''), CAST(m.rating AS REAL) DESC, m.rowid LIMIT ?`,
  );
  return chosen.map((category) => ({ category, items: select.all(category.id, perShelf) as MovieRow[] }));
}
