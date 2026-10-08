import { COLLAPSED_ROWS, SLOT_COUNT } from "./data.ts";
import type { Channel, Programme } from "./data.ts";
import { describe, displayName, fmtTime, nowNext, upcoming } from "./state.ts";

const Star = () => (
  <svg className="dm-star" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z" strokeLinejoin="round" /></svg>
);

const times = (p: Programme) => `${fmtTime(p.start)}–${fmtTime(p.end)}`;

/** The on-air programme with its progress, and the one after it. On narrow screens these two are the whole row. */
export function NowNext({ channel, clock }: { channel: Channel; clock: number }) {
  const { now, next, elapsed, total } = nowNext(channel, clock);
  return (
    <>
      <span className="dm-slot dm-s0">
        <span className="dm-lbl">Now</span>
        <b>{now.title}</b>
        <span className="dm-t tnum">{times(now)}</span>
        <progress className="dm-progress" value={elapsed} max={total} />
      </span>
      <span className="dm-slot dm-s1">
        <span className="dm-lbl">Next</span>
        <b>{next ? next.title : "Later"}</b>
        {next && <span className="dm-t tnum">{times(next)}</span>}
      </span>
    </>
  );
}

export interface ChannelListProps {
  id: string;
  channels: readonly Channel[];
  clock: number;
  favs: readonly string[];
  playing: string;
  focus: { channelId: string; slotIndex: number };
  showRaw: boolean;
  /** Narrow screens show the first rows only until expanded. */
  collapsed: boolean;
  hidden?: boolean;
  onPlay?: (channelId: string) => void;
}

/** A listbox of channels with a roving tabindex. Programme cells are decoration: each option carries its own label. */
export function ChannelList({ id, channels, clock, favs, playing, focus, showRaw, collapsed, hidden, onPlay }: ChannelListProps) {
  // The focus can name a channel that is filtered out; then the first row is the tab stop.
  const stop = channels.some((c) => c.id === focus.channelId) ? focus.channelId : channels[0]?.id;
  return (
    <div className="dm-scroll" hidden={hidden}>
      <div className="dm-head" aria-hidden="true">
        <span>Channel</span><span>Now</span><span>Next</span><span>Later</span><span>Later</span>
      </div>
      <div id={id} role="listbox" aria-label="Channels" data-collapsed={collapsed || undefined}>
        {channels.map((c, i) => {
          const fav = favs.includes(c.id);
          const slots = upcoming(c, clock, SLOT_COUNT);
          return (
            <div
              key={c.id}
              id={`dm-ch-${c.id}`}
              role="option"
              className={`dm-row${i >= COLLAPSED_ROWS ? " dm-extra" : ""}`}
              data-id={c.id}
              tabIndex={c.id === stop ? 0 : -1}
              aria-selected={playing === c.id}
              aria-label={describe(c, clock) + (fav ? ", favourite" : "")}
              data-slot={c.id === stop ? focus.slotIndex : undefined}
              onClick={onPlay ? () => onPlay(c.id) : undefined}
            >
              <span className="dm-chan" aria-hidden="true">
                <span className={`dm-logo dm-h${c.hue}`}>{c.initials}</span>
                <span className="dm-name">{displayName(c, showRaw)}</span>
                {!showRaw && <small className="dm-q">{c.quality}</small>}
                {fav && <Star />}
              </span>
              <span className="dm-cells" aria-hidden="true">
                <NowNext channel={c} clock={clock} />
                {slots.slice(2).map((p, k) => (
                  <span key={k} className={`dm-slot dm-s${k + 2}`}>
                    {p && (<><b>{p.title}</b><span className="dm-t tnum">{times(p)}</span></>)}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
