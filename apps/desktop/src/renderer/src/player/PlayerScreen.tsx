import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelRow } from "@testcard/core";
import { Sidebar, type BrowseTab } from "./Sidebar.js";
import { BrowseView } from "./BrowseView.js";
import { GuideView } from "./GuideView.js";
import { MoviesView } from "./MoviesView.js";
import { SeriesView } from "./SeriesView.js";
import { AccountView } from "./AccountView.js";
import { PlayerView } from "./PlayerView.js";
import { usePlaybackEvents } from "./usePlaybackEvents.js";
import { useTheme } from "./useTheme.js";
import "./player.css";

/** A catalogue older than this is refreshed in the background when Movies or Series is opened. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export function PlayerScreen() {
  const { theme, toggle } = useTheme();
  const { state, play, retry } = usePlaybackEvents();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<BrowseTab>("live");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  // Narrows Live TV, Guide, Movies and Series to one source. null = every source.
  const [sourceId, setSourceIdState] = useState<string | null>(() => localStorage.getItem("testcard.sourceFilter"));
  const setSourceId = useCallback((next: string | null) => {
    setSourceIdState(next);
    setCategoryId(null); // categories belong to a source
    if (next === null) localStorage.removeItem("testcard.sourceFilter");
    else localStorage.setItem("testcard.sourceFilter", next);
  }, []);
  const [inPlayer, setInPlayer] = useState(false);
  const [playlist, setPlaylist] = useState<readonly ChannelRow[]>([]);

  const vlc = useQuery({
    queryKey: ["vlc-available"],
    queryFn: () => window.testcard.playback.vlcAvailable(),
    staleTime: Infinity,
  });

  // First run: land on Account (where sources live) instead of an empty channel grid. One-shot — the
  // query key is shared with Sidebar's own ["sources"] query, so this adds no extra fetch.
  const firstRunHandled = useRef(false);
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => window.testcard.sources.list(),
  });
  // A remembered source that has since been removed must not leave every list empty.
  useEffect(() => {
    if (sources.data !== undefined && sourceId !== null && !sources.data.some((source) => source.id === sourceId)) {
      setSourceId(null);
    }
  }, [sources.data, sourceId, setSourceId]);
  // Opening Movies or Series shows what's already on this device straight away; a source whose
  // catalogue is older than STALE_AFTER_MS is refreshed quietly behind it (once per session per
  // source, so a failing provider isn't hammered), and the lists update when it lands.
  const refreshTried = useRef(new Set<string>());
  useEffect(() => {
    if ((tab !== "movies" && tab !== "series") || sources.data === undefined) return;
    const now = Date.now();
    for (const source of sources.data) {
      if (sourceId !== null && source.id !== sourceId) continue;
      if (source.refreshing === true || refreshTried.current.has(source.id)) continue;
      if (!(tab === "movies" ? source.content.movies : source.content.series)) continue;
      if (source.lastRefreshedAt !== undefined && now - source.lastRefreshedAt < STALE_AFTER_MS) continue;
      refreshTried.current.add(source.id);
      void window.testcard.sources
        .refresh(source.id)
        .catch(() => undefined)
        .finally(() => {
          for (const key of ["sources", "movies", "series"]) void queryClient.invalidateQueries({ queryKey: [key] });
        });
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
    }
  }, [tab, sourceId, sources.data, queryClient]);

  useEffect(() => {
    if (firstRunHandled.current || sources.data === undefined) return;
    firstRunHandled.current = true;
    if (sources.data.length === 0) setTab("account");
  }, [sources.data]);

  useEffect(() => {
    // Same dev-only race as usePlaybackEvents' bridge guard below: an HMR/Fast-Refresh remount
    // can run this cleanup against a preload that hasn't (re-)injected yet.
    return () => void window.testcard?.playback.stop();
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
    if (!window.testcard) return;
    // stop() saves the final position first; the movie/series views cache position + "watched",
    // so refetch them or the Resume button won't appear until the detail pane is reopened.
    void window.testcard.playback.stop().then(() => {
      void queryClient.invalidateQueries({ queryKey: ["movies"] });
      void queryClient.invalidateQueries({ queryKey: ["series"] });
    });
    void window.testcard.view.isFullscreen().then((fs) => {
      if (fs) void window.testcard.view.toggleFullscreen();
    });
  }, [queryClient]);

  const onPlaybackStarted = useCallback(() => setInPlayer(true), []);

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
        sourceId={sourceId}
        onSource={setSourceId}
        theme={theme}
        onToggleTheme={toggle}
      />
      {tab === "guide" ? (
        <GuideView
          key={sourceId ?? "all"}
          sourceId={sourceId}
          categoryId={categoryId}
          activeChannelId={activeChannelId}
          onPlay={onPlay}
          onListChange={setPlaylist}
        />
      ) : tab === "movies" ? (
        <MoviesView key={sourceId ?? "all"} sourceId={sourceId} onPlaybackStarted={onPlaybackStarted} />
      ) : tab === "series" ? (
        <SeriesView key={sourceId ?? "all"} sourceId={sourceId} onPlaybackStarted={onPlaybackStarted} />
      ) : tab === "account" ? (
        <AccountView />
      ) : (
        <BrowseView
          key={sourceId ?? "all"}
          sourceId={sourceId}
          tab={tab}
          categoryId={categoryId}
          activeChannelId={activeChannelId}
          onPlay={onPlay}
          onListChange={setPlaylist}
          onPlaybackStarted={onPlaybackStarted}
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
