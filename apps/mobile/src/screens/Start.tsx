import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { browseChannels, listFavouriteChannels, listRecentChannels, removeChannelFromRecents, toggleFavourite } from "@testcard/core/src/db/queries.js";
import { listHomePins, unpinCategory } from "@testcard/core/src/sync/sourcePins.js";
import { listWatchedLately } from "@testcard/core/src/db/homeQueries.js";
import { ensureMovieDetails } from "@testcard/core/src/db/importVodDetails.js";
import { browseMovies, listFavouriteMovies, listRecentMovies, getMovieById, getMoviePlaybackTarget, removeMovieFromHistory, toggleMovieFavourite } from "@testcard/core/src/db/vodQueries.js";
import { browseSeries, listFavouriteSeries, listRecentSeries, removeSeriesFromRecents, toggleSeriesFavourite } from "@testcard/core/src/db/seriesQueries.js";
import { shouldPromptResume } from "@testcard/core/src/playback/progressPolicy.js";
import { fetchGuide } from "../playback/airing";
import { getCredentials } from "../platform/secrets";
import { useApp } from "../state/app";
import { colors, type, styleSheet } from "../theme";
import { Loading, homeMovie, homeSeries, movieRows, seriesRows, shelfRow, useBuilt, useRefreshOnShow } from "./Catalogue";
import type { DetailAction } from "../ui/DetailActions";
import { HomeScreen, type HeroActions, type HomeDetail, type HomeItem, type HomeRow } from "./Home";
import { toHomeItem } from "./Live";

type Kind = "movie" | "series" | "channel";

/** Movies, series and channels share one page, and their ids are only unique within their own kind, so each is tagged with its kind here. */
const tag = (kind: Kind, item: HomeItem): HomeItem => ({ ...item, id: `${kind}|${item.id}` });
const untag = (tagged: string): { kind: Kind; id: string } => {
  const at = tagged.indexOf("|");
  return { kind: tagged.slice(0, at) as Kind, id: tagged.slice(at + 1) };
};

/** "13:00" from epoch ms. `toLocaleTimeString` is not dependable on every Hermes build. */
const clock = (ms: number): string => {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/**
 * The Home tab: where you left off and what is new, across Movies, Series and Live TV. It is the same
 * page as the section landings (hero on the highlighted title, rows under it) with rows drawn from all three.
 */
export function StartScreen({
  sourceId,
  active = true,
  onOpenMovie,
  onPlayMovie,
  onOpenSeries,
  onPlayChannel,
}: {
  sourceId: string | null;
  active?: boolean;
  onOpenMovie: (movie: { id: string; title: string }) => void;
  onPlayMovie: (movie: { id: string; title: string }, resume: boolean) => void;
  onOpenSeries: (series: { id: string; title: string }) => void;
  onPlayChannel: (channel: { id: string; title: string }, channels: readonly { id: string; title: string }[]) => void;
}) {
  const { db, version, sync } = useApp();
  const [tick, setTick] = useState(0);
  useRefreshOnShow(active, useCallback(() => setTick((value) => value + 1), []));
  const movieShelves = useBuilt(movieRows, db, version, sourceId, "movies");
  const seriesShelves = useBuilt(seriesRows, db, version, sourceId, "series");

  const recentChannelIds = useRef(new Set<string>());
  const rows = useMemo<HomeRow[] | null>(() => {
    if (movieShelves === null || seriesShelves === null) return null;
    const asMovie = (movie: Parameters<typeof homeMovie>[0]) => tag("movie", homeMovie(movie));
    const asSeries = (series: Parameters<typeof homeSeries>[0]) => tag("series", homeSeries(series));
    // One row for what you were last watching, films and shows together, the most recent first: films only while unfinished.
    const recentMovies = new Map(listRecentMovies(db, 60).map((movie) => [movie.id, movie]));
    const recentSeries = new Map(listRecentSeries(db, 60).map((show) => [show.id, show]));
    const continuing: HomeItem[] = [];
    for (const entry of listWatchedLately(db, 60)) {
      if (entry.kind === "movie") {
        const movie = recentMovies.get(entry.id);
        if (movie !== undefined && movie.position_secs !== null && movie.watched !== 1 && shouldPromptResume(movie.position_secs, movie.duration_secs)) continuing.push(asMovie(movie));
      } else {
        const show = recentSeries.get(entry.id);
        if (show !== undefined) continuing.push(asSeries(show));
      }
    }
    const recentChannels = listRecentChannels(db, 30);
    recentChannelIds.current = new Set(recentChannels.map((channel) => channel.id));
    const myList = [...listFavouriteMovies(db).map(asMovie), ...listFavouriteSeries(db).map(asSeries)].slice(0, 30);
    const favouriteChannels = listFavouriteChannels(db).slice(0, 30);
    const list: HomeRow[] = [];
    const add = (key: string, label: string, items: readonly HomeItem[], channels = false, pinned = false) => {
      if (items.length > 0) list.push({ key, label, items, ...(channels ? { channels: true } : {}), ...(pinned ? { pinned: true } : {}) });
    };
    add("continue", "Continue watching", continuing.slice(0, 30));
    add("recent-channels", "Recently watched channels", recentChannels.map((channel) => tag("channel", toHomeItem(channel))), true);
    add("my-list", "My list", myList);
    add("favourite-channels", "Favourite channels", favouriteChannels.map((channel) => tag("channel", toHomeItem(channel))), true);
    // Categories pinned from Browse all, in the order they were pinned. A pin whose category is not here yet (a fresh import) waits.
    for (const pin of listHomePins(db)) {
      if (pin.categoryId === null) continue;
      const key = `pin:${pin.sourceId}:${pin.kind}:${pin.key}`;
      if (pin.kind === "live") add(key, pin.label, browseChannels(db, { categoryId: pin.categoryId, limit: 24 }).map((channel) => tag("channel", toHomeItem(channel))), true, true);
      else if (pin.kind === "movies") add(key, pin.label, browseMovies(db, { categoryId: pin.categoryId, limit: 30 }).map(asMovie), false, true);
      else add(key, pin.label, browseSeries(db, { categoryId: pin.categoryId, limit: 30 }).map(asSeries), false, true);
    }
    const newMovies = movieShelves.find((shelf) => shelf.key === "new");
    if (newMovies !== undefined) list.push({ ...shelfRow(newMovies, asMovie), key: "new-movies", label: "New movies" });
    const newSeries = seriesShelves.find((shelf) => shelf.key === "new");
    if (newSeries !== undefined) list.push({ ...shelfRow(newSeries, asSeries), key: "new-series", label: "New series" });
    const top = movieShelves.find((shelf) => shelf.key === "top");
    if (top !== undefined) list.push({ ...shelfRow(top, asMovie), key: "top-movies", label: top.label.replace("Top 10 this year", "Top 10 movies this year") });
    return list;
  }, [db, version, movieShelves, seriesShelves, tick]);

  const changed = useCallback(() => {
    sync.notifyLocalChange();
    setTick((value) => value + 1);
  }, [sync]);

  /** Next and previous step through the channel row the viewer picked from. */
  const play = useCallback(
    (item: { id: string; name: string }) => {
      const { id } = untag(item.id);
      const row = rows?.find((entry) => entry.items.some((candidate) => candidate.id === item.id));
      const stepping = (row?.items ?? [item]).map((entry) => ({ id: untag(entry.id).id, title: entry.name }));
      onPlayChannel({ id, title: item.name }, stepping);
    },
    [rows, onPlayChannel],
  );

  const baseActions = useCallback(
    (item: HomeItem): HeroActions => {
      const { kind, id } = untag(item.id);
      if (kind === "movie") {
        return {
          primary: {
            label: item.resume ? "Resume" : "Play",
            onPress: () => onPlayMovie({ id, title: item.name }, item.resume),
            progress: item.resume && item.progress !== null && item.progress !== undefined ? item.progress : undefined,
          },
          actions: [
            { key: "info", label: "More info", glyph: "info", onPress: () => onOpenMovie({ id, title: item.name }) },
            {
              key: "list",
              label: item.favourite ? "Remove from My list" : "Add to My list",
              glyph: item.favourite ? "check" : "plus",
              onPress: () => {
                toggleMovieFavourite(db, id);
                changed();
              },
            },
          ],
        };
      }
      if (kind === "series") {
        return {
          primary: { label: "View episodes", onPress: () => onOpenSeries({ id, title: item.name }) },
          actions: [
            {
              key: "list",
              label: item.favourite ? "Remove from My list" : "Add to My list",
              glyph: item.favourite ? "check" : "plus",
              onPress: () => {
                toggleSeriesFavourite(db, id);
                changed();
              },
            },
          ],
        };
      }
      return {
        primary: { label: "Watch live", onPress: () => play(item) },
        actions: [
          {
            key: "favourite",
            label: item.favourite ? "Remove from Favourites" : "Add to Favourites",
            glyph: item.favourite ? "check" : "plus",
            onPress: () => {
              toggleFavourite(db, id);
              changed();
            },
          },
          ...(recentChannelIds.current.has(id)
            ? [
                {
                  key: "forget",
                  label: "Remove from Recently watched",
                  glyph: "cross" as const,
                  onPress: () => {
                    removeChannelFromRecents(db, id);
                    setTick((value) => value + 1);
                  },
                },
              ]
            : []),
        ],
      };
    },
    [db, changed, onOpenMovie, onPlayMovie, onOpenSeries, play],
  );

  // What the row the remote is on adds: clearing an entry from Continue watching, or taking a pinned row off Home.
  const heroActions = useCallback(
    (item: HomeItem, rowKey: string): HeroActions => {
      const base = baseActions(item);
      const { kind, id } = untag(item.id);
      const extra: DetailAction[] = [];
      if (rowKey === "continue" && kind !== "channel") {
        extra.push({
          key: "forget-continue",
          label: "Remove from Continue watching",
          glyph: "cross",
          onPress: () => {
            if (kind === "movie") removeMovieFromHistory(db, id);
            else removeSeriesFromRecents(db, id);
            changed();
          },
        });
      }
      if (rowKey.startsWith("pin:")) {
        const pin = listHomePins(db).find((entry) => `pin:${entry.sourceId}:${entry.kind}:${entry.key}` === rowKey);
        if (pin?.categoryId != null) {
          extra.push({
            key: "unpin",
            label: "Remove this row from Home",
            glyph: "cross",
            onPress: () => {
              unpinCategory(db, pin.kind, pin.categoryId as string);
              changed();
            },
          });
        }
      }
      return extra.length === 0 ? base : { ...base, actions: [...base.actions, ...extra] };
    },
    [baseActions, changed, db],
  );

  const onSelect = useCallback(
    (item: { id: string; name: string }) => {
      const { kind, id } = untag(item.id);
      if (kind === "movie") onOpenMovie({ id, title: item.name });
      else if (kind === "series") onOpenSeries({ id, title: item.name });
      else play(item);
    },
    [onOpenMovie, onOpenSeries, play],
  );

  const fetchDetail = useCallback(
    async (tagged: string): Promise<HomeDetail | null> => {
      const { kind, id } = untag(tagged);
      if (kind === "movie") {
        const target = getMoviePlaybackTarget(db, id);
        if (target === undefined || target.source.kind !== "xtream") return null;
        await ensureMovieDetails(db, target.source, id, getCredentials);
        const movie = getMovieById(db, id);
        return movie === undefined ? null : { plot: movie.plot, durationSecs: movie.duration_secs };
      }
      if (kind === "channel") {
        const guide = await fetchGuide(db, id);
        if (guide === null) return null;
        const lines = [
          guide.now !== null ? `Now: ${guide.now.title}, ${clock(guide.now.start)} to ${clock(guide.now.end)}` : null,
          guide.next !== null ? `Next: ${guide.next.title}, ${clock(guide.next.start)}` : null,
        ].filter((line): line is string => line !== null);
        return lines.length > 0 ? { plot: lines.join("\n"), durationSecs: null } : null;
      }
      return null;
    },
    [db],
  );

  if (rows === null) return <Loading noun="your home page" />;
  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Nothing here yet. Sign in to the account your computer uses and its sources will load. Open Sources to see progress.</Text>
      </View>
    );
  }
  return <HomeScreen rows={rows} heroActions={heroActions} fetchDetail={fetchDetail} onSelect={onSelect} />;
}

const styles = styleSheet({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 200 },
  emptyText: { color: colors.muted, fontSize: type.body, textAlign: "center" },
});
