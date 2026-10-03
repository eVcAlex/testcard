package com.evcalex.testcard.core.sync

import com.evcalex.testcard.core.nowMs
import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.atomic
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.db.textOrNull

/**
 * Favourite and recently watched live channels, synced like films' and series' (`channelHistory.ts`). A channel's key on
 * the account is built from its source's key and the provider's key for it. A row can arrive before this device has the
 * channel: it waits in `pending_channel_sync` and is applied once the channel is here.
 */

/** The key of one channel on this device, or null for a channel (or source) that has none. */
fun SQLiteConnection.channelRemoteKey(channelId: String): String? {
    val row = one("SELECT s.id AS sourceId, s.remote_key AS remoteKey FROM channels c JOIN sources s ON s.id = c.source_id WHERE c.id = ?", channelId) { it.getText(0) to it.textOrNull(1) } ?: return null
    return row.second?.let { channelKeyFor(it, row.first, channelId) }
}

/** Records that a favourite or recent channel went, for the next push. */
fun SQLiteConnection.recordChannelTombstone(table: String, channelId: String) {
    val key = channelRemoteKey(channelId) ?: return
    run("INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) VALUES (?, ?, ?)", table, key, nowMs())
}

class ChannelHistory(val channelFavourites: List<WireChannelFavourite>, val channelRecents: List<WireRecent>)

/** The channel favourites and recents changed since `sinceMs`, keyed for the account, with this device's removals. */
fun SQLiteConnection.collectChannelHistory(sinceMs: Long): ChannelHistory {
    val keys = query("SELECT id, remote_key FROM sources") { it.getText(0) to it.textOrNull(1) }.toMap()
    fun keyOf(sourceId: String, channelId: String): String? = keys[sourceId]?.let { channelKeyFor(it, sourceId, channelId) }
    val favourites = ArrayList<WireChannelFavourite>()
    query(
        "SELECT f.channel_id AS id, c.source_id AS sourceId, f.added_at AS addedAt, f.position, f.updated_at AS updatedAt FROM favourites f JOIN channels c ON c.id = f.channel_id WHERE f.updated_at > ?",
        sinceMs,
    ) { arrayOf<Any?>(it.getText(0), it.getText(1), it.getLong(2), if (it.isNull(3)) null else it.getLong(3).toInt(), it.getLong(4)) }.forEach { row ->
        val remoteKey = keyOf(row[1] as String, row[0] as String) ?: return@forEach
        favourites += WireChannelFavourite(remoteKey, row[4] as Long, null, row[2] as Long, row[3] as Int?)
    }
    val recents = ArrayList<WireRecent>()
    query(
        "SELECT r.channel_id AS id, c.source_id AS sourceId, r.played_at AS playedAt, r.updated_at AS updatedAt FROM recents r JOIN channels c ON c.id = r.channel_id WHERE r.updated_at > ?",
        sinceMs,
    ) { arrayOf<Any?>(it.getText(0), it.getText(1), it.getLong(2), it.getLong(3)) }.forEach { row ->
        val remoteKey = keyOf(row[1] as String, row[0] as String) ?: return@forEach
        recents += WireRecent(remoteKey, row[3] as Long, null, row[2] as Long)
    }
    val tombstones = query("SELECT table_name, remote_key, deleted_at FROM sync_tombstones WHERE table_name IN ('channel_favourites', 'channel_recents')") { Triple(it.getText(0), it.getText(1), it.getLong(2)) }
    for ((table, remoteKey, deletedAt) in tombstones) {
        if (table == "channel_favourites") favourites += WireChannelFavourite(remoteKey, deletedAt, deletedAt, deletedAt, null)
        else recents += WireRecent(remoteKey, deletedAt, deletedAt, deletedAt)
    }
    return ChannelHistory(favourites, recents)
}

/** Changes whenever the channels do: a source added, removed or imported again. */
private fun SQLiteConnection.catalogueStamp(): String {
    val row = one("SELECT COUNT(*) AS n, COALESCE(MAX(last_refreshed_at), 0) AS at, COALESCE(SUM(LENGTH(id)), 0) AS ids, (SELECT COUNT(*) FROM channels) AS channels FROM sources") {
        listOf(it.getLong(0), it.getLong(1), it.getLong(2), it.getLong(3))
    }!!
    return row.joinToString(":")
}

/** Every channel's key on this device, worked out when something is left over: there is no column for it, and a source holds thousands. */
private fun SQLiteConnection.channelKeys(): Map<String, String> {
    val byKey = HashMap<String, String>()
    for ((sourceId, remoteKey) in query("SELECT id, remote_key FROM sources WHERE remote_key IS NOT NULL") { it.getText(0) to it.getText(1) }) {
        for (channelId in query("SELECT id FROM channels WHERE source_id = ?", sourceId) { it.getText(0) }) {
            channelKeyFor(remoteKey, sourceId, channelId)?.let { byKey[it] = channelId }
        }
    }
    return byKey
}

/** How long a row for a channel this device does not have waits before it is let go. */
private const val PENDING_FOR_MS = 30L * 24 * 60 * 60 * 1000

private class Pending(val kind: String, val remoteKey: String, val deletedAt: Long?, val updatedAt: Long, val addedAt: Long, val position: Int?, val playedAt: Long, val json: String)

/**
 * Applies pulled channel favourites and recents (already this profile's, prefix off), last write wins, together with any
 * that were waiting for their channel. Returns whether anything changed here.
 */
fun SQLiteConnection.applyChannelHistory(favourites: List<WireChannelFavourite>, recents: List<WireRecent>): Boolean {
    val now = nowMs()
    run("DELETE FROM pending_channel_sync WHERE received_at < ?", now - PENDING_FOR_MS)
    val incoming = favourites.map { Pending("favourite", it.remoteKey, it.deletedAt, it.updatedAt, it.addedAt, it.position, 0, wireJson.encodeToString(WireChannelFavourite.serializer(), it)) } +
        recents.map { Pending("recent", it.remoteKey, it.deletedAt, it.updatedAt, 0, null, it.playedAt, wireJson.encodeToString(WireRecent.serializer(), it)) }
    // Waiting rows can only match once the channels change (a source imported), so they are looked at again only then.
    val stamp = catalogueStamp()
    val recheck = one("SELECT value FROM schema_meta WHERE key = 'pending_channel_stamp'") { it.getText(0) }
    val waiting = if (recheck == stamp) emptyList() else query("SELECT kind, row FROM pending_channel_sync") { it.getText(0) to it.getText(1) }.map { (kind, row) ->
        if (kind == "favourite") wireJson.decodeFromString(WireChannelFavourite.serializer(), row).let { Pending(kind, it.remoteKey, it.deletedAt, it.updatedAt, it.addedAt, it.position, 0, row) }
        else wireJson.decodeFromString(WireRecent.serializer(), row).let { Pending(kind, it.remoteKey, it.deletedAt, it.updatedAt, 0, null, it.playedAt, row) }
    }
    run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('pending_channel_stamp', ?)", stamp)
    if (incoming.isEmpty() && waiting.isEmpty()) return false
    // Most rows are this device's own favourites and recents coming back: those are matched from them alone, and the
    // key of every channel (thousands, hashed one by one) is worked out only when something is left over.
    val own = HashMap<String, String>()
    for (id in query("SELECT channel_id AS id FROM favourites UNION SELECT channel_id FROM recents") { it.getText(0) }) channelRemoteKey(id)?.let { own[it] = id }
    val everyKey: Map<String, String>? = if ((incoming + waiting).any { it.remoteKey !in own }) channelKeys() else null
    fun channelFor(key: String): String? = own[key] ?: everyKey?.get(key)

    var changed = false
    fun apply(entries: List<Pending>, fromWaiting: Boolean) = atomic {
        for (entry in entries) {
            val channelId = channelFor(entry.remoteKey)
            if (channelId == null) {
                // Not here: a removal has nothing to remove; anything else waits for the channel.
                if (entry.deletedAt != null) run("DELETE FROM pending_channel_sync WHERE kind = ? AND remote_key = ?", entry.kind, entry.remoteKey)
                else if (!fromWaiting) run("INSERT OR REPLACE INTO pending_channel_sync (kind, remote_key, row, received_at) VALUES (?, ?, ?, ?)", entry.kind, entry.remoteKey, entry.json, now)
                continue
            }
            if (fromWaiting) run("DELETE FROM pending_channel_sync WHERE kind = ? AND remote_key = ?", entry.kind, entry.remoteKey)
            val table = if (entry.kind == "favourite") "favourites" else "recents"
            val local = one("SELECT updated_at FROM $table WHERE channel_id = ?", channelId) { if (it.isNull(0)) 0L else it.getLong(0) }
            if (local != null && local >= entry.updatedAt) continue
            changed = true
            if (entry.deletedAt != null) {
                if (local != null) run("DELETE FROM $table WHERE channel_id = ?", channelId)
                continue
            }
            if (entry.kind == "favourite") {
                run(
                    """INSERT INTO favourites (channel_id, added_at, position, updated_at) VALUES (?, ?, ?, ?)
                       ON CONFLICT(channel_id) DO UPDATE SET added_at = excluded.added_at, position = excluded.position, updated_at = excluded.updated_at""",
                    channelId, entry.addedAt, entry.position, entry.updatedAt,
                )
            } else {
                run(
                    """INSERT INTO recents (channel_id, played_at, updated_at) VALUES (?, ?, ?)
                       ON CONFLICT(channel_id) DO UPDATE SET played_at = excluded.played_at, updated_at = excluded.updated_at""",
                    channelId, entry.playedAt, entry.updatedAt,
                )
            }
        }
    }
    apply(waiting, true)
    apply(incoming, false)
    return changed
}
