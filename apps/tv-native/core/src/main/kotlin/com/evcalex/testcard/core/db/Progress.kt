package com.evcalex.testcard.core.db

import com.evcalex.testcard.core.nowMs
import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.isWatched

/** `progressQueries.ts`. Item types are "movie" and "episode". */
class PlaybackProgressRow(val itemType: String, val itemId: String, val positionSecs: Double, val durationSecs: Double?, val watched: Boolean, val updatedAt: Long)

fun SQLiteConnection.getPlaybackProgress(itemType: String, itemId: String): PlaybackProgressRow? = one(
    "SELECT item_type, item_id, position_secs, duration_secs, watched, updated_at FROM playback_progress WHERE item_type = ? AND item_id = ?",
    itemType, itemId,
) { PlaybackProgressRow(it.getText(0), it.getText(1), it.getDouble(2), if (it.isNull(3)) null else it.getDouble(3), it.getLong(4) != 0L, it.getLong(5)) }

/** Upserts the current position, recomputing `watched` from the threshold on every write. */
fun SQLiteConnection.setPlaybackProgress(itemType: String, itemId: String, positionSecs: Double, durationSecs: Double?) {
    val table = if (itemType == "movie") "movies" else "episodes"
    val remoteKey = one("SELECT remote_key FROM $table WHERE id = ?", itemId) { it.textOrNull(0) }
    val watched = if (isWatched(positionSecs, durationSecs)) 1 else 0
    run(
        """INSERT INTO playback_progress (item_type, item_id, position_secs, duration_secs, watched, updated_at, remote_key)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(item_type, item_id) DO UPDATE SET
             position_secs = excluded.position_secs,
             duration_secs = excluded.duration_secs,
             watched       = excluded.watched,
             updated_at    = excluded.updated_at,
             remote_key    = excluded.remote_key,
             deleted_at    = NULL""",
        itemType, itemId, Math.round(positionSecs), durationSecs, watched, nowMs(), remoteKey,
    )
}

/**
 * Forgets where the user was in these items ("remove from history"). A row that has synced is kept as position 0 /
 * unwatched with a deleted_at stamp, so the clear reaches the account's other devices; one that never synced is dropped.
 */
fun SQLiteConnection.clearPlaybackProgress(itemType: String, itemIds: List<String>) {
    val now = nowMs()
    atomic {
        for (itemId in itemIds) {
            val row = one("SELECT remote_key FROM playback_progress WHERE item_type = ? AND item_id = ?", itemType, itemId) { it.textOrNull(0) }
            // `one` cannot tell "no row" from "a row with a null key", so ask for the row itself.
            val exists = one("SELECT 1 FROM playback_progress WHERE item_type = ? AND item_id = ?", itemType, itemId) { it.getLong(0) } != null
            if (!exists) continue
            if (row == null) run("DELETE FROM playback_progress WHERE item_type = ? AND item_id = ?", itemType, itemId)
            else run("UPDATE playback_progress SET position_secs = 0, watched = 0, updated_at = ?, deleted_at = ? WHERE item_type = ? AND item_id = ?", now, now, itemType, itemId)
        }
    }
}

/**
 * Marks titles watched or not by hand. Watched sits at the end (so nothing offers to resume it); unwatched goes back to
 * the start. Either way it is a fresh write, stamped now, so it reaches the account's other devices.
 */
fun SQLiteConnection.setWatched(itemType: String, itemIds: List<String>, watched: Boolean) {
    val table = if (itemType == "movie") "movies" else "episodes"
    val now = nowMs()
    atomic {
        for (itemId in itemIds) {
            val item = one("SELECT remote_key, duration_secs FROM $table WHERE id = ?", itemId) { it.textOrNull(0) to (if (it.isNull(1)) null else it.getDouble(1)) } ?: continue
            val known = one("SELECT duration_secs FROM playback_progress WHERE item_type = ? AND item_id = ?", itemType, itemId) { if (it.isNull(0)) null else it.getDouble(0) }
            val durationSecs = known ?: item.second
            run(
                """INSERT INTO playback_progress (item_type, item_id, position_secs, duration_secs, watched, updated_at, remote_key)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(item_type, item_id) DO UPDATE SET
                     position_secs = excluded.position_secs,
                     duration_secs = excluded.duration_secs,
                     watched       = excluded.watched,
                     updated_at    = excluded.updated_at,
                     remote_key    = COALESCE(excluded.remote_key, playback_progress.remote_key),
                     deleted_at    = NULL""",
                itemType, itemId, if (watched) (durationSecs ?: 0.0) else 0.0, durationSecs, if (watched) 1 else 0, now, item.first,
            )
        }
    }
}
