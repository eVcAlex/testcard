import type Database from "better-sqlite3";
import { GENRE_LABELS } from "../normalise/genres.js";
import { splitTitle } from "../normalise/splitTitle.js";
import { MOVIE_COLUMNS, type MovieRow } from "./vodQueries.js";
import { SERIES_COLUMNS, type SeriesRow } from "./seriesQueries.js";

/** One row on the Movies or Series landing page. */
export interface HomeShelf<T> {
  readonly key: string;
  readonly label: string;
  readonly items: T[];
}

export interface HomeOptions {
  readonly sourceId?: string;
  /** Titles per row. */
  readonly perShelf?: number;
  /** How many genre rows follow "Recently added" and "Top rated". */
  readonly genres?: number;
  /** A row with fewer titles than this (after de-duplication) is left out. */
  readonly minTitles?: number;
  /** The viewer's language, ISO 639-1 ("en"). Categories labelled with a different language stay off the page; unlabelled and multi-language ones stay on. */
  readonly language?: string;
  /** The current year. Enables the "this year" rows, which go by the year in each title, newest first. */
  readonly year?: number;
}

/**
 * Regions the landing page steers away from: categories whose name says they are Asian catalogues. This is
 * only the shop window. Browse all still lists every category, so nothing is hidden from the viewer.
 */
const AVOID_NAMES = ["asia", "chinese", "korean", "japan", "bollywood", "hindi", "thai", "anime", "crunchyroll"];

interface Kind {
  readonly table: "movies" | "series";
  readonly alias: string;
  readonly categories: "movie_categories" | "series_categories";
  readonly columns: string;
}

const MOVIES: Kind = { table: "movies", alias: "m", categories: "movie_categories", columns: MOVIE_COLUMNS };
const SERIES: Kind = { table: "series", alias: "sr", categories: "series_categories", columns: SERIES_COLUMNS };

/** Over-fetch by this much, since duplicates (quality variants of one title) are dropped afterwards. */
const SPARE = 5;

/** The same title in another quality or category: lower-cased, punctuation and the catalogue tag gone. */
export function titleKey(name: string): string {
  const { title, year } = splitTitle(name);
  return `${title.toLowerCase().replace(/[^a-z0-9À-￿]+/g, " ").trim()}|${year ?? ""}`;
}

function build<T extends { readonly id: string; readonly name: string }>(db: Database.Database, kind: Kind, opts: HomeOptions): HomeShelf<T>[] {
  const perShelf = opts.perShelf ?? 16;
  const minTitles = opts.minTitles ?? 6;
  const a = kind.alias;
  // Only titles with a poster, and never divider, junk or adult categories: this page is the shop window.
  const clean = [
    `${a}.poster_url IS NOT NULL AND ${a}.poster_url != ''`,
    `(' ' || c.tags || ' ') NOT LIKE '% adult %' AND (' ' || c.tags || ' ') NOT LIKE '% junk %' AND (' ' || c.tags || ' ') NOT LIKE '% separator %'`,
    ...AVOID_NAMES.map((word) => `lower(c.raw_name) NOT LIKE '%${word}%'`),
    ...(opts.language !== undefined ? [`(c.language IS NULL OR c.language = 'multi' OR c.language = @language)`] : []),
    ...(opts.sourceId !== undefined ? [`${a}.source_id = @source`] : []),
  ];
  const params = { ...(opts.sourceId !== undefined ? { source: opts.sourceId } : {}), ...(opts.language !== undefined ? { language: opts.language } : {}) };
  const from = `FROM ${kind.table} ${a} JOIN ${kind.categories} c ON c.id = ${a}.category_id`;
  // A perfect 10 is almost always a title with a single vote, so it says nothing about quality.
  const rated = `CAST(${a}.rating AS REAL) > 0 AND CAST(${a}.rating AS REAL) < 9.9`;

  // One title shows once on the whole page, so the genre rows do not repeat what Top rated already showed.
  const seen = new Set<string>();
  const take = (rows: T[]): T[] => {
    const out: T[] = [];
    for (const row of rows) {
      const key = titleKey(row.name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
      if (out.length === perShelf) break;
    }
    return out;
  };
  const shelves: HomeShelf<T>[] = [];
  const add = (key: string, label: string, rows: T[]) => {
    const items = take(rows);
    if (items.length >= minTitles) shelves.push({ key, label, items });
    else for (const item of items) seen.delete(titleKey(item.name));
  };
  const limit = perShelf * SPARE;

  const ratedOrder = `CAST(${a}.rating AS REAL) DESC, ${a}.rowid`;
  // Providers put the release year in the title, "Heat (2025)". That is what "new" means here: not when the provider
  // happened to add it, which for a fresh import is everything at once.
  const years = opts.year !== undefined ? [Math.trunc(opts.year), Math.trunc(opts.year) - 1] : [];
  const inYears = `(${years.map((year) => `${a}.name LIKE '%(${year})%'`).join(" OR ")})`;
  const newestFirst = `CASE ${years.map((year, index) => `WHEN ${a}.name LIKE '%(${year})%' THEN ${years.length - index}`).join(" ")} ELSE 0 END DESC, ${a}.first_seen_at DESC, ${a}.rowid DESC`;
  const pick = (extra: string[], order: string) => db.prepare(`SELECT ${kind.columns} ${from} WHERE ${[...clean, ...extra].join(" AND ")} ORDER BY ${order} LIMIT ${limit}`).all(params) as T[];

  if (years.length > 0) {
    add("top", "Top 10 this year", pick([rated, inYears], ratedOrder));
    add("new", "New releases", pick([inYears], newestFirst));
    add("rated", "Top rated", pick([rated], ratedOrder));
  } else {
    add("top", "Top rated", pick([rated], ratedOrder));
  }

  const genres = db
    .prepare(`SELECT c.genre AS genre, COUNT(*) AS n ${from} WHERE ${[...clean, "c.genre IS NOT NULL"].join(" AND ")} GROUP BY c.genre ORDER BY n DESC`)
    .all(params) as { genre: string; n: number }[];
  let genreShelves = 0;
  for (const { genre } of genres) {
    const label = GENRE_LABELS[genre];
    if (label === undefined) continue;
    if (genreShelves === (opts.genres ?? 8)) break;
    const before = shelves.length;
    add(
      `genre:${genre}`,
      label,
      db
        .prepare(`SELECT ${kind.columns} ${from} WHERE ${[...clean, "c.genre = @genre"].join(" AND ")} ORDER BY (CAST(${a}.rating AS REAL) > 0) DESC, CAST(${a}.rating AS REAL) DESC, ${a}.rowid LIMIT ${limit}`)
        .all({ ...params, genre }) as T[],
    );
    if (shelves.length > before) genreShelves += 1;
  }
  return shelves;
}

/** The Movies landing page's rows: Top rated, Recently added, then a row per genre. Cheap enough to run once per sync. */
export function movieHome(db: Database.Database, opts: HomeOptions = {}): HomeShelf<MovieRow>[] {
  return build<MovieRow>(db, MOVIES, opts);
}

/** The Series landing page's rows; see `movieHome`. */
export function seriesHome(db: Database.Database, opts: HomeOptions = {}): HomeShelf<SeriesRow>[] {
  return build<SeriesRow>(db, SERIES, opts);
}
