import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChannelRow } from "@testcard/core";
import { Sidebar, type BrowseTab } from "./Sidebar.js";
import { BrowseView } from "./BrowseView.js";
import { PlayerView } from "./PlayerView.js";
import { usePlaybackEvents } from "./usePlaybackEvents.js";
import { useTheme } from "./useTheme.js";
import "./player.css";

export function PlayerScreen() {
  const { theme, toggle } = useTheme();
  const { state, play, retry, audioTracks, subtitleTracks, formatLine } = usePlaybackEvents();
  const [tab, setTab] = useState<BrowseTab>("live");
  const [inPlayer, setInPlayer] = useState(false);

  const vlc = useQuery({
    queryKey: ["vlc-available"],
    queryFn: () => window.testcard.playback.vlcAvailable(),
    staleTime: Infinity,
  });

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
  }, []);

  const activeChannelId = state.status === "idle" ? null : state.channelId;

  return (
    <div className="pw-app">
      <Sidebar tab={tab} onTab={setTab} theme={theme} onToggleTheme={toggle} />
      <BrowseView tab={tab} activeChannelId={activeChannelId} onPlay={onPlay} />
      {inPlayer && (
        <PlayerView
          state={state}
          audioTracks={audioTracks}
          subtitleTracks={subtitleTracks}
          formatLine={formatLine}
          vlcAvailable={vlc.data === true}
          onRetry={retry}
          onBack={onBack}
        />
      )}
    </div>
  );
}
