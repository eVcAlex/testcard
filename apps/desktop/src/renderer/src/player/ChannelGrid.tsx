import type { ChannelRow } from "@testcard/core";
import type { NowNextLite } from "../../../shared/ipc.js";
import { ChannelCard } from "./ChannelCard.js";

export function ChannelGrid({
  channels,
  activeChannelId,
  nowNext,
  nowMs,
  onPlay,
  onToggleFavourite,
  empty,
}: {
  channels: readonly ChannelRow[];
  activeChannelId: string | null;
  nowNext?: Record<string, NowNextLite>;
  nowMs: number;
  onPlay: (channel: ChannelRow) => void;
  onToggleFavourite: (channelId: string) => void;
  empty: string;
}) {
  if (channels.length === 0) {
    return <p className="pw-empty">{empty}</p>;
  }
  return (
    <div className="pw-grid">
      {channels.map((channel) => (
        <ChannelCard
          key={channel.id}
          channel={channel}
          active={channel.id === activeChannelId}
          {...(nowNext?.[channel.id] !== undefined ? { nowNext: nowNext[channel.id] } : {})}
          nowMs={nowMs}
          onPlay={onPlay}
          onToggleFavourite={onToggleFavourite}
        />
      ))}
    </div>
  );
}
