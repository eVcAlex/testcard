import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BackHandler, Text, View } from "react-native";
import { categoryLabel } from "@testcard/core/src/normalise/categoryLabel.js";
import { movieHome, seriesHome } from "@testcard/core/src/db/homeQueries.js";
import { ensureMovieDetails } from "@testcard/core/src/db/importVodDetails.js";
import { getCredentials } from "../platform/secrets";
import { browseMovies, getMovieById, getMoviePlaybackTarget, listFavouriteMovies, listMovieCategories, listRecentMovies, toggleMovieFavourite, type MovieRow } from "@testcard/core/src/db/vodQueries.js";
import { browseSeries, listFavouriteSeries, listRecentSeries, listSeriesCategories, removeSeriesFromRecents, toggleSeriesFavourite, type SeriesRow } from "@testcard/core/src/db/seriesQueries.js";
import { shouldPromptResume } from "@testcard/core/src/playback/progressPolicy.js";
import { useApp } from "../state/app";
import { colors, type, styleSheet } from "../theme";
import { memoByVersion } from "../state/memoByVersion";
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
  const { db, version } = useApp();
  const source = useMemo<BrowseSource>(() => {
    const scope = sourceId !== null ? { sourceId } : {};
    const categories = movieCategories(db, version, sourceId ?? undefined);
    const history = listRecentMovies(db, 60);
    const continuing = history.filter((movie) => movie.position_secs !== null && movie.watched !== 1 && shouldPromptResume(movie.position_secs, movie.duration_secs));
    const myList = listFavouriteMovies(db);
    return {
      layout: "poster",
      noun: "movies",
      single: "movie",
      specials: [
        { key: "continue", label: "Continue watching", count: continuing.length },
        { key: "my-list", label: "My list", count: myList.length },
        { key: "all", label: "All movies", count: categories.reduce((total, category) => total + category.count, 0) },
      ],
      categories,
      load: (selection, limit) => {
        if (selection.kind === "category") return browseMovies(db, { categoryId: selection.key, limit, ...scope }).map(toMovieItem);
        if (selection.kind === "genre") return browseMovies(db, { genre: selection.key, limit, ...scope }).map(toMovieItem);
        if (selection.key === "continue") return continuing.map(toMovieItem);
        if (selection.key === "my-list") return myList.slice(0, limit).map(toMovieItem);
        return browseMovies(db, { limit, ...scope }).map(toMovieItem);
      },
    };
  }, [db, version, sourceId]);

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
  const { db, version } = useApp();
  const source = useMemo<BrowseSource>(() => {
    const scope = sourceId !== null ? { sourceId } : {};
    const categories = seriesCategories(db, version, sourceId ?? undefined);
    const myList = listFavouriteSeries(db);
    return {
      layout: "poster",
      noun: "series",
      single: "series",
      specials: [
        { key: "my-list", label: "My list", count: myList.length },
        { key: "all", label: "All series", count: categories.reduce((total, category) => total + category.count, 0) },
      ],
      categories,
      load: (selection, limit) => {
        if (selection.kind === "category") return browseSeries(db, { categoryId: selection.key, limit, ...scope }).map(toSeriesItem);
        if (selection.kind === "genre") return browseSeries(db, { genre: selection.key, limit, ...scope }).map(toSeriesItem);
        if (selection.key === "my-list") return myList.slice(0, limit).map(toSeriesItem);
        return browseSeries(db, { limit, ...scope }).map(toSeriesItem);
      },
    };
  }, [db, version, sourceId]);

  return (
    <BrowseScreen
      source={source}
      empty={sourceId !== null ? "Nothing from this source. Use the Source button at the top right to switch." : "Sign in to the account your computer uses and its sources will load here. Open Sources to see progress."}
      onSelect={(item) => onOpen({ id: item.id, title: item.title })}
    />
  );
}

export type AppDb = ReturnType<typeof useApp>["db"];
type Memo<T> = ((db: AppDb, version: number, key?: string) => T) & {
  cached: (db: AppDb, version: number, key?: string) => T | undefined;
  stale: (db: AppDb, key?: string) => T | undefined;
};

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
 * The remembered rows straight away when there are some, otherwise null until they have been built. When a sync
 * bumps `version`, the old rows stay up while the new ones are built (blanking the page would flash a loading
 * screen and throw the viewer back to the top); only switching source starts from nothing.
 */
export function useBuilt<T>(memo: Memo<T>, db: AppDb, version: number, sourceId: string | null): T | null {
  const key = sourceId ?? undefined;
  const [value, setValue] = useState<T | null>(() => memo.cached(db, version, key) ?? memo.stale(db, key) ?? null);
  const builtFor = useRef(key);
  useEffect(() => {
    const hit = memo.cached(db, version, key);
    if (hit !== undefined) {
      builtFor.current = key;
      setValue(hit);
      return;
    }
    if (builtFor.current !== key) {
      builtFor.current = key;
      setValue(null);
    }
    const timer = setTimeout(() => setValue(memo(db, version, key)), 30);
    return () => clearTimeout(timer);
  }, [memo, db, version, key]);
  return value;
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
  rating: movie.rating,
  plot: movie.plot,
  durationSecs: movie.duration_secs,
  favourite: movie.is_favourite === 1,
  resume: movie.position_secs !== null && shouldPromptResume(movie.position_secs, movie.duration_secs),
});
export const homeSeries = (series: SeriesRow): HomeItem => ({ id: series.id, name: series.name, posterUrl: series.poster_url, progress: null, rating: series.rating, plot: series.plot, durationSecs: null, favourite: series.is_favourite === 1, resume: false });

/** Movies: a landing page of rows (continue watching, my list, top rated, recently added, genres). `browsing` (the nav bar's Browse all) shows every category instead. */
export function MoviesScreen({
  sourceId,
  browsing,
  onBrowseDone,
  onOpen,
  onPlay,
}: {
  sourceId: string | null;
  browsing: boolean;
  onBrowseDone: () => void;
  onOpen: (movie: { id: string; title: string }) => void;
  onPlay: (movie: { id: string; title: string }, resume: boolean) => void;
}) {
  const { db, version, sync } = useApp();
  const [tick, setTick] = useState(0);
  useBackTo(browsing, onBrowseDone);
  const shelves = useBuilt(movieRows, db, version, sourceId);
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
    const continuing = listRecentMovies(db, 60).filter((movie) => movie.position_secs !== null && movie.watched !== 1 && shouldPromptResume(movie.position_secs, movie.duration_secs));
    const myList = listFavouriteMovies(db);
    return [
      ...(continuing.length > 0 ? [{ key: "continue", label: "Continue watching", items: continuing.map(homeMovie) }] : []),
      ...(myList.length > 0 ? [{ key: "my-list", label: "My list", items: myList.slice(0, 30).map(homeMovie) }] : []),
      ...shelves.map((shelf) => shelfRow(shelf, homeMovie)),
    ];
  }, [db, version, shelves, tick]);
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
export function SeriesScreen({ sourceId, browsing, onBrowseDone, onOpen }: { sourceId: string | null; browsing: boolean; onBrowseDone: () => void; onOpen: (series: { id: string; title: string }) => void }) {
  const { db, version, sync } = useApp();
  const [tick, setTick] = useState(0);
  useBackTo(browsing, onBrowseDone);
  const shelves = useBuilt(seriesRows, db, version, sourceId);
  const recentIds = useRef(new Set<string>());
  const rows = useMemo<HomeRow[] | null>(() => {
    if (shelves === null) return null;
    const recent = listRecentSeries(db, 20);
    const myList = listFavouriteSeries(db);
    recentIds.current = new Set(recent.map((show) => show.id));
    return [
      ...(recent.length > 0 ? [{ key: "recent-watched", label: "Recently watched", items: recent.map(homeSeries) }] : []),
      ...(myList.length > 0 ? [{ key: "my-list", label: "My list", items: myList.slice(0, 30).map(homeSeries) }] : []),
      ...shelves.map((shelf) => shelfRow(shelf, homeSeries)),
    ];
  }, [db, version, shelves, tick]);
  const heroActions = useCallback(
    (item: HomeItem): HeroActions => ({
      primary: { label: "View episodes", onPress: () => onOpen({ id: item.id, title: item.name }) },
      actions: [
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
    [db, sync, onOpen],
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
