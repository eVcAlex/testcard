import type Database from "better-sqlite3";
import type { Source } from "../source/types.js";

export interface SeriesRow {
  readonly id: string;
  readonly source_id: string;
  readonly category_id: string;
  readonly name: string;
  readonly poster_url: string | null;
  readonly rating: string | null;
  readonly plot: string | null;
  readonly episodes_fetched_at: number | null;
  readonly is_favourite: 0 | 1;
}

const SERIES_COLUMNS = `sr.id, sr.source_id, sr.category_id, sr.name, sr.poster_url, sr.rating, sr.plot, sr.episodes_fetched_at,
  (SELECT 1 FROM series_favourites f WHERE f.series_id = sr.id) IS NOT NULL AS is_favourite`;

export function searchSeries(db: Database.Database, query: string, limit = 200, sourceId?: string): SeriesRow[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const ftsQuery = trimmed.split(/\s+/).map((token) => `${token.replace(/["*]/g, "")}*`).join(" ");
  return db
    .prepare(
      `SELECT ${SERIES_COLUMNS}
       FROM series_fts
       JOIN series sr ON sr.rowid = series_fts.rowid
       WHERE series_fts MATCH ?${sourceId !== undefined ? " AND sr.source_id = ?" : ""}
       ORDER BY rank
       LIMIT ?`,
    )
    .all(...(sourceId !== undefined ? [ftsQuery, sourceId] : [ftsQuery]), limit) as SeriesRow[];
}

export function browseSeries(
  db: Database.Database,
  opts: { categoryId?: string; sourceId?: string; genre?: string; limit?: number; offset?: number } = {},
): SeriesRow[] {
  const limit = opts.limit ?? 300;
  const offset = opts.offset ?? 0;
  const clauses: string[] = [];
  const filters: unknown[] = [];
  if (opts.categoryId !== undefined) {
    clauses.push("sr.category_id = ?");
    filters.push(opts.categoryId);
  }
  if (opts.sourceId !== undefined) {
    clauses.push("sr.source_id = ?");
    filters.push(opts.sourceId);
  }
  if (opts.genre !== undefined) {
    clauses.push("sr.category_id IN (SELECT id FROM series_categories WHERE genre = ?)");
    filters.push(opts.genre);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(`SELECT ${SERIES_COLUMNS} FROM series sr ${where} ORDER BY sr.rowid LIMIT ? OFFSET ?`)
    .all(...filters, limit, offset) as SeriesRow[];
}

export interface SeriesCategoryRow {
  readonly id: string;
  readonly name: string;
  readonly country: string | null;
  readonly series_count: number;
  /** Advisory classification (see normalise/classifyCategory.ts): null/'' when unrecognised. */
  readonly genre: string | null;
  readonly language: string | null;
  readonly service: string | null;
  readonly tags: string;
}

export function listSeriesCategories(db: Database.Database, sourceId?: string): SeriesCategoryRow[] {
  return db
    .prepare(
      `SELECT cat.id, cat.raw_name AS name, cat.country, cat.genre, cat.language, cat.service, cat.tags, COUNT(sr.id) AS series_count
       FROM series_categories cat
       JOIN series sr ON sr.category_id = cat.id
       ${sourceId !== undefined ? "WHERE cat.source_id = ?" : ""}
       GROUP BY cat.id
       ORDER BY cat.rowid`,
    )
    .all(...(sourceId !== undefined ? [sourceId] : [])) as SeriesCategoryRow[];
}

export function listFavouriteSeries(db: Database.Database): SeriesRow[] {
  return db
    .prepare(`SELECT ${SERIES_COLUMNS} FROM series_favourites f JOIN series sr ON sr.id = f.series_id ORDER BY f.added_at DESC`)
    .all() as SeriesRow[];
}

export function listRecentSeries(db: Database.Database, limit = 24): SeriesRow[] {
  return db
    .prepare(`SELECT ${SERIES_COLUMNS} FROM series_recents r JOIN series sr ON sr.id = r.series_id ORDER BY r.played_at DESC LIMIT ?`)
    .all(limit) as SeriesRow[];
}

export function toggleSeriesFavourite(db: Database.Database, seriesId: string): boolean {
  const existing = db.prepare(`SELECT 1 FROM series_favourites WHERE series_id = ?`).get(seriesId);
  if (existing) {
    const row = db.prepare(`SELECT remote_key FROM series_favourites WHERE series_id = ?`).get(seriesId) as { remote_key: string | null };
    db.prepare(`DELETE FROM series_favourites WHERE series_id = ?`).run(seriesId);
    if (row.remote_key !== null) {
      db.prepare(`INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) VALUES ('series_favourites', ?, ?)`).run(row.remote_key, Date.now());
    }
    return false;
  }
  const series = db.prepare(`SELECT remote_key FROM series WHERE id = ?`).get(seriesId) as { remote_key: string | null } | undefined;
  db.prepare(`INSERT INTO series_favourites (series_id, added_at, remote_key, updated_at) VALUES (?, ?, ?, ?)`).run(
    seriesId,
    Date.now(),
    series?.remote_key ?? null,
    Date.now(),
  );
  return true;
}

/** Bumped on any episode play, not just a series-level "play" action (there isn't one). */
export function recordSeriesRecent(db: Database.Database, seriesId: string): void {
  const series = db.prepare(`SELECT remote_key FROM series WHERE id = ?`).get(seriesId) as { remote_key: string | null } | undefined;
  db.prepare(
    `INSERT INTO series_recents (series_id, played_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(series_id) DO UPDATE SET played_at = excluded.played_at, remote_key = excluded.remote_key, updated_at = excluded.updated_at`,
  ).run(seriesId, Date.now(), series?.remote_key ?? null, Date.now());
}

export interface SeasonRow {
  readonly id: string;
  readonly series_id: string;
  readonly season_number: number;
  readonly name: string | null;
  readonly poster_url: string | null;
}

export interface EpisodeRow {
  readonly id: string;
  readonly season_id: string;
  readonly series_id: string;
  readonly episode_number: number;
  readonly name: string;
  readonly container_extension: string | null;
  readonly duration_secs: number | null;
  readonly plot: string | null;
  readonly position_secs: number | null;
  readonly watched: 0 | 1;
}

export interface SeasonWithEpisodes extends SeasonRow {
  readonly episodes: readonly EpisodeRow[];
}

export interface SeriesDetail {
  readonly series: SeriesRow;
  readonly seasons: readonly SeasonWithEpisodes[];
}

const EPISODE_COLUMNS = `e.id, e.season_id, e.series_id, e.episode_number, e.name, e.container_extension,
  COALESCE(e.duration_secs, (SELECT duration_secs FROM playback_progress pp WHERE pp.item_type = 'episode' AND pp.item_id = e.id)) AS duration_secs,
  e.plot,
  (SELECT position_secs FROM playback_progress pp WHERE pp.item_type = 'episode' AND pp.item_id = e.id) AS position_secs,
  COALESCE((SELECT watched FROM playback_progress pp WHERE pp.item_type = 'episode' AND pp.item_id = e.id), 0) AS watched`;

/**
 * A series with its seasons and episodes, nested for direct rendering by `SeriesView`. Caller
 * (the `series.episodes` IPC handler) is responsible for calling `ensureSeriesEpisodes` first
 * so this reads fresh data for a series opened for the first time since its last refresh.
 */
export function getSeriesDetail(db: Database.Database, seriesId: string): SeriesDetail | undefined {
  const series = db.prepare(`SELECT ${SERIES_COLUMNS} FROM series sr WHERE sr.id = ?`).get(seriesId) as SeriesRow | undefined;
  if (!series) return undefined;

  const seasons = db
    .prepare(`SELECT id, series_id, season_number, name, poster_url FROM seasons WHERE series_id = ? ORDER BY season_number`)
    .all(seriesId) as SeasonRow[];

  const episodesBySeason = db.prepare(`SELECT ${EPISODE_COLUMNS} FROM episodes e WHERE e.season_id = ? ORDER BY e.episode_number`);

  return {
    series,
    seasons: seasons.map((season) => ({ ...season, episodes: episodesBySeason.all(season.id) as EpisodeRow[] })),
  };
}

/** Resolves a series id to its source, for the `series.episodes` IPC handler's lazy-fetch gate. */
export function getSeriesSource(db: Database.Database, seriesId: string): Source | undefined {
  const row = db
    .prepare(
      `SELECT s.id, s.kind, s.name, s.base_url AS baseUrl
       FROM sources s
       JOIN series sr ON sr.source_id = s.id
       WHERE sr.id = ?`,
    )
    .get(seriesId) as { id: string; kind: "xtream" | "m3u"; name: string; baseUrl: string | null } | undefined;
  if (!row) return undefined;
  return row.kind === "xtream"
    ? { id: row.id, kind: "xtream", name: row.name, baseUrl: row.baseUrl ?? "" }
    : { id: row.id, kind: "m3u", name: row.name, playlistUrl: "" };
}

/** Everything the main process needs to build an episode's playable stream URL. */
export interface EpisodePlaybackTarget {
  readonly episodeId: string;
  readonly episodeName: string;
  readonly seriesId: string;
  readonly providerEpisodeId: string;
  readonly containerExtension: string | null;
  /** The catalog's `episodes.duration_secs` — filled in bulk by `ensureSeriesEpisodes`. */
  readonly durationSecs: number | null;
  readonly source: Source;
}

export function getEpisodePlaybackTarget(db: Database.Database, episodeId: string): EpisodePlaybackTarget | undefined {
  const row = db
    .prepare(
      `SELECT e.id AS episodeId, e.name AS episodeName, e.series_id AS seriesId, e.provider_episode_id AS providerEpisodeId,
              e.container_extension AS containerExtension, e.duration_secs AS durationSecs,
              s.id AS sourceId, s.kind AS kind, s.name AS sourceName, s.base_url AS baseUrl
       FROM episodes e
       JOIN series sr ON sr.id = e.series_id
       JOIN sources s ON s.id = sr.source_id
       WHERE e.id = ?`,
    )
    .get(episodeId) as
    | {
        episodeId: string;
        episodeName: string;
        seriesId: string;
        providerEpisodeId: string;
        containerExtension: string | null;
        durationSecs: number | null;
        sourceId: string;
        kind: "xtream" | "m3u";
        sourceName: string;
        baseUrl: string | null;
      }
    | undefined;
  if (!row) return undefined;

  const source: Source =
    row.kind === "xtream"
      ? { id: row.sourceId, kind: "xtream", name: row.sourceName, baseUrl: row.baseUrl ?? "" }
      : { id: row.sourceId, kind: "m3u", name: row.sourceName, playlistUrl: "" };

  return {
    episodeId: row.episodeId,
    episodeName: row.episodeName,
    seriesId: row.seriesId,
    providerEpisodeId: row.providerEpisodeId,
    containerExtension: row.containerExtension,
    durationSecs: row.durationSecs,
    source,
  };
}

export interface SeriesShelf {
  readonly category: SeriesCategoryRow;
  readonly items: SeriesRow[];
}

/** Category tags that mark a row as not worth a landing-page shelf (adult is still browsable by name). */
const HIDDEN_FROM_SHELVES: ReadonlySet<string> = new Set(["junk", "separator", "adult"]);

/** The landing page's category rows for series; see `movieShelves` for the selection and ordering. */
export function seriesShelves(
  db: Database.Database,
  opts: { sourceId?: string; shelves?: number; perShelf?: number; minTitles?: number } = {},
): SeriesShelf[] {
  const perShelf = opts.perShelf ?? 20;
  const minTitles = opts.minTitles ?? 6;
  const chosen = listSeriesCategories(db, opts.sourceId)
    .filter((category) => category.series_count >= minTitles && !category.tags.split(" ").some((tag) => HIDDEN_FROM_SHELVES.has(tag)))
    .sort((a, b) => b.series_count - a.series_count)
    .slice(0, opts.shelves ?? 12);
  const select = db.prepare(
    `SELECT ${SERIES_COLUMNS} FROM series sr WHERE sr.category_id = ?
     ORDER BY (sr.poster_url IS NULL OR sr.poster_url = ''), CAST(sr.rating AS REAL) DESC, sr.rowid LIMIT ?`,
  );
  return chosen.map((category) => ({ category, items: select.all(category.id, perShelf) as SeriesRow[] }));
}
