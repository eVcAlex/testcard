import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// Deep import, not the "@testcard/core" barrel — the barrel wildcard-re-exports db/sync modules
// that `import Database from "better-sqlite3"` as a value, and a bundler evaluates a module's
// entire re-export graph when anything is imported from it. A renderer-side value import of
// ANYTHING from the barrel drags that native Node addon into the browser context and crashes at
// runtime. `progressPolicy.ts` has no such import, so it's safe to reach directly.
import { shouldPromptResume } from "@testcard/core/src/playback/progressPolicy.js";
import { Icon } from "../components/Icon.js";
import { Drawer } from "../components/Drawer.js";
import { EmptyState } from "../components/EmptyState.js";
import { formatDuration } from "../lib/time.js";
import { logoSrc } from "../lib/logo.js";
import { splitTitle } from "@testcard/core/src/normalise/splitTitle.js";
import { CategoryBar } from "./CategoryBar.js";
import { GenreBar } from "./GenreBar.js";
import { genreOptions } from "@testcard/core/src/normalise/genres.js";
import { useSources } from "./useSources.js";
import { PosterGrid, type PosterItem } from "./PosterGrid.js";
import { PosterShelf } from "./PosterShelf.js";
import { Removable } from "./Removable.js";
import { displayName } from "@testcard/core/src/normalise/displayName.js";

type MovieListRow = Awaited<ReturnType<typeof window.testcard.movies.browse>>[number];

function toPoster(movie: MovieListRow): PosterItem {
  const progress =
    movie.position_secs !== null && movie.duration_secs !== null && movie.duration_secs > 0
      ? movie.position_secs / movie.duration_secs
      : null;
  return {
    id: movie.id,
    name: movie.name,
    posterUrl: movie.poster_url,
    watched: movie.watched === 1,
    favourite: movie.is_favourite === 1,
    progress,
  };
}

export function MoviesView({
  sourceId = null,
  scope = "browse",
  onPlaybackStarted,
  headerExtra,
}: {
  /** Narrow to one source. null = every source. */
  sourceId?: string | null;
  scope?: "browse" | "favourites" | "recent";
  onPlaybackStarted?: () => void;
  headerExtra?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [browseAll, setBrowseAll] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 160);
    return () => clearTimeout(id);
  }, [term]);

  const searching = scope === "browse" && debounced.length > 0;
  const pickGenre = useCallback((next: string | null) => {
    setGenre(next);
    setCategoryId(null); // a category belongs to one genre; keeping it would silently override the filter
    setBrowseAll(false);
  }, []);
  const pickCategory = useCallback((next: string | null) => {
    setCategoryId(next);
    setBrowseAll(false);
  }, []);
  const plainBrowse = scope === "browse" && !searching && categoryId === null && genre === null;

  const categories = useQuery({
    queryKey: ["movies", "categories", sourceId],
    queryFn: () => window.testcard.movies.categoryList(sourceId ?? undefined),
    staleTime: 60_000,
    enabled: scope === "browse",
  });

  // Home shows category rows instead of one long grid. "Browse all", any filter or a search switches to
  // the grid, and so does a catalogue with no category big enough to fill a row.
  const [noShelves, setNoShelves] = useState(false);
  const landing = plainBrowse && !browseAll && !noShelves;

  const list = useQuery({
    queryKey: ["movies", scope, categoryId, genre, searching ? debounced : null, searching, sourceId],
    queryFn: () => {
      if (scope === "favourites") return window.testcard.movies.favourites();
      if (scope === "recent") return window.testcard.movies.recent();
      if (searching) return window.testcard.movies.search(debounced, sourceId ?? undefined);
      return window.testcard.movies.browse({
        ...(categoryId !== null ? { categoryId } : {}),
        ...(genre !== null ? { genre } : {}),
        ...(sourceId !== null ? { sourceId } : {}),
      });
    },
    placeholderData: (prev) => prev,
    enabled: !landing,
  });

  const shelves = useQuery({
    queryKey: ["movies", "shelves", sourceId],
    queryFn: () => window.testcard.movies.shelves(sourceId ?? undefined),
    staleTime: 60_000,
    enabled: landing,
  });
  const myList = useQuery({
    queryKey: ["movies", "favourites", "shelf"],
    queryFn: () => window.testcard.movies.favourites(),
    enabled: landing,
  });
  useEffect(() => {
    if (shelves.data !== undefined) setNoShelves(shelves.data.length === 0);
  }, [shelves.data]);
  const myListRows = (myList.data ?? []).filter((movie) => sourceId === null || movie.source_id === sourceId).slice(0, 20);

  // Started-but-unfinished movies, for the row above the catalogue.
  const started = useQuery({
    queryKey: ["movies", "continue"],
    queryFn: () => window.testcard.movies.recent(),
    enabled: plainBrowse,
  });
  const continueRows = (started.data ?? []).filter(
    (movie) => (sourceId === null || movie.source_id === sourceId) && movie.position_secs !== null && movie.watched !== 1 && shouldPromptResume(movie.position_secs, movie.duration_secs),
  );

  const detail = useQuery({
    queryKey: ["movies", "details", selectedMovieId],
    queryFn: () => window.testcard.movies.details(selectedMovieId as string),
    enabled: selectedMovieId !== null,
  });

  const favourite = useMutation({
    mutationFn: (movieId: string) => window.testcard.movies.toggleFavourite(movieId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["movies"] }),
  });

  const removeFromHistory = useMutation({
    mutationFn: (movieId: string) => window.testcard.movies.removeFromHistory(movieId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["movies"] }),
  });

  const play = useCallback(
    (resume: boolean) => {
      if (selectedMovieId === null) return;
      onPlaybackStarted?.();
      void window.testcard.playback.playMovie(selectedMovieId, { resume });
    },
    [selectedMovieId, onPlaybackStarted],
  );

  const closeDrawer = useCallback(() => setSelectedMovieId(null), []);

  const rows = list.data ?? [];
  // The movies.details catalog row already carries both fields, so there's no separate progress
  // query (and one resolving `undefined` for an unplayed movie would break TanStack Query v5,
  // which retries `undefined` as an error).
  const resumePositionSecs = detail.data?.position_secs ?? null;
  const promptResume = resumePositionSecs !== null && shouldPromptResume(resumePositionSecs, detail.data?.duration_secs ?? null);

  const heading = scope === "favourites" ? "Favourite movies" : scope === "recent" ? "Recently watched movies" : "Movies";

  const empty = list.isError ? (
    <EmptyState icon="film" title="Couldn't load movies" hint="Refresh your source from Account, then try again." />
  ) : searching ? (
    <EmptyState icon="search" title={`Nothing matches “${debounced}”`} hint="Check the spelling or clear the search." />
  ) : scope === "favourites" ? (
    <EmptyState icon="star" title="No favourite movies yet" hint="Open a movie and press the star to keep it here." />
  ) : scope === "recent" ? (
    <EmptyState icon="clock" title="Nothing watched yet" hint="Movies you play show up here." />
  ) : (
    <EmptyState icon="film" title="No movies" hint="Add a source with movies in Account, or turn Movies on for one, then refresh it." />
  );

  const sources = useSources().data ?? [];
  const sourceName = sources.length > 1 ? sources.find((source) => source.id === detail.data?.source_id)?.name : undefined;
  const detailTitle = detail.data !== undefined ? splitTitle(detail.data.name) : null;
  const rating = detail.data?.rating && Number(detail.data.rating) > 0 ? Number(detail.data.rating).toFixed(1) : null;

  return (
    <main className="pw-main">
      <div className="pw-head">
        <h2>{heading}</h2>
        {headerExtra}
        {scope === "browse" && (
          <div className="pw-search">
            <Icon name="search" size={15} />
            <input
              type="search"
              placeholder="Search movies"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              aria-label="Search movies"
            />
          </div>
        )}
      </div>

      {scope === "browse" && (
        <>
          <GenreBar
            options={genreOptions((categories.data ?? []).map((c) => ({ genre: c.genre, count: c.movie_count })))}
            value={genre}
            onChange={pickGenre}
          />
          <CategoryBar
            allLabel="Home"
            categories={(categories.data ?? [])
              .filter((c) => genre === null || c.genre === genre)
              .map((c) => ({ id: c.id, name: c.name, count: c.movie_count }))}
            value={categoryId}
            onChange={pickCategory}
          />
        </>
      )}

      <div className="pw-scroll">
        {plainBrowse && continueRows.length > 0 && (
          <section className="pw-shelf">
            <h3 className="pw-shelf-title">Continue watching</h3>
            <div className="pw-shelf-row">
              {continueRows.slice(0, 12).map((movie) => (
                <Removable key={movie.id} label="Remove from continue watching" onRemove={() => removeFromHistory.mutate(movie.id)}>
                  <ContinueTile movie={movie} onSelect={setSelectedMovieId} />
                </Removable>
              ))}
            </div>
          </section>
        )}

        {landing ? (
          <>
            <PosterShelf title="My list" items={myListRows.map(toPoster)} onSelect={setSelectedMovieId} />
            {(shelves.data ?? []).map((shelf) => (
              <PosterShelf
                key={shelf.category.id}
                title={displayName(shelf.category.name)}
                items={shelf.items.map(toPoster)}
                onSelect={setSelectedMovieId}
                onSeeAll={() => pickCategory(shelf.category.id)}
              />
            ))}
            {shelves.data !== undefined && shelves.data.length > 0 && (
              <div className="pw-browse-all">
                <button type="button" className="btn btn--ghost" onClick={() => setBrowseAll(true)}>
                  Browse all movies
                </button>
              </div>
            )}
          </>
        ) : rows.length === 0 ? (
          list.isFetching || list.isPending ? null : empty
        ) : (
          <>
            {plainBrowse && <h3 className="pw-shelf-title">All movies</h3>}
            <PosterGrid
              items={rows.map(toPoster)}
              onSelect={setSelectedMovieId}
              {...(scope === "recent" ? { onRemove: (id: string) => removeFromHistory.mutate(id) } : {})}
            />
          </>
        )}
      </div>

      {selectedMovieId !== null && (
        <Drawer label="Movie details" backdropUrl={detail.data?.poster_url ? logoSrc(detail.data.poster_url) : null} onClose={closeDrawer}>
          {detail.data !== undefined && detailTitle !== null ? (
            <>
              <div className="pw-detail-top">
                {detail.data.poster_url && (
                  <img className="pw-detail-poster" src={logoSrc(detail.data.poster_url)} alt="" referrerPolicy="no-referrer" />
                )}
                <div className="pw-detail-heading">
                  <h3>{detailTitle.title}</h3>
                  <p className="pw-detail-meta">
                    {[
                      detailTitle.year,
                      detail.data.duration_secs ? formatDuration(detail.data.duration_secs) : null,
                      rating !== null ? `Rated ${rating}` : null,
                      detailTitle.is4k ? "4K" : null,
                      sourceName ?? null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join("   ")}
                  </p>
                </div>
              </div>
              <div className="pw-detail-actions">
                {promptResume ? (
                  <>
                    <button type="button" className="btn btn--primary" onClick={() => play(true)}>
                      <Icon name="play" /> Resume from {formatDuration(resumePositionSecs!)}
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => play(false)}>
                      Start over
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn--primary" onClick={() => play(false)}>
                    <Icon name="play" /> Play
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => favourite.mutate(detail.data!.id)}
                  aria-pressed={detail.data.is_favourite === 1}
                >
                  <Icon name="star" filled={detail.data.is_favourite === 1} />
                  {detail.data.is_favourite === 1 ? "In favourites" : "Add to favourites"}
                </button>
              </div>
              {detail.data.plot ? <p className="pw-detail-plot">{detail.data.plot}</p> : <p className="pw-detail-plot pw-detail-plot--none">No description from the provider.</p>}
            </>
          ) : (
            <p className="pw-detail-loading">Loading…</p>
          )}
        </Drawer>
      )}
    </main>
  );
}

function ContinueTile({ movie, onSelect }: { movie: MovieListRow; onSelect: (id: string) => void }) {
  const { title } = splitTitle(movie.name);
  const progress = movie.position_secs !== null && movie.duration_secs ? movie.position_secs / movie.duration_secs : 0;
  return (
    <button type="button" className="pw-continue" onClick={() => onSelect(movie.id)} title={movie.name}>
      <span className="pw-continue-art">
        {movie.poster_url ? <img src={logoSrc(movie.poster_url)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Icon name="film" />}
        <span className="pw-poster-progress" aria-hidden="true">
          <i style={{ width: `${Math.min(1, progress) * 100}%` }} />
        </span>
      </span>
      <span className="pw-continue-text">
        <span className="pw-continue-title">{title}</span>
        <span className="pw-continue-left">
          {movie.position_secs !== null && movie.duration_secs
            ? `${formatDuration(Math.max(0, movie.duration_secs - movie.position_secs))} left`
            : "Resume"}
        </span>
      </span>
    </button>
  );
}
