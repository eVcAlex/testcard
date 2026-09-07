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
