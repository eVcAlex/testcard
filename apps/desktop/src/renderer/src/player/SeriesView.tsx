import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EpisodeRow } from "@testcard/core";
// Deep import, not the "@testcard/core" barrel — see MoviesView.tsx's comment on the same import
// for why a renderer-side value import from the barrel crashes (drags in better-sqlite3).
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
import { displayName } from "@testcard/core/src/normalise/displayName.js";

type SeriesListRow = Awaited<ReturnType<typeof window.testcard.series.browse>>[number];

function toPoster(row: SeriesListRow): PosterItem {
  return { id: row.id, name: row.name, posterUrl: row.poster_url, favourite: row.is_favourite === 1 };
}

function EpisodeItem({ episode, onPlay }: { episode: EpisodeRow; onPlay: (episodeId: string, resume: boolean) => void }) {
  const inProgress = episode.position_secs !== null && shouldPromptResume(episode.position_secs, episode.duration_secs);
  const progress =
    inProgress && episode.duration_secs !== null && episode.duration_secs > 0 ? episode.position_secs! / episode.duration_secs : null;
  return (
    <li className="pw-episode-row" data-watched={episode.watched === 1}>
      <button type="button" className="pw-episode-main" onClick={() => onPlay(episode.id, inProgress)}>
        <span className="pw-episode-num">{episode.episode_number}</span>
        <span className="pw-episode-body">
          <span className="pw-episode-name">{episode.name}</span>
          <span className="pw-episode-sub">
            {inProgress
              ? `Resume from ${formatDuration(episode.position_secs!)}`
              : episode.watched === 1
                ? "Watched"
                : episode.duration_secs !== null
                  ? formatDuration(episode.duration_secs)
                  : ""}
          </span>
          {progress !== null && (
            <span className="pw-episode-bar" aria-hidden="true">
              <i style={{ width: `${Math.min(1, progress) * 100}%` }} />
            </span>
          )}
        </span>
        <span className="pw-episode-go" aria-hidden="true">
          {episode.watched === 1 && !inProgress ? <Icon name="check" size={14} /> : <Icon name="play" size={12} />}
        </span>
      </button>
      {inProgress && (
        <button type="button" className="pw-episode-restart" onClick={() => onPlay(episode.id, false)}>
          Restart
        </button>
      )}
    </li>
  );
}

export function SeriesView({
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
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);

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
  // Home shows category rows instead of one long grid. "Browse all", any filter or a search switches to
  // the grid, and so does a catalogue with no category big enough to fill a row.
  const [noShelves, setNoShelves] = useState(false);
  const landing = plainBrowse && !browseAll && !noShelves;

  const categories = useQuery({
    queryKey: ["series", "categories", sourceId],
    queryFn: () => window.testcard.series.categoryList(sourceId ?? undefined),
    staleTime: 60_000,
    enabled: scope === "browse",
  });

  const list = useQuery({
    queryKey: ["series", scope, categoryId, genre, searching ? debounced : null, searching, sourceId],
    queryFn: () => {
      if (scope === "favourites") return window.testcard.series.favourites();
      if (scope === "recent") return window.testcard.series.recent();
      if (searching) return window.testcard.series.search(debounced, sourceId ?? undefined);
      return window.testcard.series.browse({
        ...(categoryId !== null ? { categoryId } : {}),
        ...(genre !== null ? { genre } : {}),
        ...(sourceId !== null ? { sourceId } : {}),
      });
    },
    placeholderData: (prev) => prev,
    enabled: !landing,
  });

  const shelves = useQuery({
    queryKey: ["series", "shelves", sourceId],
    queryFn: () => window.testcard.series.shelves(sourceId ?? undefined),
    staleTime: 60_000,
    enabled: landing,
  });
  const myList = useQuery({
    queryKey: ["series", "favourites", "shelf"],
    queryFn: () => window.testcard.series.favourites(),
    enabled: landing,
  });
  const recentlyWatched = useQuery({
    queryKey: ["series", "recent", "shelf"],
    queryFn: () => window.testcard.series.recent(),
    enabled: landing,
  });
  useEffect(() => {
    if (shelves.data !== undefined) setNoShelves(shelves.data.length === 0);
  }, [shelves.data]);
  const inSource = (row: SeriesListRow) => sourceId === null || row.source_id === sourceId;
  const myListRows = (myList.data ?? []).filter(inSource).slice(0, 20);
  const recentRows = (recentlyWatched.data ?? []).filter(inSource).slice(0, 20);

  const detail = useQuery({
    queryKey: ["series", "episodes", selectedSeriesId],
    queryFn: () => window.testcard.series.episodes(selectedSeriesId as string),
    enabled: selectedSeriesId !== null,
  });

  const favourite = useMutation({
    mutationFn: (seriesId: string) => window.testcard.series.toggleFavourite(seriesId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["series"] }),
  });

  const removeFromHistory = useMutation({
    mutationFn: (seriesId: string) => window.testcard.series.removeFromHistory(seriesId),
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

  const closeDrawer = useCallback(() => {
    setSelectedSeriesId(null);
    setSeasonId(null);
  }, []);

  // What "play" means for this series: pick up the episode in progress, else the first one not yet
  // watched, else start from the top.
  const next = useMemo(() => {
    const all = detail.data?.seasons.flatMap((season) => season.episodes.map((episode) => ({ season, episode }))) ?? [];
    const inProgress = all.find(({ episode }) => episode.position_secs !== null && shouldPromptResume(episode.position_secs, episode.duration_secs));
    if (inProgress) return { ...inProgress, resume: true };
    const unwatched = all.find(({ episode }) => episode.watched !== 1);
    const target = unwatched ?? all[0];
    return target ? { ...target, resume: false } : null;
  }, [detail.data]);

  const activeSeason = detail.data?.seasons.find((season) => season.id === seasonId) ?? next?.season ?? detail.data?.seasons[0];

  const rows = list.data ?? [];

  const heading = scope === "favourites" ? "Favourite series" : scope === "recent" ? "Recently watched series" : "Series";
  const empty = list.isError ? (
    <EmptyState icon="layers" title="Couldn't load series" hint="Refresh your source from Account, then try again." />
  ) : searching ? (
    <EmptyState icon="search" title={`Nothing matches “${debounced}”`} hint="Check the spelling or clear the search." />
  ) : scope === "favourites" ? (
    <EmptyState icon="star" title="No favourite series yet" hint="Open a series and press the star to keep it here." />
  ) : scope === "recent" ? (
    <EmptyState icon="clock" title="Nothing watched yet" hint="Series you play show up here." />
  ) : (
    <EmptyState icon="layers" title="No series" hint="Add a source with series in Account, or turn Series on for one, then refresh it." />
  );

  const series = detail.data?.series;
  const sources = useSources().data ?? [];
  const sourceName = sources.length > 1 ? sources.find((source) => source.id === series?.source_id)?.name : undefined;
  const seriesTitle = series !== undefined ? splitTitle(series.name) : null;
  const rating = series?.rating && Number(series.rating) > 0 ? Number(series.rating).toFixed(1) : null;
  const seasonCount = detail.data?.seasons.length ?? 0;

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

      {scope === "browse" && (
        <>
          <GenreBar
            options={genreOptions((categories.data ?? []).map((c) => ({ genre: c.genre, count: c.series_count })))}
            value={genre}
            onChange={pickGenre}
          />
          <CategoryBar
            allLabel="Home"
            categories={(categories.data ?? [])
              .filter((c) => genre === null || c.genre === genre)
              .map((c) => ({ id: c.id, name: c.name, count: c.series_count }))}
            value={categoryId}
            onChange={pickCategory}
          />
        </>
      )}

      <div className="pw-scroll">
        {landing ? (
          <>
            <PosterShelf
              title="Recently watched"
              items={recentRows.map(toPoster)}
              onSelect={setSelectedSeriesId}
              onRemove={(id) => removeFromHistory.mutate(id)}
            />
            <PosterShelf title="My list" items={myListRows.map(toPoster)} onSelect={setSelectedSeriesId} />
            {(shelves.data ?? []).map((shelf) => (
              <PosterShelf
                key={shelf.category.id}
                title={displayName(shelf.category.name)}
                items={shelf.items.map(toPoster)}
                onSelect={setSelectedSeriesId}
                onSeeAll={() => pickCategory(shelf.category.id)}
              />
            ))}
            {shelves.data !== undefined && shelves.data.length > 0 && (
              <div className="pw-browse-all">
                <button type="button" className="btn btn--ghost" onClick={() => setBrowseAll(true)}>
                  Browse all series
                </button>
              </div>
            )}
          </>
        ) : rows.length === 0 ? (
          list.isFetching || list.isPending ? null : empty
        ) : (
          <PosterGrid
            items={rows.map((row) => ({ id: row.id, name: row.name, posterUrl: row.poster_url, favourite: row.is_favourite === 1 }))}
            onSelect={setSelectedSeriesId}
            {...(scope === "recent" ? { onRemove: (id: string) => removeFromHistory.mutate(id) } : {})}
          />
        )}
      </div>

      {selectedSeriesId !== null && (
        <Drawer label="Series details" backdropUrl={series?.poster_url ? logoSrc(series.poster_url) : null} onClose={closeDrawer}>
          {series !== undefined && seriesTitle !== null && detail.data !== undefined ? (
            <>
              <div className="pw-detail-top">
                {series.poster_url && <img className="pw-detail-poster" src={logoSrc(series.poster_url)} alt="" referrerPolicy="no-referrer" />}
                <div className="pw-detail-heading">
                  <h3>{seriesTitle.title}</h3>
                  <p className="pw-detail-meta">
                    {[
                      seriesTitle.year,
                      seasonCount > 0 ? `${seasonCount} ${seasonCount === 1 ? "season" : "seasons"}` : null,
                      rating !== null ? `Rated ${rating}` : null,
                      seriesTitle.is4k ? "4K" : null,
                      sourceName ?? null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join("   ")}
                  </p>
                </div>
              </div>

              <div className="pw-detail-actions">
                {next !== null && (
                  <button type="button" className="btn btn--primary" onClick={() => playEpisode(next.episode.id, next.resume)}>
                    <Icon name="play" />
                    {next.resume ? "Continue" : "Play"} S{next.season.season_number} E{next.episode.episode_number}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => favourite.mutate(series.id)}
                  aria-pressed={series.is_favourite === 1}
                >
                  <Icon name="star" filled={series.is_favourite === 1} />
                  {series.is_favourite === 1 ? "In favourites" : "Add to favourites"}
                </button>
              </div>

              {series.plot && <p className="pw-detail-plot">{series.plot}</p>}

              {seasonCount === 0 ? (
                <p className="pw-detail-plot pw-detail-plot--none">No episodes listed for this series yet.</p>
              ) : (
                <>
                  {seasonCount > 1 && (
                    <div className="pw-seasons" role="tablist" aria-label="Season">
                      {detail.data.seasons.map((season) => (
                        <button
                          key={season.id}
                          type="button"
                          role="tab"
                          className="pw-chip"
                          data-active={activeSeason?.id === season.id}
                          aria-selected={activeSeason?.id === season.id}
                          onClick={() => setSeasonId(season.id)}
                        >
                          {season.name ?? `Season ${season.season_number}`}
                        </button>
                      ))}
                    </div>
                  )}
                  {activeSeason && (
                    <ul className="pw-episode-list">
                      {activeSeason.episodes.map((episode) => (
                        <EpisodeItem key={episode.id} episode={episode} onPlay={playEpisode} />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          ) : (
            <p className="pw-detail-loading">Loading episodes…</p>
          )}
        </Drawer>
      )}
    </main>
  );
}
