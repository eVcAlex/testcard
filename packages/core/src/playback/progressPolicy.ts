const RESUME_FLOOR_SECS = 30;
const WATCHED_THRESHOLD = 0.95;

/**
 * Pure playback-progress policy — no database import, so it's safe to import directly (bypassing
 * `@testcard/core`'s barrel) from renderer code. The barrel (`packages/core/src/index.ts`)
 * wildcard-re-exports every `db/*`/`sync/*` module, including ones that `import Database from
 * "better-sqlite3"` as a value; a bundler evaluates a module's entire re-export graph when
 * anything is imported from it, so a renderer-side value import of ANYTHING from the barrel drags
 * a native Node addon into the browser context and crashes at runtime ("promisify is not a
 * function"). `MoviesView.tsx`/`SeriesView.tsx` import `shouldPromptResume` from this file's path
 * directly for exactly that reason — see the same crash's root cause for the full story.
 */

/** Crossing 95% of duration counts as watched — design spec "Playback, resume, watched state". */
export function isWatched(positionSecs: number, durationSecs: number | null | undefined): boolean {
  if (durationSecs === null || durationSecs === undefined || durationSecs <= 0) return false;
  return positionSecs / durationSecs >= WATCHED_THRESHOLD;
}

/** Whether a load should prompt "Resume from ..." vs. "Start over" rather than just starting at 0. */
export function shouldPromptResume(positionSecs: number, durationSecs: number | null | undefined): boolean {
  if (durationSecs === null || durationSecs === undefined || durationSecs <= 0) return false;
  if (positionSecs < RESUME_FLOOR_SECS) return false;
  return positionSecs / durationSecs < WATCHED_THRESHOLD;
}
