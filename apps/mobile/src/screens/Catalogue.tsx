import { useMemo } from "react";
import { categoryLabel } from "@testcard/core/src/normalise/categoryLabel.js";
import { browseMovies, listFavouriteMovies, listMovieCategories, listRecentMovies, type MovieRow } from "@testcard/core/src/db/vodQueries.js";
import { browseSeries, listFavouriteSeries, listSeriesCategories, type SeriesRow } from "@testcard/core/src/db/seriesQueries.js";
import { shouldPromptResume } from "@testcard/core/src/playback/progressPolicy.js";
import { useApp } from "../state/app";
import { memoByVersion } from "../state/memoByVersion";
import { BrowseScreen, type BrowseItem, type BrowseSource } from "./Browse";

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
const movieCategories = memoByVersion((db: Parameters<typeof listMovieCategories>[0]) =>
  listMovieCategories(db)
    .filter((category) => !hidden(category.tags))
    .map((category) => ({ id: category.id, label: tidy(category.name), count: category.movie_count, genre: category.genre })),
);
const seriesCategories = memoByVersion((db: Parameters<typeof listSeriesCategories>[0]) =>
  listSeriesCategories(db)
    .filter((category) => !hidden(category.tags))
    .map((category) => ({ id: category.id, label: tidy(category.name), count: category.series_count, genre: category.genre })),
);

/** Movies: continue watching and my list first, then every category the provider ships. Selecting a poster opens the film's page. */
export function MoviesScreen({ onOpen }: { onOpen: (movie: { id: string; title: string }) => void }) {
  const { db, version } = useApp();
  const source = useMemo<BrowseSource>(() => {
    const categories = movieCategories(db, version);
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
        if (selection.kind === "category") return browseMovies(db, { categoryId: selection.key, limit }).map(toMovieItem);
        if (selection.kind === "genre") return browseMovies(db, { genre: selection.key, limit }).map(toMovieItem);
        if (selection.key === "continue") return continuing.map(toMovieItem);
        if (selection.key === "my-list") return myList.slice(0, limit).map(toMovieItem);
        return browseMovies(db, { limit }).map(toMovieItem);
      },
    };
  }, [db, version]);

  return (
    <BrowseScreen
      source={source}
      empty="Sign in to the account your computer uses and its sources will load here. Open Sources to see progress."
      onSelect={(item) => onOpen({ id: item.id, title: item.title })}
    />
  );
}

/** Series: my list first, then every category. Selecting a poster opens its episodes. */
export function SeriesScreen({ onOpen }: { onOpen: (series: { id: string; title: string }) => void }) {
  const { db, version } = useApp();
  const source = useMemo<BrowseSource>(() => {
    const categories = seriesCategories(db, version);
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
        if (selection.kind === "category") return browseSeries(db, { categoryId: selection.key, limit }).map(toSeriesItem);
        if (selection.kind === "genre") return browseSeries(db, { genre: selection.key, limit }).map(toSeriesItem);
        if (selection.key === "my-list") return myList.slice(0, limit).map(toSeriesItem);
        return browseSeries(db, { limit }).map(toSeriesItem);
      },
    };
  }, [db, version]);

  return (
    <BrowseScreen
      source={source}
      empty="Sign in to the account your computer uses and its sources will load here. Open Sources to see progress."
      onSelect={(item) => onOpen({ id: item.id, title: item.title })}
    />
  );
}
