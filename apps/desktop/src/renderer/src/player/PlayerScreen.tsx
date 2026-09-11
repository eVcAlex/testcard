import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChannelRow } from "@testcard/core";
import { Sidebar, type BrowseTab } from "./Sidebar.js";
import { BrowseView } from "./BrowseView.js";
import { GuideView } from "./GuideView.js";
import { SourcesView } from "./SourcesView.js";
import { PlayerView } from "./PlayerView.js";
import { usePlaybackEvents } from "./usePlaybackEvents.js";
import { useTheme } from "./useTheme.js";
import "./player.css";

export function PlayerScreen() {
  const { theme, toggle } = useTheme();
  const { state, play, retry } = usePlaybackEvents();
  const [tab, setTab] = useState<BrowseTab>("live");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [inPlayer, setInPlayer] = useState(false);
  const [playlist, setPlaylist] = useState<readonly ChannelRow[]>([]);

  const vlc = useQuery({
    queryKey: ["vlc-available"],
    queryFn: () => window.testcard.playback.vlcAvailable(),
    staleTime: Infinity,
  });

  // First run: land on the Sources screen instead of an empty channel grid. One-shot — the
  // query key is shared with Sidebar's own ["sources"] query, so this adds no extra fetch.
  const firstRunHandled = useRef(false);
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => window.testcard.sources.list(),
  });
  useEffect(() => {
    if (firstRunHandled.current || sources.data === undefined) return;
    firstRunHandled.current = true;
    if (sources.data.length === 0) setTab("sources");
  }, [sources.data]);

  useEffect(() => {
    return () => void window.testcard.playback.stop();
  }, []);

  const onPlay = useCallback(
    (channel: ChannelRow) => {
      play(channel.id, channel.normalised_name);
      setInPlayer(true);
    },
    [play],
  );

  const onBack = useCallback(() => {
    setInPlayer(false);
    void window.testcard.playback.stop();
    void window.testcard.view.isFullscreen().then((fs) => {
      if (fs) void window.testcard.view.toggleFullscreen();
    });
  }, []);

  // Step through the current browse list — driven by the overlay's prev/next buttons (which
  // have no list context) and by keyboard. Wraps around.
  const activeChannelId = state.status === "idle" ? null : state.channelId;
  const step = useCallback(
    (delta: number) => {
      if (playlist.length === 0) return;
      const current = activeChannelId === null ? -1 : playlist.findIndex((c) => c.id === activeChannelId);
      const nextIndex = current === -1 ? 0 : (current + delta + playlist.length) % playlist.length;
      const next = playlist[nextIndex];
      if (next) onPlay(next);
    },
    [playlist, activeChannelId, onPlay],
  );

  // Overlay actions arrive as events; keep the listener itself stable.
  const stepRef = useRef(step);
  const onBackRef = useRef(onBack);
  stepRef.current = step;
  onBackRef.current = onBack;
  useEffect(() => {
    if (!window.testcard?.events) return;
    return window.testcard.events.onPlayback((event) => {
      if (event.type === "exit-player") onBackRef.current();
      else if (event.type === "channel-step") stepRef.current(event.delta);
    });
  }, []);

  return (
    <div className="pw-app">
      <Sidebar
        tab={tab}
        onTab={setTab}
        categoryId={categoryId}
        onCategory={setCategoryId}
        theme={theme}
        onToggleTheme={toggle}
      />
      {tab === "sources" ? (
        <SourcesView />
      ) : tab === "guide" ? (
        <GuideView
          categoryId={categoryId}
          activeChannelId={activeChannelId}
          onPlay={onPlay}
          onListChange={setPlaylist}
        />
      ) : (
        <BrowseView
          tab={tab}
          categoryId={categoryId}
          activeChannelId={activeChannelId}
          onPlay={onPlay}
          onListChange={setPlaylist}
        />
      )}
      {inPlayer && (
        <PlayerView
          state={state}
          vlcAvailable={vlc.data === true}
          onRetry={retry}
          onBack={onBack}
          onStep={step}
        />
      )}
    </div>
  );
}
