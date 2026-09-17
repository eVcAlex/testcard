/** Small time helpers for the EPG surfaces. First module under `renderer/src/lib/`. */

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

/** `18:30` in the user's locale, from a unix-ms timestamp. */
export function formatClock(ms: number): string {
  return CLOCK.format(new Date(ms));
}

/** How far through `[startMs, endMs]` the moment `nowMs` is, as a 0–100 percentage. */
export function progressPct(startMs: number, endMs: number, nowMs: number): number {
  if (endMs <= startMs) return 0;
  return Math.max(0, Math.min(100, ((nowMs - startMs) / (endMs - startMs)) * 100));
}

/** "just now" / "5m ago" / "3h ago" / "2d ago", for a source's "last refreshed" note. */
export function formatRelative(ms: number, nowMs: number = Date.now()): string {
  const deltaS = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (deltaS < 60) return "just now";
  const minutes = Math.floor(deltaS / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
