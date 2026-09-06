import type { ChannelRow } from "@testcard/core";
import { ChannelCard } from "./ChannelCard.js";

export function ChannelGrid({
  channels,
  activeChannelId,
  onPlay,
  onToggleFavourite,
  empty,
}: {
  channels: readonly ChannelRow[];
  activeChannelId: string | null;
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
          onPlay={onPlay}
          onToggleFavourite={onToggleFavourite}
        />
      ))}
    </div>
  );
}
