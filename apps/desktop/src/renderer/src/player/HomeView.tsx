import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChannelRow, StartItem } from "@testcard/core";
import { EmptyState } from "../components/EmptyState.js";
import { ChannelCard } from "./ChannelCard.js";
import { PosterShelf } from "./PosterShelf.js";
import type { BrowseTab } from "./Sidebar.js";

/**
 * The landing tab: where you left off, your lists, categories pinned from the rails, and what is new.
 * The same rows as the TV and phone Home, from one place (`buildStartRows`).
 */
export function HomeView({
  sourceId,
  onPlay,
  onPlaybackStarted,
  onTab,
}: {
  sourceId: string | null;
  onPlay: (channel: ChannelRow) => void;
  onPlaybackStarted: () => void;
  onTab: (tab: BrowseTab) => void;
}) {
  const rows = useQuery({
    queryKey: ["home", "rows", sourceId],
    queryFn: () => window.testcard.home.rows(sourceId ?? undefined),
  });
  const [error, setError] = useState<string | null>(null);

  // Movies, series and channels share this page and their ids are only unique within their own kind.
  const open = (item: StartItem) => {
    setError(null);
    if (item.kind === "channel") {
      if (item.channel !== undefined) onPlay(item.channel);
      return;
    }
    const started =
      item.kind === "movie"
        ? window.testcard.playback.playMovie(item.id, { resume: item.resume })
        : window.testcard.home.playSeries(item.id);
    started.then(onPlaybackStarted, (e: unknown) => setError(e instanceof Error ? e.message : "Could not start playback."));
  };

  if (rows.data !== undefined && rows.data.length === 0) {
    return (
      <main className="pw-main">
        <div className="pw-head">
          <h2>Home</h2>
        </div>
        <EmptyState
          icon="tv"
          title="Nothing here yet"
          hint="What you watch, your favourites and any category you pin will show up here."
          action={
            <button type="button" className="btn btn--primary" onClick={() => onTab("live")}>
              Browse Live TV
            </button>
          }
        />
      </main>
    );
  }

  return (
    <main className="pw-main">
      <div className="pw-head">
        <h2>Home</h2>
      </div>
      {error !== null && <p className="msg msg--error">{error}</p>}
      <div className="pw-scroll">
        {(rows.data ?? []).map((row) => {
          const channels = row.items.every((item) => item.kind === "channel");
          if (!channels) {
            return (
              <PosterShelf
                key={row.key}
                title={row.pinned ? `${row.label} · pinned` : row.label}
                items={row.items.map((item) => ({ id: `${item.kind}|${item.id}`, name: item.name, posterUrl: item.imageUrl, progress: item.progress, note: item.note }))}
                onSelect={(tagged) => {
                  const item = row.items.find((candidate) => `${candidate.kind}|${candidate.id}` === tagged);
                  if (item !== undefined) open(item);
                }}
              />
            );
          }
          return (
            <section key={row.key} className="pw-shelf">
              <div className="pw-shelf-head">
                <h3 className="pw-shelf-title">{row.pinned ? `${row.label} · pinned` : row.label}</h3>
              </div>
              <div className="pw-shelf-row pw-shelf-row--channels">
                {row.items.map((item) =>
                  item.channel === undefined ? null : (
                    <ChannelCard
                      key={item.id}
                      channel={item.channel}
                      active={false}
                      nowMs={Date.now()}
                      onPlay={onPlay}
                      onToggleFavourite={(id) => void window.testcard.channels.toggleFavourite(id).then(() => rows.refetch())}
                    />
                  ),
                )}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
