import type Database from "better-sqlite3";
import { isWatched, shouldPromptResume } from "../playback/progressPolicy.js";

export { isWatched, shouldPromptResume };

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
       remote_key    = excluded.remote_key,
       deleted_at    = NULL`,
  ).run(itemType, itemId, Math.round(positionSecs), durationSecs, watched, Date.now(), item?.remote_key ?? null);
}

/**
 * Forgets where the user was in these items ("remove from history"). A row that has synced is kept as
 * position 0 / unwatched with a deleted_at stamp, so the clear reaches the account's other devices;
 * one that never synced has nothing to tell anyone and is simply dropped.
 */
export function clearPlaybackProgress(db: Database.Database, itemType: "movie" | "episode", itemIds: readonly string[]): void {
  const now = Date.now();
  const clear = db.transaction(() => {
    for (const itemId of itemIds) {
      const row = db.prepare(`SELECT remote_key FROM playback_progress WHERE item_type = ? AND item_id = ?`).get(itemType, itemId) as { remote_key: string | null } | undefined;
      if (row === undefined) continue;
      if (row.remote_key === null) {
        db.prepare(`DELETE FROM playback_progress WHERE item_type = ? AND item_id = ?`).run(itemType, itemId);
      } else {
        db.prepare(`UPDATE playback_progress SET position_secs = 0, watched = 0, updated_at = ?, deleted_at = ? WHERE item_type = ? AND item_id = ?`).run(now, now, itemType, itemId);
      }
    }
  });
  clear();
}

/**
 * Marks titles watched or not by hand ("Mark as watched" / "Mark as unwatched"). Watched sits at the end (so nothing
 * offers to resume it); unwatched goes back to the start. Either way it is a fresh write, stamped now, so it reaches
 * the account's other devices like any other progress, and it overrules the 95% rule until the title is played again.
 */
export function setWatched(db: Database.Database, itemType: "movie" | "episode", itemIds: readonly string[], watched: boolean): void {
  const table = itemType === "movie" ? "movies" : "episodes";
  const now = Date.now();
  const readItem = db.prepare(`SELECT remote_key, duration_secs FROM ${table} WHERE id = ?`);
  const readProgress = db.prepare(`SELECT duration_secs FROM playback_progress WHERE item_type = ? AND item_id = ?`);
  const write = db.prepare(
    `INSERT INTO playback_progress (item_type, item_id, position_secs, duration_secs, watched, updated_at, remote_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_type, item_id) DO UPDATE SET
       position_secs = excluded.position_secs,
       duration_secs = excluded.duration_secs,
       watched       = excluded.watched,
       updated_at    = excluded.updated_at,
       remote_key    = COALESCE(excluded.remote_key, playback_progress.remote_key),
       deleted_at    = NULL`,
  );
  const apply = db.transaction(() => {
    for (const itemId of itemIds) {
      const item = readItem.get(itemId) as { remote_key: string | null; duration_secs: number | null } | undefined;
      if (item === undefined) continue;
      const known = readProgress.get(itemType, itemId) as { duration_secs: number | null } | undefined;
      const durationSecs = known?.duration_secs ?? item.duration_secs;
      write.run(itemType, itemId, watched ? (durationSecs ?? 0) : 0, durationSecs, watched ? 1 : 0, now, item.remote_key);
    }
  });
  apply();
}
