import type Database from "better-sqlite3";

const RESUME_FLOOR_SECS = 30;
const WATCHED_THRESHOLD = 0.95;

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

export interface PlaybackProgressRow {
  readonly item_type: "movie" | "episode";
  readonly item_id: string;
  readonly position_secs: number;
  readonly duration_secs: number | null;
  readonly watched: 0 | 1;
  readonly updated_at: number;
}

export function getPlaybackProgress(db: Database.Database, itemType: "movie" | "episode", itemId: string): PlaybackProgressRow | undefined {
  return db
    .prepare(`SELECT item_type, item_id, position_secs, duration_secs, watched, updated_at FROM playback_progress WHERE item_type = ? AND item_id = ?`)
    .get(itemType, itemId) as PlaybackProgressRow | undefined;
}

/** Upserts the current position, recomputing `watched` from the threshold on every write. */
export function setPlaybackProgress(
  db: Database.Database,
  itemType: "movie" | "episode",
  itemId: string,
  positionSecs: number,
  durationSecs: number | null,
): void {
  const table = itemType === "movie" ? "movies" : "episodes";
  const item = db.prepare(`SELECT remote_key FROM ${table} WHERE id = ?`).get(itemId) as { remote_key: string | null } | undefined;
  const watched = isWatched(positionSecs, durationSecs) ? 1 : 0;
  db.prepare(
    `INSERT INTO playback_progress (item_type, item_id, position_secs, duration_secs, watched, updated_at, remote_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_type, item_id) DO UPDATE SET
       position_secs = excluded.position_secs,
       duration_secs = excluded.duration_secs,
       watched       = excluded.watched,
       updated_at    = excluded.updated_at,
       remote_key    = excluded.remote_key`,
  ).run(itemType, itemId, Math.round(positionSecs), durationSecs, watched, Date.now(), item?.remote_key ?? null);
}
