import { useState } from "react";
import type { ChannelRow } from "@testcard/core";
import { Icon } from "../components/Icon.js";

/** Two-letter fallback when a channel has no usable logo. */
function initials(name: string): string {
  const words = name.replace(/[^a-z0-9 ]/gi, "").trim().split(/\s+/);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase() || "TV";
}

export function ChannelCard({
  channel,
  active,
  onPlay,
  onToggleFavourite,
}: {
  channel: ChannelRow;
  active: boolean;
  onPlay: (channel: ChannelRow) => void;
  onToggleFavourite: (channelId: string) => void;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const showLogo = channel.logo_url !== null && channel.logo_url.length > 0 && !logoFailed;
  const fav = channel.is_favourite === 1;

  // No EPG yet (see plan): the second line falls back to country and the progress bar is
  // hidden. The markup slot stays so wiring XMLTV later is additive.
  const secondLine = channel.country ?? "";

  return (
    <div className="pw-card" data-active={active}>
      <button type="button" className="pw-card-main" onClick={() => onPlay(channel)}>
        <span className="pw-card-logo">
          {showLogo ? (
            <img
              src={channel.logo_url ?? ""}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            initials(channel.normalised_name)
          )}
        </span>

        <span className="pw-card-text">
          <span className="pw-card-name">
            <span>{channel.normalised_name}</span>
            {channel.channel_number !== null && (
              <span className="pw-card-num">{channel.channel_number}</span>
            )}
          </span>
          {secondLine.length > 0 && <span className="pw-card-prog">{secondLine}</span>}
        </span>
      </button>

      <button
        type="button"
        className="pw-card-star"
        data-fav={fav}
        aria-label={fav ? "Remove favourite" : "Add favourite"}
        onClick={() => onToggleFavourite(channel.id)}
      >
        <Icon name="star" filled={fav} />
      </button>
    </div>
  );
}
