import type { NowNext, Programme } from "../source/types.js";

/**
 * Resolves the current and following Programme for a channel from its Programme rows.
 * Derived at read time — see CONTEXT.md "Now/Next" — never stored as its own row.
 * `programmes` should already be filtered to one channel and does not need to be sorted.
 */
export function resolveNowNext(programmes: readonly Programme[], at: Date = new Date()): NowNext {
  let now: Programme | undefined;
  let next: Programme | undefined;

  for (const programme of programmes) {
    if (programme.start <= at && at < programme.end) {
      now = programme;
    } else if (programme.start > at && (next === undefined || programme.start < next.start)) {
      next = programme;
    }
  }

  return { ...(now !== undefined ? { now } : {}), ...(next !== undefined ? { next } : {}) };
}
