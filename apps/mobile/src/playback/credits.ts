import type Database from "better-sqlite3";

/**
 * Where an episode's end credits start, for offering the next episode then rather than at the very end.
 *
 * Providers say nothing about credits, so it is learned: when the viewer moves on to the next episode before
 * one has finished, how long was left is remembered for the series (on this device, in `schema_meta`), and the
 * next episodes offer "Next episode" that far from their end, counting down to it as the streaming apps do.
 * Until then an estimate is used, and without a countdown, since it may still be the programme's last scene.
 */

/** How far from the end the credits are guessed to start before anything is learned: a share of the running time, within bounds. */
export function guessedCreditsSecs(durationSecs: number): number {
  return Math.round(Math.min(120, Math.max(30, durationSecs * 0.03)));
}

/** Learned lengths outside these are taken as the viewer giving up on an episode, not skipping its credits. */
const MIN_LEARNED_SECS = 15;
const MAX_LEARNED_SECS = 480;

const key = (seriesId: string) => `credits:${seriesId}`;

/** The credits' length learned for a series, in seconds, if any. */
export function learnedCreditsSecs(db: Database.Database, seriesId: string): number | undefined {
  try {
    const row = db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get(key(seriesId)) as { value: string } | undefined;
    const secs = row === undefined ? NaN : Number(row.value);
    return Number.isFinite(secs) && secs >= MIN_LEARNED_SECS && secs <= MAX_LEARNED_SECS ? secs : undefined;
  } catch {
    return undefined;
  }
}

/** Remembers that the viewer moved on with `remainingSecs` of an episode left, when that looks like skipping the credits. */
export function noteCreditsSkipped(db: Database.Database, seriesId: string, remainingSecs: number, durationSecs: number): void {
  const secs = Math.round(remainingSecs);
  // Moving on with most of the episode left is not about credits.
  if (secs < MIN_LEARNED_SECS || secs > MAX_LEARNED_SECS || secs > durationSecs * 0.25) return;
  try {
    db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(key(seriesId), String(secs));
  } catch {
    // The estimate is used instead.
  }
}
