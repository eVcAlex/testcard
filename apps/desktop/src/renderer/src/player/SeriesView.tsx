import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shouldPromptResume, type EpisodeRow } from "@testcard/core";
import { Icon } from "../components/Icon.js";
import { formatDuration } from "../lib/time.js";
import { PosterGrid } from "./PosterGrid.js";

function EpisodeItem({ episode, onPlay }: { episode: EpisodeRow; onPlay: (episodeId: string, resume: boolean) => void }) {
  const promptResume = episode.position_secs !== null && shouldPromptResume(episode.position_secs, episode.duration_secs);
  return (
    <li className="pw-episode-row">
      <span className="pw-episode-num">{episode.episode_number}</span>
      <span className="pw-episode-name">{episode.name}</span>
      {episode.duration_secs !== null && <span className="pw-episode-duration">{formatDuration(episode.duration_secs)}</span>}
      {episode.watched === 1 && <Icon name="check" size={14} />}
      {promptResume ? (
        <>
          <button type="button" className="pw-episode-btn" onClick={() => onPlay(episode.id, true)}>
            Resume
          </button>
          <button type="button" className="pw-episode-btn" onClick={() => onPlay(episode.id, false)}>
            Restart
          </button>
        </>
      ) : (
        <button type="button" className="pw-episode-btn" aria-label="Play" onClick={() => onPlay(episode.id, false)}>
          <Icon name="play" size={12} />
        </button>
      )}
    </li>
  );
}

export function SeriesView({
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
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 160);
    return () => clearTimeout(id);
  }, [term]);

  const searching = scope === "browse" && debounced.length > 0;

  const categories = useQuery({
    queryKey: ["series", "categories"],
    queryFn: () => window.testcard.series.categoryList(),
    staleTime: 60_000,
    enabled: scope === "browse",
  });

  const list = useQuery({
    queryKey: ["series", scope, categoryId, searching ? debounced : null, searching],
    queryFn: () => {
      if (scope === "favourites") return window.testcard.series.favourites();
      if (scope === "recent") return window.testcard.series.recent();
      if (searching) return window.testcard.series.search(debounced);
      return window.testcard.series.browse(categoryId !== null ? { categoryId } : {});
    },
    placeholderData: (prev) => prev,
  });

  const detail = useQuery({
    queryKey: ["series", "episodes", selectedSeriesId],
    queryFn: () => window.testcard.series.episodes(selectedSeriesId as string),
    enabled: selectedSeriesId !== null,
  });

  const favourite = useMutation({
    mutationFn: (seriesId: string) => window.testcard.series.toggleFavourite(seriesId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["series"] }),
  });

  const playEpisode = useCallback(
    (episodeId: string, resume: boolean) => {
      onPlaybackStarted?.();
      void window.testcard.playback.playEpisode(episodeId, { resume }).then(() => {
        void queryClient.invalidateQueries({ queryKey: ["series", "episodes", selectedSeriesId] });
      });
    },
    [queryClient, selectedSeriesId, onPlaybackStarted],
  );

  const rows = list.data ?? [];

  const heading = scope === "favourites" ? "Favourite series" : scope === "recent" ? "Recently watched series" : "Series";
  const emptyText = list.isError
    ? "Couldn't load series. Try refreshing the source."
    : searching
      ? `Nothing matches "${debounced}".`
      : scope === "favourites"
        ? "No favourite series yet."
        : scope === "recent"
          ? "Nothing played yet."
          : "No series. Add an Xtream source and refresh it.";

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
              placeholder="Search series"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              aria-label="Search series"
            />
          </div>
        )}
      </div>

      <div className="pw-scroll">
        {scope === "browse" && (
          <div className="pw-cats pw-cats--inline">
            <button type="button" className="pw-cat" data-active={categoryId === null} onClick={() => setCategoryId(null)}>
              <span className="pw-cat-name">All series</span>
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
                <span className="pw-cat-count">{category.series_count}</span>
              </button>
            ))}
          </div>
        )}

        <PosterGrid
          items={rows.map((series) => ({ id: series.id, name: series.name, posterUrl: series.poster_url }))}
          onSelect={setSelectedSeriesId}
          empty={emptyText}
        />
      </div>

      {selectedSeriesId !== null && (
        <div className="pw-detail-pane pw-detail-pane--series">
          <button type="button" className="pw-detail-close" aria-label="Close" onClick={() => setSelectedSeriesId(null)}>
            <Icon name="x" />
          </button>
          {detail.data !== undefined ? (
            <>
              <h3>{detail.data.series.name}</h3>
              {detail.data.series.plot && <p className="pw-detail-plot">{detail.data.series.plot}</p>}
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                aria-label={detail.data.series.is_favourite === 1 ? "Remove favourite" : "Add favourite"}
                onClick={() => favourite.mutate(detail.data!.series.id)}
              >
                <Icon name="star" filled={detail.data.series.is_favourite === 1} />
              </button>
              {detail.data.seasons.map((season) => (
                <div key={season.id} className="pw-season">
                  <p className="pw-section-label">{season.name ?? `Season ${season.season_number}`}</p>
                  <ul className="pw-episode-list">
                    {season.episodes.map((episode) => (
                      <EpisodeItem key={episode.id} episode={episode} onPlay={playEpisode} />
                    ))}
                  </ul>
                </div>
              ))}
            </>
          ) : (
            <p className="pw-empty">Loading episodes…</p>
          )}
        </div>
      )}
    </main>
  );
}
