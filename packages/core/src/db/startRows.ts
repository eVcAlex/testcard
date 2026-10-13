import type Database from "better-sqlite3";
import { categoryDisplayName } from "../normalise/displayName.js";
import { shouldPromptResume } from "../playback/progressPolicy.js";
import { listHomePins, type PinKind } from "../sync/sourcePins.js";
import { listWatchedLately } from "./homeQueries.js";
import { browseChannels, listFavouriteChannels, listRecentChannels, type ChannelRow } from "./queries.js";
import { browseSeries, getUpNextEpisodes, listFavouriteSeries, listRecentSeries, seriesShelves, type SeriesRow } from "./seriesQueries.js";
import { browseMovies, listFavouriteMovies, listRecentMovies, movieShelves, type MovieRow } from "./vodQueries.js";

/** One poster or channel card on the Home tab. Ids are only unique within their `kind`. */
export interface StartItem {
  readonly kind: "movie" | "series" | "channel";
  readonly id: string;
  readonly name: string;
  readonly imageUrl: string | null;
  /** How far through, 0 to 1, for a started film or episode. */
  readonly progress: number | null;
  /** A line under the title: "S2 E4", "Next · S1 E1", "1h 5m left". */
  readonly note: string | null;
  readonly resume: boolean;
  /** The row a channel card needs to be played from. */
  readonly channel?: ChannelRow;
}

export interface StartRow {
  readonly key: string;
  readonly label: string;
  /** A category the viewer pinned to Home. */
  readonly pinned: boolean;
  readonly items: readonly StartItem[];
}

const PIN_TABLE = { live: "categories", movies: "movie_categories", series: "series_categories" } as const satisfies Record<PinKind, string>;

const left = (secs: number): string => {
  const minutes = Math.round(secs / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m left` : `${minutes}m left`;
};

const movieItem = (movie: MovieRow, continuing = false): StartItem => {
  const resume = movie.position_secs !== null && movie.watched !== 1 && shouldPromptResume(movie.position_secs, movie.duration_secs);
  const total = movie.duration_secs;
  const progress = resume && total !== null && total > 0 ? (movie.position_secs as number) / total : null;
  const remaining = continuing && resume && total !== null ? total - (movie.position_secs as number) : 0;
  return { kind: "movie", id: movie.id, name: movie.name, imageUrl: movie.poster_url, progress, note: remaining >= 60 ? left(remaining) : null, resume };
};

const seriesItem = (series: SeriesRow, next?: { label: string; progress: number | null; resume: boolean }): StartItem => ({
  kind: "series",
  id: series.id,
  name: series.name,
  imageUrl: series.poster_url,
  progress: next?.progress ?? null,
  note: next?.label ?? null,
  resume: next?.resume ?? false,
});

const channelItem = (channel: ChannelRow): StartItem => ({
  kind: "channel",
  id: channel.id,
  name: channel.normalised_name,
  imageUrl: channel.logo_url,
  progress: null,
  note: null,
  resume: false,
  channel,
});

/**
 * What the Home tab shows: where you left off, your lists, categories pinned from the rails, and what is new.
 * The same rows as the TV and phone Home (`HomeModel.kt`, `Start.tsx`).
 */
export function buildStartRows(db: Database.Database, sourceId: string | null): StartRow[] {
  const own = <T extends { source_id: string }>(row: T): boolean => sourceId === null || row.source_id === sourceId;
  const rows: StartRow[] = [];
  const add = (key: string, label: string, items: readonly StartItem[], pinned = false): void => {
    if (items.length > 0) rows.push({ key, label, pinned, items });
  };

  // One row for what you were last watching, films and shows together, the most recent first; films only while unfinished.
  const recentMovies = new Map(listRecentMovies(db, 60).filter(own).map((movie) => [movie.id, movie]));
  const recentSeries = new Map(listRecentSeries(db, 60).filter(own).map((show) => [show.id, show]));
  const lately = listWatchedLately(db, 60);
  const upNext = getUpNextEpisodes(db, lately.filter((entry) => entry.kind === "series" && recentSeries.has(entry.id)).map((entry) => entry.id));
  const continuing: StartItem[] = [];
  for (const entry of lately) {
    if (entry.kind === "movie") {
      const movie = recentMovies.get(entry.id);
      if (movie === undefined) continue;
      const item = movieItem(movie, true);
      if (item.resume) continuing.push(item);
    } else {
      const show = recentSeries.get(entry.id);
      if (show === undefined) continue;
      const next = upNext.get(show.id);
      continuing.push(
        seriesItem(
          show,
          next === undefined
            ? undefined
            : {
                label: next.resume ? `S${next.seasonNumber} E${next.episodeNumber}` : `Next · S${next.seasonNumber} E${next.episodeNumber}`,
                progress: next.resume && next.positionSecs !== null && next.durationSecs !== null && next.durationSecs > 0 ? next.positionSecs / next.durationSecs : null,
                resume: next.resume,
              },
        ),
      );
    }
  }
  add("continue", "Continue watching", continuing.slice(0, 30));
  add("recent-channels", "Recently watched channels", listRecentChannels(db, 60).filter(own).slice(0, 30).map(channelItem));
  add("my-list", "My list", [...listFavouriteMovies(db).filter(own).map((movie) => movieItem(movie)), ...listFavouriteSeries(db).filter(own).map((show) => seriesItem(show))].slice(0, 30));
  add("favourite-channels", "Favourite channels", listFavouriteChannels(db).filter(own).slice(0, 30).map(channelItem));

  // Categories pinned from the rails, in the order they were pinned. A pin whose category is not imported here yet waits.
  for (const pin of listHomePins(db)) {
    if (pin.categoryId === null || (sourceId !== null && pin.sourceId !== sourceId)) continue;
    // Titled from the category as it is now, through the same tidying as everywhere else, not the label saved when it was pinned.
    const raw = db.prepare(`SELECT raw_name AS name FROM ${PIN_TABLE[pin.kind]} WHERE id = ?`).get(pin.categoryId) as { name: string } | undefined;
    const label = raw !== undefined ? categoryDisplayName(raw.name) : pin.label;
    const key = `pin:${pin.sourceId}:${pin.kind}:${pin.key}`;
    if (pin.kind === "live") add(key, label, browseChannels(db, { categoryId: pin.categoryId, limit: 24 }).map(channelItem), true);
    else if (pin.kind === "movies") add(key, label, browseMovies(db, { categoryId: pin.categoryId, limit: 30 }).map((movie) => movieItem(movie)), true);
    else add(key, label, browseSeries(db, { categoryId: pin.categoryId, limit: 30 }).map((show) => seriesItem(show)), true);
  }

  // The landing shelves are the best-rated of the biggest categories, not a "new" or "top" list, so one row each.
  const shelfOpts = sourceId !== null ? { sourceId, shelves: 2, perShelf: 20 } : { shelves: 2, perShelf: 20 };
  for (const shelf of movieShelves(db, shelfOpts)) add(`movies:${shelf.category.id}`, categoryDisplayName(shelf.category.name), shelf.items.map((movie) => movieItem(movie)));
  for (const shelf of seriesShelves(db, shelfOpts)) add(`series:${shelf.category.id}`, categoryDisplayName(shelf.category.name), shelf.items.map((show) => seriesItem(show)));
  return rows;
}
