import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { categoryLabel } from "@testcard/core/src/normalise/categoryLabel.js";
import { listFavouriteMovies, listRecentMovies, movieShelves, type MovieRow } from "@testcard/core/src/db/vodQueries.js";
import { listFavouriteSeries, listRecentSeries, seriesShelves, type SeriesRow } from "@testcard/core/src/db/seriesQueries.js";
import { shouldPromptResume } from "@testcard/core/src/playback/progressPolicy.js";
import { useApp } from "../state/app";
import { colors, space, type } from "../theme";
import { Muted } from "../ui/controls";
import { PosterRow, type PosterItem } from "../ui/Poster";

const toMoviePoster = (movie: MovieRow): PosterItem => ({
  id: movie.id,
  name: movie.name,
  posterUrl: movie.poster_url,
  progress: movie.position_secs !== null && movie.duration_secs !== null && movie.duration_secs > 0 ? movie.position_secs / movie.duration_secs : null,
});
const toSeriesPoster = (series: SeriesRow): PosterItem => ({ id: series.id, name: series.name, posterUrl: series.poster_url });

export interface PlayRequest {
  readonly kind: "movie";
  readonly id: string;
  readonly title: string;
  readonly resume: boolean;
}

/** Movies home: continue watching, My list, then a row per large category. Selecting a poster plays it. */
export function MoviesScreen({ onPlay }: { onPlay: (request: PlayRequest) => void }) {
  const { db, version } = useApp();
  const rows = useMemo(() => {
    void version;
    const recent = listRecentMovies(db, 40);
    const favourites = listFavouriteMovies(db);
    const shelves = movieShelves(db);
    const inProgress = recent.filter((movie) => movie.position_secs !== null && movie.watched !== 1 && shouldPromptResume(movie.position_secs, movie.duration_secs));
    return {
      continueWatching: inProgress,
      myList: favourites.slice(0, 20),
      shelves,
      byId: new Map([...recent, ...favourites, ...shelves.flatMap((shelf) => shelf.items)].map((movie) => [movie.id, movie])),
    };
  }, [db, version]);

  const play = (item: PosterItem) => {
    const movie = rows.byId.get(item.id);
    const resume = movie !== undefined && movie.position_secs !== null && shouldPromptResume(movie.position_secs, movie.duration_secs);
    onPlay({ kind: "movie", id: item.id, title: item.name, resume });
  };

  if (rows.shelves.length === 0 && rows.myList.length === 0 && rows.continueWatching.length === 0) {
    return <EmptyCatalogue what="movies" />;
  }
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <PosterRow title="Continue watching" items={rows.continueWatching.map(toMoviePoster)} onPress={play} />
      <PosterRow title="My list" items={rows.myList.map(toMoviePoster)} onPress={play} />
      {rows.shelves.map((shelf) => (
        <PosterRow key={shelf.category.id} title={categoryLabel(shelf.category.name)} items={shelf.items.map(toMoviePoster)} onPress={play} />
      ))}
    </ScrollView>
  );
}

/** Series home: recently watched, My list, then a row per large category. Selecting a poster opens its episodes. */
export function SeriesScreen({ onOpen }: { onOpen: (series: { id: string; title: string }) => void }) {
  const { db, version } = useApp();
  const rows = useMemo(() => {
    void version;
    return { recent: listRecentSeries(db, 20), myList: listFavouriteSeries(db).slice(0, 20), shelves: seriesShelves(db) };
  }, [db, version]);
  const open = (item: PosterItem) => onOpen({ id: item.id, title: item.name });

  if (rows.shelves.length === 0 && rows.myList.length === 0 && rows.recent.length === 0) return <EmptyCatalogue what="series" />;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <PosterRow title="Recently watched" items={rows.recent.map(toSeriesPoster)} onPress={open} />
      <PosterRow title="My list" items={rows.myList.map(toSeriesPoster)} onPress={open} />
      {rows.shelves.map((shelf) => (
        <PosterRow key={shelf.category.id} title={categoryLabel(shelf.category.name)} items={shelf.items.map(toSeriesPoster)} onPress={open} />
      ))}
    </ScrollView>
  );
}

function EmptyCatalogue({ what }: { what: "movies" | "series" }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{`No ${what} yet`}</Text>
      <Muted>{`Sign in to the account your computer uses and its sources will load here. Open Sources to see progress.`}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingVertical: space.l, paddingRight: space.l },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.m, padding: space.xl },
  emptyTitle: { color: colors.foreground, fontSize: type.lead, fontWeight: "600" },
});
