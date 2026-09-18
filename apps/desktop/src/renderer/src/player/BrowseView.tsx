import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelRow } from "@testcard/core";
import { Icon } from "../components/Icon.js";
import { genreOptions } from "../lib/genres.js";
import { GenreBar } from "./GenreBar.js";
import { ChannelGrid } from "./ChannelGrid.js";
import { logoSrc } from "../lib/logo.js";
import { MoviesView } from "./MoviesView.js";
import { SeriesView } from "./SeriesView.js";
import type { BrowseTab } from "./Sidebar.js";

// "guide", "movies", "series", and "account" never actually reach this component —
// PlayerScreen branches to GuideView/MoviesView/SeriesView/AccountView first — but
// BrowseTab is one shared union, so this stays total.
const TITLES: Record<BrowseTab, string> = {
  live: "Live TV",
  guide: "Guide",
  movies: "Movies",
  series: "Series",
  favourites: "Favourites",
  recent: "Recently watched",
  account: "Account",
};

export function BrowseView({
  sourceId,
  tab,
  categoryId,
  activeChannelId,
  onPlay,
  onListChange,
  onPlaybackStarted,
}: {
  sourceId: string | null;
  tab: BrowseTab;
  categoryId: string | null;
  activeChannelId: string | null;
  onPlay: (channel: ChannelRow) => void;
  /** The ordered list currently shown — PlayerScreen uses it for prev/next channel stepping. */
  onListChange: (rows: readonly ChannelRow[]) => void;
  onPlaybackStarted: () => void;
}) {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [contentType, setContentType] = useState<"live" | "movies" | "series">("live");
  const showSwitcher = tab === "favourites" || tab === "recent";

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 160);
    return () => clearTimeout(id);
  }, [term]);

  const searching = debounced.length > 0;
  const inCategory = categoryId !== null;

  const categories = useQuery({
    queryKey: ["categories", sourceId],
    queryFn: () => window.testcard.channels.categoryList(sourceId ?? undefined),
    staleTime: 60_000,
    enabled: !showSwitcher || contentType === "live",
  });
  const categoryName = useMemo(
    () => categories.data?.find((c) => c.id === categoryId)?.name ?? "Category",
    [categories.data, categoryId],
  );

  const countries = useQuery({
    queryKey: ["channels", "countries", sourceId],
    queryFn: () => window.testcard.channels.countryList(sourceId ?? undefined),
    staleTime: 60_000,
    enabled: !showSwitcher || contentType === "live",
  });

  const list = useQuery({
    queryKey: ["channels", tab, categoryId, searching ? debounced : country, searching, sourceId, genre],
    queryFn: () => {
      const scope = { ...(sourceId !== null ? { sourceId } : {}), ...(genre !== null ? { genre } : {}) };
      if (searching) return window.testcard.channels.search(debounced, sourceId ?? undefined);
      if (tab === "favourites") return window.testcard.channels.favourites();
      if (tab === "recent") return window.testcard.channels.recent();
      if (inCategory) return window.testcard.channels.browse({ categoryId, ...scope });
      return window.testcard.channels.browse({ ...(country !== null ? { country } : {}), ...scope });
    },
    enabled: !showSwitcher || contentType === "live",
    placeholderData: (prev) => prev,
  });

  const recent = useQuery({
    queryKey: ["channels", "recent"],
    queryFn: () => window.testcard.channels.recent(),
    enabled: tab === "live" && !searching && !inCategory && (!showSwitcher || contentType === "live"),
  });

  const favourite = useMutation({
    mutationFn: (channelId: string) => window.testcard.channels.toggleFavourite(channelId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["channels"] }),
  });

  const rows = useMemo(() => list.data ?? [], [list.data]);
  useEffect(() => onListChange(rows), [rows, onListChange]);

  const channelIds = useMemo(() => rows.map((r) => r.id).sort(), [rows]);
  const epg = useQuery({
    queryKey: ["epg", "now-next", channelIds],
    queryFn: () => window.testcard.epg.nowNext(channelIds),
    enabled: channelIds.length > 0 && (!showSwitcher || contentType === "live"),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  // A coarse clock so every card's progress bar advances without re-fetching.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const showChips = tab === "live" && !searching && !inCategory && (countries.data?.length ?? 0) > 0;
  const showRecentStrip =
    tab === "live" && !searching && !inCategory && (recent.data?.length ?? 0) > 0;

  const genres = useMemo(
    () => genreOptions((categories.data ?? []).map((c) => ({ genre: c.genre, count: c.channel_count }))),
    [categories.data],
  );
  const showGenres = tab === "live" && !searching && !inCategory && genres.length > 0;

  const heading = searching ? "Search" : inCategory && tab === "live" ? categoryName : TITLES[tab];

  const emptyText = list.isError
    ? "Couldn't load channels. Try refreshing the source."
    : searching
      ? `Nothing matches “${debounced}”.`
      : inCategory && tab === "live"
        ? "No channels in this category."
        : tab === "favourites"
          ? "No favourites yet. Tap the star on a channel."
          : tab === "recent"
            ? "Nothing played yet."
            : "No channels. Add a source and refresh it.";

  const switcher = showSwitcher ? (
    <div className="pw-segmented" role="tablist" aria-label="Content type">
      {(["live", "movies", "series"] as const).map((ct) => (
        <button
          key={ct}
          type="button"
          role="tab"
          className="pw-segmented-item"
          data-active={contentType === ct}
          aria-selected={contentType === ct}
          onClick={() => setContentType(ct)}
        >
          {ct === "live" ? "Live" : ct === "movies" ? "Movies" : "Series"}
        </button>
      ))}
    </div>
  ) : null;

  // Test `tab` directly (not the derived `showSwitcher` boolean) in each branch condition —
  // TS narrows `tab: BrowseTab` down to "favourites" | "recent" here, matching MoviesView/
  // SeriesView's `scope` prop type; narrowing does not propagate through an intermediate
  // boolean like `showSwitcher`.
  if ((tab === "favourites" || tab === "recent") && contentType === "movies") {
    return <MoviesView scope={tab} onPlaybackStarted={onPlaybackStarted} headerExtra={switcher} />;
  }
  if ((tab === "favourites" || tab === "recent") && contentType === "series") {
    return <SeriesView scope={tab} onPlaybackStarted={onPlaybackStarted} headerExtra={switcher} />;
  }

  return (
    <main className="pw-main">
      <div className="pw-head">
        <h2>{heading}</h2>
        {switcher}
        <div className="pw-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder="Search channels"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            aria-label="Search channels"
          />
        </div>
      </div>

      {showChips && (
        <div className="pw-filters">
          <button
            type="button"
            className="pw-chip"
            data-active={country === null}
            onClick={() => setCountry(null)}
          >
            All
          </button>
          {countries.data?.slice(0, 14).map((c) => (
            <button
              key={c.country}
              type="button"
              className="pw-chip"
              data-active={country === c.country}
              onClick={() => setCountry(c.country)}
            >
              {c.country}
              <span className="pw-chip-count">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {showGenres && <GenreBar options={genres} value={genre} onChange={setGenre} />}

      <div className="pw-scroll">
        {showRecentStrip && (
          <>
            <p className="pw-section-label">Recently watched</p>
            <div className="pw-recent-strip">
              {recent.data?.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  className="pw-recent-tile"
                  aria-label={channel.normalised_name}
                  onClick={() => onPlay(channel)}
                >
                  {channel.logo_url ? (
                    <img src={logoSrc(channel.logo_url)} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <Icon name="tv" />
                  )}
                </button>
              ))}
            </div>
            <p className="pw-section-label">Channels</p>
          </>
        )}

        <ChannelGrid
          channels={rows}
          activeChannelId={activeChannelId}
          {...(epg.data !== undefined ? { nowNext: epg.data } : {})}
          nowMs={nowMs}
          onPlay={onPlay}
          onToggleFavourite={(id) => favourite.mutate(id)}
          empty={emptyText}
        />
      </div>
    </main>
  );
}
