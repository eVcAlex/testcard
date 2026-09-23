import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dedupeTitles } from "@testcard/core/src/normalise/titleKey.js";
import { BackHandler, View } from "react-native";
import { categoryLabel } from "@testcard/core/src/normalise/categoryLabel.js";
import { movieHome, seriesHome } from "@testcard/core/src/db/homeQueries.js";
import { ensureMovieDetails } from "@testcard/core/src/db/importVodDetails.js";
import { getCredentials } from "../platform/secrets";
import { browseMovies, getMovieById, getMoviePlaybackTarget, listFavouriteMovies, listMovieCategories, listRecentMovies, toggleMovieFavourite, type MovieRow } from "@testcard/core/src/db/vodQueries.js";
import { browseSeries, getUpNextEpisode, listFavouriteSeries, listRecentSeries, listSeriesCategories, removeSeriesFromRecents, toggleSeriesFavourite, type SeriesRow } from "@testcard/core/src/db/seriesQueries.js";
import { shouldPromptResume } from "@testcard/core/src/playback/progressPolicy.js";
import { useApp } from "../state/app";
import { episodeTitle, seriesTitle } from "../ui/titles";
import { colors, type, styleSheet } from "../theme";
import { memoByVersion } from "../state/memoByVersion";
import { makePinning } from "./pinning";
import { BrowseScreen, type BrowseItem, type BrowseSource } from "./Browse";
import { HomeSkeleton } from "../ui/HomeSkeleton";
import { HomeScreen, type HeroActions, type HomeItem, type HomeRow } from "./Home";

/** Category tags that are dividers or decoration rather than something to browse (adult ones stay out of the way too). */
/** Providers write quality tags in superscript letters ("⁴ᴷ ³⁸⁴⁰ᴾ"); NFKC turns them into ordinary text. */
const tidy = (name: string) => categoryLabel(name.normalize("NFKC"));
const hidden = (tags: string) => tags.split(" ").some((tag) => tag === "junk" || tag === "separator" || tag === "adult");

const toMovieItem = (movie: MovieRow): BrowseItem => ({
  id: movie.id,
  title: movie.name,
  imageUrl: movie.poster_url,
  progress: movie.position_secs !== null && movie.duration_secs !== null && movie.duration_secs > 0 ? movie.position_secs / movie.duration_secs : null,
  resume: movie.position_secs !== null && shouldPromptResume(movie.position_secs, movie.duration_secs),
  watched: movie.watched === 1,
});
const toSeriesItem = (series: SeriesRow): BrowseItem => ({ id: series.id, title: series.name, imageUrl: series.poster_url });

// Counting every category walks the whole catalogue, so it is done once per sync rather than on every visit.
const movieCategories = memoByVersion((db: Parameters<typeof listMovieCategories>[0], sourceId?: string) =>
  listMovieCategories(db, sourceId)
    .filter((category) => !hidden(category.tags))
    .map((category) => ({ id: category.id, label: tidy(category.name), count: category.movie_count, genre: category.genre })),
);
const seriesCategories = memoByVersion((db: Parameters<typeof listSeriesCategories>[0], sourceId?: string) =>
  listSeriesCategories(db, sourceId)
    .filter((category) => !hidden(category.tags))
    .map((category) => ({ id: category.id, label: tidy(category.name), count: category.series_count, genre: category.genre })),
);

/** Every category the provider ships, with continue watching and my list first. Selecting a poster opens the film's page. */
function MoviesBrowse({ sourceId, onOpen }: { sourceId: string | null; onOpen: (movie: { id: string; title: string }) => void }) {
  const { db, version, catalogue, sync } = useApp();
  const source = useMemo<BrowseSource>(() => {
    const scope = sourceId !== null ? { sourceId } : {};
    const categories = movieCategories(db, catalogue, sourceId ?? undefined);
    const own = (movie: { source_id: string }) => sourceId === null || movie.source_id === sourceId;
    const history = listRecentMovies(db, 60).filter(own);
    const continuing = history.filter((movie) => movie.position_secs !== null && movie.watched !== 1 && shouldPromptResume(movie.position_secs, movie.duration_secs));
    const myList = listFavouriteMovies(db).filter(own);
    // A title the provider files twice (another quality, a "TOP" list) shows once; the film's page offers the others.
    const once = <T extends { name: string }>(rows: T[], limit: number) => dedupeTitles(rows, limit);
    return {
      layout: "poster",
      pinning: makePinning(db, sync, "movies"),
      noun: "movies",
      single: "movie",
      specials: [
        { key: "continue", label: "Continue watching", count: continuing.length },
        { key: "my-list", label: "My list", count: myList.length },
        { key: "all", label: "All movies", count: categories.reduce((total, category) => total + category.count, 0) },
      ],
      categories,
      load: (selection, limit) => {
        if (selection.kind === "category") return once(browseMovies(db, { categoryId: selection.key, limit: limit * 2, ...scope }), limit).map(toMovieItem);
        if (selection.kind === "genre") return once(browseMovies(db, { genre: selection.key, limit: limit * 2, ...scope }), limit).map(toMovieItem);
        if (selection.key === "continue") return continuing.map(toMovieItem);
        if (selection.key === "my-list") return myList.slice(0, limit).map(toMovieItem);
        return once(browseMovies(db, { limit: limit * 2, ...scope }), limit).map(toMovieItem);
      },
    };
  }, [db, version, catalogue, sourceId, sync]);

  return (
    <BrowseScreen
      source={source}
      empty={sourceId !== null ? "Nothing from this source. Use the Source button at the top right to switch." : "Sign in to the account your computer uses and its sources will load here. Open Sources to see progress."}
      onSelect={(item) => onOpen({ id: item.id, title: item.title })}
    />
  );
}

/** Every category, with my list first. Selecting a poster opens its episodes. */
function SeriesBrowse({ sourceId, onOpen }: { sourceId: string | null; onOpen: (series: { id: string; title: string }) => void }) {
  const { db, version, catalogue, sync } = useApp();
  const source = useMemo<BrowseSource>(() => {
    const scope = sourceId !== null ? { sourceId } : {};
    const categories = seriesCategories(db, catalogue, sourceId ?? undefined);
    const myList = listFavouriteSeries(db).filter((show) => sourceId === null || show.source_id === sourceId);
    const once = <T extends { name: string }>(rows: T[], limit: number) => dedupeTitles(rows, limit);
    return {
      layout: "poster",
      pinning: makePinning(db, sync, "series"),
      noun: "series",
      single: "series",
      specials: [
        { key: "my-list", label: "My list", count: myList.length },
        { key: "all", label: "All series", count: categories.reduce((total, category) => total + category.count, 0) },
      ],
      categories,
      load: (selection, limit) => {
        if (selection.kind === "category") return once(browseSeries(db, { categoryId: selection.key, limit: limit * 2, ...scope }), limit).map(toSeriesItem);
        if (selection.kind === "genre") return once(browseSeries(db, { genre: selection.key, limit: limit * 2, ...scope }), limit).map(toSeriesItem);
        if (selection.key === "my-list") return myList.slice(0, limit).map(toSeriesItem);
        return once(browseSeries(db, { limit: limit * 2, ...scope }), limit).map(toSeriesItem);
      },
    };
  }, [db, version, catalogue, sourceId, sync]);

  return (
    <BrowseScreen
      source={source}
      empty={sourceId !== null ? "Nothing from this source. Use the Source button at the top right to switch." : "Sign in to the account your computer uses and its sources will load here. Open Sources to see progress."}
      onSelect={(item) => onOpen({ id: item.id, title: item.title })}
    />
  );
}

export type AppDb = ReturnType<typeof useApp>["db"];
type Memo<T> = ReturnType<typeof memoByVersion<AppDb, T>>;

// The landing rows read a lot of the catalogue, so they are built once per sync, and after the screen's first paint.
/** The device's language ("en"), so the landing page leans towards titles the viewer can follow. */
const deviceLanguage = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.split(/[-_]/)[0]?.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
})();
const homeOptions = (sourceId?: string) => ({
  ...(sourceId !== undefined ? { sourceId } : {}),
  ...(deviceLanguage !== undefined ? { language: deviceLanguage } : {}),
  year: new Date().getFullYear(),
});
export const movieRows = memoByVersion((db: AppDb, sourceId?: string) => movieHome(db, homeOptions(sourceId)));
export const seriesRows = memoByVersion((db: AppDb, sourceId?: string) => seriesHome(db, homeOptions(sourceId)));

/**
 * The remembered rows straight away when there are some, otherwise null until they have been built. `catalogue` is
 * the catalogue's stamp, so only an import rebuilds them. When it changes, the old rows stay up while the new ones
 * are built (blanking the page would flash a loading screen and throw the viewer back to the top); only switching
 * source starts from nothing. The build waits until the screen is idle, since it holds up the remote while it runs.
 */
export function useBuilt<T>(memo: Memo<T>, db: AppDb, catalogue: string, sourceId: string | null, remember?: string): T | null {
  const key = sourceId ?? undefined;
  // Across launches: the rows built last time, for the same catalogue, are used as they are and not built again.
  // Rows from an older catalogue are shown at once, then replaced when the fresh ones are ready.
  const persisted = remember !== undefined && key === undefined;
  const [value, setValue] = useState<T | null>(() => {
    const hit = memo.cached(db, catalogue, key);
    if (hit !== undefined) return hit;
    const kept = persisted ? readRemembered<T>(db, remember) : undefined;
    if (kept !== undefined && kept.catalogue === catalogue) {
      memo.prime(db, catalogue, key, kept.rows);
      return kept.rows;
    }
    return memo.stale(db, key) ?? kept?.rows ?? null;
  });
  const builtFor = useRef(key);
  useEffect(() => {
    const hit = memo.cached(db, catalogue, key);
    if (hit !== undefined) {
      builtFor.current = key;
      setValue(hit);
      return;
    }
    if (builtFor.current !== key) {
      builtFor.current = key;
      setValue(null);
    }
    const task = requestIdleCallback(
      () => {
        const built = memo(db, catalogue, key);
        setValue(built);
        if (persisted) writeRemembered(db, remember, { catalogue, rows: built });
      },
      { timeout: 500 },
    );
    return () => cancelIdleCallback(task);
  }, [memo, db, catalogue, key, persisted, remember]);
  return value;
}

/** Rows kept between launches, as JSON in the database's small key/value table. A read that fails just means nothing was kept. */
function readRemembered<T>(db: AppDb, name: string): { catalogue: string; rows: T } | undefined {
  try {
    const row = db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get(`rows:${name}`) as { value: string } | undefined;
    if (row === undefined) return undefined;
    const kept = JSON.parse(row.value) as { catalogue?: unknown; rows?: T } | T;
    // Kept by an older build as the bare rows: shown, but always rebuilt.
    return typeof kept === "object" && kept !== null && "catalogue" in kept && typeof kept.catalogue === "string" ? { catalogue: kept.catalogue, rows: kept.rows as T } : { catalogue: "", rows: kept as T };
  } catch {
    return undefined;
  }
}

function writeRemembered<T>(db: AppDb, name: string, rows: { catalogue: string; rows: T }): void {
  try {
    db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(`rows:${name}`, JSON.stringify(rows));
  } catch {
    // Not worth failing the screen for.
  }
}

/**
 * A section that stays mounted while hidden has not seen what happened elsewhere (something watched, pinned, favourited),
 * so its rows are read again each time it is brought back to the front.
 */
export function useRefreshOnShow(active: boolean, refresh: () => void) {
  const was = useRef(active);
  useEffect(() => {
    if (active && !was.current) refresh();
    was.current = active;
  }, [active, refresh]);
}

/**
 * The data version a mounted section reads by. A hidden section keeps the one it last showed with, so a sync
 * bump does not re-run its queries behind whatever is on screen; being shown again catches it up.
 */
export function useVersionWhileShown(active: boolean, version: number): number {
  const shown = useRef(version);
  if (active) shown.current = version;
  return shown.current;
}

/** Back from the category browser returns to the landing page instead of leaving the section. */
export function useBackTo(active: boolean, back: () => void) {
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      back();
      return true;
    });
    return () => subscription.remove();
  }, [active, back]);
}

/** A landing row from a built shelf. The top shelf becomes a numbered top 10. */
export function shelfRow<T>(shelf: { key: string; label: string; items: T[] }, toItem: (row: T) => HomeItem): HomeRow {
  return shelf.key === "top"
    ? { key: shelf.key, label: shelf.label, items: shelf.items.slice(0, 10).map(toItem), ranked: true }
    : { key: shelf.key, label: shelf.label, items: shelf.items.map(toItem) };
}

export const homeMovie = (movie: MovieRow): HomeItem => ({
  id: movie.id,
  name: movie.name,
  posterUrl: movie.poster_url,
  progress: movie.position_secs !== null && movie.duration_secs !== null && movie.duration_secs > 0 ? movie.position_secs / movie.duration_secs : null,
  watched: movie.watched === 1,
  rating: movie.rating,
  plot: movie.plot,
  durationSecs: movie.duration_secs,
  favourite: movie.is_favourite === 1,
  resume: movie.position_secs !== null && shouldPromptResume(movie.position_secs, movie.duration_secs),
});
export const homeSeries = (series: SeriesRow): HomeItem => ({ id: series.id, name: series.name, posterUrl: series.poster_url, progress: null, rating: series.rating, plot: series.plot, durationSecs: null, favourite: series.is_favourite === 1, resume: false });

/**
 * A series row's primary action: resume or play the episode you were on, falling back to "View
 * episodes" for a series nothing has been watched of yet. Shared by every screen with a series
 * row (Home, the Series landing page) so pressing one actually starts playing.
 */
export function seriesPrimaryAction(
  db: Parameters<typeof getUpNextEpisode>[0],
  item: HomeItem,
  onOpenSeries: (series: { id: string; title: string }) => void,
  onPlayEpisode: (episodeId: string, title: string, resume: boolean, seriesId: string) => void,
): HeroActions["primary"] {
  const upNext = getUpNextEpisode(db, item.id);
  if (upNext === undefined) return { label: "View episodes", onPress: () => onOpenSeries({ id: item.id, title: item.name }) };
  const { episode } = upNext;
  return {
    label: upNext.resume ? "Resume" : "Play",
    onPress: () => onPlayEpisode(episode.id, `${seriesTitle(item.name)} · ${episodeTitle(episode.name)}`, upNext.resume, item.id),
    progress: upNext.resume && episode.position_secs !== null && episode.duration_secs !== null && episode.duration_secs > 0 ? episode.position_secs / episode.duration_secs : undefined,
  };
}

/** Movies: a landing page of rows (continue watching, my list, top rated, recently added, genres). `browsing` (the nav bar's Browse all) shows every category instead. */
export function MoviesScreen({
  sourceId,
  active = true,
  browsing,
  onBrowseDone,
  onOpen,
  onPlay,
}: {
  sourceId: string | null;
  active?: boolean;
  browsing: boolean;
  onBrowseDone: () => void;
  onOpen: (movie: { id: string; title: string }) => void;
  onPlay: (movie: { id: string; title: string }, resume: boolean) => void;
}) {
  const { db, version: latestVersion, catalogue, sync } = useApp();
  const version = useVersionWhileShown(active, latestVersion);
  const [tick, setTick] = useState(0);
  useRefreshOnShow(active, useCallback(() => setTick((value) => value + 1), []));
  useBackTo(browsing, onBrowseDone);
  const shelves = useBuilt(movieRows, db, catalogue, sourceId, "movies");
  const fetchDetail = useCallback(
    async (id: string) => {
      const target = getMoviePlaybackTarget(db, id);
      if (target === undefined || target.source.kind !== "xtream") return null;
      await ensureMovieDetails(db, target.source, id, getCredentials);
      const movie = getMovieById(db, id);
      return movie === undefined ? null : { plot: movie.plot, durationSecs: movie.duration_secs };
    },
    [db],
  );
  const rows = useMemo<HomeRow[] | null>(() => {
    if (shelves === null) return null;
    const own = (movie: { source_id: string }) => sourceId === null || movie.source_id === sourceId;
    const continuing = listRecentMovies(db, 60).filter((movie) => own(movie) && movie.position_secs !== null && movie.watched !== 1 && shouldPromptResume(movie.position_secs, movie.duration_secs));
    const myList = listFavouriteMovies(db).filter(own);
    return [
      ...(continuing.length > 0 ? [{ key: "continue", label: "Continue watching", items: continuing.map(homeMovie) }] : []),
      ...(myList.length > 0 ? [{ key: "my-list", label: "My list", items: myList.slice(0, 30).map(homeMovie) }] : []),
      ...shelves.map((shelf) => shelfRow(shelf, homeMovie)),
    ];
  }, [db, version, sourceId, shelves, tick]);
  const heroActions = useCallback(
    (item: HomeItem): HeroActions => ({
      primary: {
        label: item.resume ? "Resume" : "Play",
        onPress: () => onPlay({ id: item.id, title: item.name }, item.resume),
        progress: item.resume && item.progress !== null && item.progress !== undefined ? item.progress : undefined,
      },
      actions: [
        { key: "info", label: "More info", glyph: "info", onPress: () => onOpen({ id: item.id, title: item.name }) },
        {
          key: "list",
          label: item.favourite ? "Remove from My list" : "Add to My list",
          glyph: item.favourite ? "check" : "plus",
          onPress: () => {
            toggleMovieFavourite(db, item.id);
            sync.notifyLocalChange();
            setTick((value) => value + 1);
          },
        },
      ],
    }),
    [db, sync, onOpen, onPlay],
  );

  if (browsing || (rows !== null && rows.length === 0)) return <Padded><MoviesBrowse sourceId={sourceId} onOpen={onOpen} /></Padded>;
  if (rows === null) return <Loading noun="movies" />;
  return <HomeScreen rows={rows} heroActions={heroActions} fetchDetail={fetchDetail} onSelect={(item) => onOpen({ id: item.id, title: item.name })} />;
}

/** Series: the same landing page, with recently watched in place of continue watching. */
export function SeriesScreen({
  sourceId,
  active = true,
  browsing,
  onBrowseDone,
  onOpen,
  onPlayEpisode,
}: {
  sourceId: string | null;
  active?: boolean;
  browsing: boolean;
  onBrowseDone: () => void;
  onOpen: (series: { id: string; title: string }) => void;
  onPlayEpisode: (episodeId: string, title: string, resume: boolean, seriesId: string) => void;
}) {
  const { db, version: latestVersion, catalogue, sync } = useApp();
  const version = useVersionWhileShown(active, latestVersion);
  const [tick, setTick] = useState(0);
  useRefreshOnShow(active, useCallback(() => setTick((value) => value + 1), []));
  useBackTo(browsing, onBrowseDone);
  const shelves = useBuilt(seriesRows, db, catalogue, sourceId, "series");
  const recentIds = useRef(new Set<string>());
  const rows = useMemo<HomeRow[] | null>(() => {
    if (shelves === null) return null;
    const own = (show: { source_id: string }) => sourceId === null || show.source_id === sourceId;
    const recent = listRecentSeries(db, 60).filter(own).slice(0, 20);
    const myList = listFavouriteSeries(db).filter(own);
    recentIds.current = new Set(recent.map((show) => show.id));
    return [
      ...(recent.length > 0 ? [{ key: "recent-watched", label: "Recently watched", items: recent.map(homeSeries) }] : []),
      ...(myList.length > 0 ? [{ key: "my-list", label: "My list", items: myList.slice(0, 30).map(homeSeries) }] : []),
      ...shelves.map((shelf) => shelfRow(shelf, homeSeries)),
    ];
  }, [db, version, sourceId, shelves, tick]);
  const heroActions = useCallback(
    (item: HomeItem): HeroActions => ({
      primary: seriesPrimaryAction(db, item, onOpen, onPlayEpisode),
      actions: [
        { key: "info", label: "View episodes", glyph: "info", onPress: () => onOpen({ id: item.id, title: item.name }) },
        {
          key: "list",
          label: item.favourite ? "Remove from My list" : "Add to My list",
          glyph: item.favourite ? "check" : "plus",
          onPress: () => {
            toggleSeriesFavourite(db, item.id);
            sync.notifyLocalChange();
            setTick((value) => value + 1);
          },
        },
        ...(recentIds.current.has(item.id)
          ? [
              {
                key: "forget",
                label: "Remove from Recently watched",
                glyph: "cross" as const,
                onPress: () => {
                  removeSeriesFromRecents(db, item.id);
                  sync.notifyLocalChange();
                  setTick((value) => value + 1);
                },
              },
            ]
          : []),
      ],
    }),
    [db, sync, onOpen, onPlayEpisode],
  );

  if (browsing || (rows !== null && rows.length === 0)) return <Padded><SeriesBrowse sourceId={sourceId} onOpen={onOpen} /></Padded>;
  if (rows === null) return <Loading noun="series" />;
  return <HomeScreen rows={rows} heroActions={heroActions} onSelect={(item) => onOpen({ id: item.id, title: item.name })} />;
}

/** The category browser and empty states sit under the nav bar, which floats over the landing page's art. */
export function Padded({ children }: { children: ReactNode }) {
  return <View style={loadingStyles.padded}>{children}</View>;
}

/** The landing page's outline while its rows are built for the first time. */
export function Loading(_props: { noun: string }) {
  return <HomeSkeleton />;
}

const loadingStyles = styleSheet({
  padded: { flex: 1, paddingHorizontal: 44, paddingTop: 112 },
  wrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  text: { color: colors.muted, fontSize: type.body },
});
