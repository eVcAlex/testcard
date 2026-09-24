import type Database from "better-sqlite3";
import { categoryShown, channelShown } from "../sync/hidden.js";
import { titleKey } from "./homeQueries.js";
import { CHANNEL_COLUMNS, type ChannelRow } from "./queries.js";
import { MOVIE_COLUMNS, type MovieRow } from "./vodQueries.js";
import { SERIES_COLUMNS, type SeriesRow } from "./seriesQueries.js";

export interface SearchResults {
  readonly movies: MovieRow[];
  readonly series: SeriesRow[];
  readonly channels: ChannelRow[];
}

export interface SearchOptions {
  readonly sourceId?: string;
  /** Most results of each kind. */
  readonly perKind?: number;
}

/** Shortest query worth running: one letter would match half the catalogue. */
export const MIN_SEARCH_LENGTH = 2;

/** Each word must start a word in the title: "spid man" finds "Spider-Man". Quoted so punctuation cannot break the query. */
function ftsQuery(text: string): string | null {
  const words = text
    .split(/\s+/)
    .map((word) => word.replace(/["*]/g, ""))
    .filter((word) => word.length > 0);
  return words.length === 0 ? null : words.map((word) => `"${word}"*`).join(" ");
}

/** Divider, junk and adult categories are not searchable, as they are not browsable. */
const visible = (categoryAlias: string) =>
  `(' ' || ${categoryAlias}.tags || ' ') NOT LIKE '% adult %' AND (' ' || ${categoryAlias}.tags || ' ') NOT LIKE '% junk %' AND (' ' || ${categoryAlias}.tags || ' ') NOT LIKE '% separator %'`;

/**
 * One box, everything: films, series and live channels matching what was typed. Best matches first, titles with
 * a poster ahead of those without, the same title in another quality shown once.
 */
export function searchAll(db: Database.Database, query: string, opts: SearchOptions = {}): SearchResults {
  const match = query.trim().length >= MIN_SEARCH_LENGTH ? ftsQuery(query.trim()) : null;
  if (match === null) return { movies: [], series: [], channels: [] };
  const perKind = opts.perKind ?? 24;
  const spare = perKind * 5;
  const scope = (alias: string) => (opts.sourceId !== undefined ? ` AND ${alias}.source_id = @source` : "");
  const params = { match, ...(opts.sourceId !== undefined ? { source: opts.sourceId } : {}) };

  const movies = db
    .prepare(
      `SELECT ${MOVIE_COLUMNS}
       FROM movies_fts JOIN movies m ON m.rowid = movies_fts.rowid JOIN movie_categories c ON c.id = m.category_id
       WHERE movies_fts MATCH @match AND ${visible("c")} AND ${categoryShown(db, "c", "movies")}${scope("m")}
       ORDER BY (m.poster_url IS NULL OR m.poster_url = ''), rank LIMIT ${spare}`,
    )
    .all(params) as MovieRow[];
  const series = db
    .prepare(
      `SELECT ${SERIES_COLUMNS}
       FROM series_fts JOIN series sr ON sr.rowid = series_fts.rowid JOIN series_categories c ON c.id = sr.category_id
       WHERE series_fts MATCH @match AND ${visible("c")} AND ${categoryShown(db, "c", "series")}${scope("sr")}
       ORDER BY (sr.poster_url IS NULL OR sr.poster_url = ''), rank LIMIT ${spare}`,
    )
    .all(params) as SeriesRow[];
  const channels = db
    .prepare(
      `SELECT ${CHANNEL_COLUMNS}
       FROM channels_fts JOIN channels c ON c.rowid = channels_fts.rowid JOIN categories cat ON cat.id = c.category_id
       WHERE channels_fts MATCH @match AND ${visible("cat")} AND ${channelShown(db, "c")}${scope("c")}
       ORDER BY rank LIMIT ${spare}`,
    )
    .all(params) as ChannelRow[];

  return {
    movies: once(movies, (movie) => titleKey(movie.name), perKind),
    series: once(series, (show) => titleKey(show.name), perKind),
    channels: once(channels, (channel) => channel.normalised_name.toLowerCase(), perKind),
  };
}

function once<T>(rows: readonly T[], keyOf: (row: T) => string, limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length === limit) break;
  }
  return out;
}
