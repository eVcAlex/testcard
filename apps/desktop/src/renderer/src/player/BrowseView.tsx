import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelRow } from "@testcard/core";
import { Icon } from "../components/Icon.js";
import { ChannelGrid } from "./ChannelGrid.js";
import type { BrowseTab } from "./Sidebar.js";

const TITLES: Record<BrowseTab, string> = {
  live: "Live TV",
  favourites: "Favourites",
  recent: "Recently watched",
};

export function BrowseView({
  tab,
  activeChannelId,
  onPlay,
}: {
  tab: BrowseTab;
  activeChannelId: string | null;
  onPlay: (channel: ChannelRow) => void;
}) {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [country, setCountry] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 160);
    return () => clearTimeout(id);
  }, [term]);

  const searching = debounced.length > 0;

  const countries = useQuery({
    queryKey: ["channels", "countries"],
    queryFn: () => window.testcard.channels.countryList(),
    staleTime: 60_000,
  });

  const list = useQuery({
    queryKey: ["channels", tab, searching ? debounced : country, searching],
    queryFn: () => {
      if (searching) return window.testcard.channels.search(debounced);
      if (tab === "favourites") return window.testcard.channels.favourites();
      if (tab === "recent") return window.testcard.channels.recent();
      return window.testcard.channels.browse(country !== null ? { country } : {});
    },
    placeholderData: (prev) => prev,
  });

  const recent = useQuery({
    queryKey: ["channels", "recent"],
    queryFn: () => window.testcard.channels.recent(),
    enabled: tab === "live" && !searching,
  });

  const favourite = useMutation({
    mutationFn: (channelId: string) => window.testcard.channels.toggleFavourite(channelId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["channels"] }),
  });

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const showChips = tab === "live" && !searching && (countries.data?.length ?? 0) > 0;
  const showRecentStrip = tab === "live" && !searching && (recent.data?.length ?? 0) > 0;

  const emptyText = list.isError
    ? "Couldn't load channels. Try refreshing the source."
    : searching
      ? `Nothing matches “${debounced}”.`
      : tab === "favourites"
        ? "No favourites yet. Tap the star on a channel."
        : tab === "recent"
          ? "Nothing played yet."
          : "No channels. Add a source and refresh it.";

  return (
    <main className="pw-main">
      <div className="pw-head">
        <h2>{searching ? "Search" : TITLES[tab]}</h2>
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
                    <img src={channel.logo_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
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
          onPlay={onPlay}
          onToggleFavourite={(id) => favourite.mutate(id)}
          empty={emptyText}
        />
      </div>
    </main>
  );
}
