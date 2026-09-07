import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChannelRow } from "@testcard/core";
import type { ProgrammeLite } from "../../../shared/ipc.js";
import { formatClock } from "../lib/time.js";

const PX_PER_MIN = 6;
const WINDOW_MIN = 240;
const SLOT_MIN = 30;
const MAX_CHANNELS = 200;

/** now floored to the half hour, then backed off 30 min so the current programme has room. */
function windowStart(nowMs: number): number {
  const d = new Date(nowMs);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - (d.getMinutes() % SLOT_MIN) - SLOT_MIN);
  return d.getTime();
}

/**
 * The timeline guide: channels down a sticky left gutter, a 4-hour scrolling time axis across
 * the top, programme blocks positioned on a px-per-minute scale, and a "now" rule. Respects the
 * category selected in the sidebar. Heavy, so the channel list is capped — this is a guide, not
 * the full 18k grid.
 */
export function GuideView({
  categoryId,
  activeChannelId,
  onPlay,
  onListChange,
}: {
  categoryId: string | null;
  activeChannelId: string | null;
  onPlay: (channel: ChannelRow) => void;
  onListChange: (rows: readonly ChannelRow[]) => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const fromMs = useMemo(() => windowStart(nowMs), [nowMs]);
  const toMs = fromMs + WINDOW_MIN * 60_000;
  const trackWidth = WINDOW_MIN * PX_PER_MIN;

  const channelsQuery = useQuery({
    queryKey: ["channels", "guide", categoryId],
    queryFn: () =>
      window.testcard.channels.browse(
        categoryId !== null ? { categoryId, limit: MAX_CHANNELS } : { limit: MAX_CHANNELS },
      ),
    placeholderData: (prev) => prev,
  });
  const channels = useMemo(() => channelsQuery.data ?? [], [channelsQuery.data]);
  useEffect(() => onListChange(channels), [channels, onListChange]);

  const channelIds = useMemo(() => channels.map((c) => c.id).sort(), [channels]);
  const epgQuery = useQuery({
    queryKey: ["epg", "window", channelIds, fromMs, toMs],
    queryFn: () => window.testcard.epg.window(channelIds, fromMs, toMs),
    enabled: channelIds.length > 0,
    placeholderData: (prev) => prev,
  });

  const byChannel = useMemo(() => {
    const map = new Map<string, ProgrammeLite[]>();
    for (const programme of epgQuery.data ?? []) {
      const list = map.get(programme.channelId);
      if (list) list.push(programme);
      else map.set(programme.channelId, [programme]);
    }
    return map;
  }, [epgQuery.data]);

  const slots = useMemo(
    () => Array.from({ length: WINDOW_MIN / SLOT_MIN }, (_, i) => fromMs + i * SLOT_MIN * 60_000),
    [fromMs],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledOnce = useRef(false);
  useEffect(() => {
    // Land the view with "now" a little in from the left edge — once, when rows first arrive.
    if (scrolledOnce.current || channels.length === 0 || !scrollRef.current) return;
    scrollRef.current.scrollLeft = ((Date.now() - fromMs) / 60_000) * PX_PER_MIN - 120;
    scrolledOnce.current = true;
  }, [channels.length, fromMs]);

  const nowLeft = ((nowMs - fromMs) / 60_000) * PX_PER_MIN;
  const hasEpg = (epgQuery.data?.length ?? 0) > 0;

  return (
    <main className="pw-guide">
      <div className="pw-guide-head">
        <h2>Guide</h2>
        {!hasEpg && channels.length > 0 && !epgQuery.isLoading && (
          <p className="pw-guide-note">No guide data — add an XMLTV URL to the source and refresh.</p>
        )}
      </div>

      <div className="pw-guide-scroll" ref={scrollRef}>
        <div className="pw-guide-inner" style={{ width: `calc(var(--guide-gutter) + ${trackWidth}px)` }}>
          <div className="pw-guide-ruler">
            <span className="pw-guide-ruler-pad" />
            <div className="pw-guide-ruler-track" style={{ width: trackWidth }}>
              {slots.map((ms) => (
                <span
                  key={ms}
                  className="pw-guide-tick tnum"
                  style={{ left: ((ms - fromMs) / 60_000) * PX_PER_MIN }}
                >
                  {formatClock(ms)}
                </span>
              ))}
            </div>
          </div>

          {channels.map((channel) => (
            <div className="pw-guide-row" key={channel.id} data-active={channel.id === activeChannelId}>
              <button
                type="button"
                className="pw-guide-ch"
                onClick={() => onPlay(channel)}
                title={channel.raw_name}
              >
                <span className="pw-guide-ch-name">{channel.normalised_name}</span>
                {channel.channel_number !== null && (
                  <span className="pw-guide-ch-num tnum">{channel.channel_number}</span>
                )}
              </button>
              <div className="pw-guide-track" style={{ width: trackWidth }}>
                {(byChannel.get(channel.id) ?? []).map((programme) => {
                  const left = Math.max(0, ((programme.startMs - fromMs) / 60_000) * PX_PER_MIN);
                  const right = Math.min(trackWidth, ((programme.endMs - fromMs) / 60_000) * PX_PER_MIN);
                  return (
                    <button
                      key={`${programme.startMs}`}
                      type="button"
                      className="pw-guide-prog"
                      style={{ left, width: Math.max(2, right - left) }}
                      onClick={() => onPlay(channel)}
                      title={`${formatClock(programme.startMs)}–${formatClock(programme.endMs)}  ${programme.title}`}
                    >
                      <span className="pw-guide-prog-name">{programme.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {channels.length > 0 && nowLeft >= 0 && (
            <div
              className="pw-guide-now"
              style={{ left: `calc(var(--guide-gutter) + ${nowLeft}px)` }}
            />
          )}
        </div>
      </div>

      {channels.length === 0 && !channelsQuery.isLoading && (
        <p className="pw-empty">No channels. Add a source and refresh it.</p>
      )}
    </main>
  );
}
