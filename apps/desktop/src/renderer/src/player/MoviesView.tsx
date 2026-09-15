import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shouldPromptResume } from "@testcard/core";
import { Icon } from "../components/Icon.js";
import { formatDuration } from "../lib/time.js";
import { logoSrc } from "../lib/logo.js";
import { PosterGrid } from "./PosterGrid.js";

export function MoviesView({
  scope = "browse",
  onPlaybackStarted,
  headerExtra,
}: {
  scope?: "browse" | "favourites" | "recent";
  onPlaybackStarted?: () => void;
  headerExtra?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 160);
    return () => clearTimeout(id);
  }, [term]);

  const searching = scope === "browse" && debounced.length > 0;

  const categories = useQuery({
    queryKey: ["movies", "categories"],
    queryFn: () => window.testcard.movies.categoryList(),
    staleTime: 60_000,
    enabled: scope === "browse",
  });

  const list = useQuery({
    queryKey: ["movies", scope, categoryId, searching ? debounced : null, searching],
    queryFn: () => {
      if (scope === "favourites") return window.testcard.movies.favourites();
      if (scope === "recent") return window.testcard.movies.recent();
      if (searching) return window.testcard.movies.search(debounced);
      return window.testcard.movies.browse(categoryId !== null ? { categoryId } : {});
    },
    placeholderData: (prev) => prev,
  });

  const detail = useQuery({
    queryKey: ["movies", "details", selectedMovieId],
    queryFn: () => window.testcard.movies.details(selectedMovieId as string),
    enabled: selectedMovieId !== null,
  });

  const progress = useQuery({
    queryKey: ["progress", "movie", selectedMovieId],
    queryFn: () => window.testcard.progress.get("movie", selectedMovieId as string),
    enabled: selectedMovieId !== null,
  });

  const favourite = useMutation({
    mutationFn: (movieId: string) => window.testcard.movies.toggleFavourite(movieId),
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

  const rows = list.data ?? [];
  const promptResume = progress.data !== undefined && shouldPromptResume(progress.data.position_secs, progress.data.duration_secs);

  const heading = scope === "favourites" ? "Favourite movies" : scope === "recent" ? "Recently watched movies" : "Movies";
  const emptyText = list.isError
    ? "Couldn't load movies. Try refreshing the source."
    : searching
      ? `Nothing matches "${debounced}".`
      : scope === "favourites"
        ? "No favourite movies yet."
        : scope === "recent"
          ? "Nothing played yet."
          : "No movies. Add an Xtream source and refresh it.";

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

      <div className="pw-scroll">
        {scope === "browse" && (
          <div className="pw-cats pw-cats--inline">
            <button type="button" className="pw-cat" data-active={categoryId === null} onClick={() => setCategoryId(null)}>
              <span className="pw-cat-name">All movies</span>
            </button>
            {categories.data?.map((category) => (
              <button
                key={category.id}
                type="button"
                className="pw-cat"
                data-active={categoryId === category.id}
                onClick={() => setCategoryId(category.id)}
                title={category.name}
              >
                <span className="pw-cat-name">{category.name}</span>
                <span className="pw-cat-count">{category.movie_count}</span>
              </button>
            ))}
          </div>
        )}

        <PosterGrid
          items={rows.map((movie) => ({ id: movie.id, name: movie.name, posterUrl: movie.poster_url, watched: movie.watched === 1 }))}
          onSelect={setSelectedMovieId}
          empty={emptyText}
        />
      </div>

      {selectedMovieId !== null && (
        <div className="pw-detail-pane">
          <button type="button" className="pw-detail-close" aria-label="Close" onClick={() => setSelectedMovieId(null)}>
            <Icon name="x" />
          </button>
          {detail.data !== undefined ? (
            <>
              {detail.data.poster_url && (
                <img className="pw-detail-poster" src={logoSrc(detail.data.poster_url)} alt="" referrerPolicy="no-referrer" />
              )}
              <h3>{detail.data.name}</h3>
              {detail.data.plot && <p className="pw-detail-plot">{detail.data.plot}</p>}
              <div className="pw-detail-actions">
                {promptResume ? (
                  <>
                    <button type="button" className="btn btn--primary" onClick={() => play(true)}>
                      Resume from {formatDuration(progress.data!.position_secs)}
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
                  className="btn btn--ghost btn--icon"
                  aria-label={detail.data.is_favourite === 1 ? "Remove favourite" : "Add favourite"}
                  onClick={() => favourite.mutate(detail.data!.id)}
                >
                  <Icon name="star" filled={detail.data.is_favourite === 1} />
                </button>
              </div>
            </>
          ) : (
            <p className="pw-empty">Loading…</p>
          )}
        </div>
      )}
    </main>
  );
}
