package com.evcalex.testcard.core.sync

import com.evcalex.testcard.core.nowMs
import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.crypto.Sealed
import com.evcalex.testcard.core.crypto.open
import com.evcalex.testcard.core.crypto.seal
import com.evcalex.testcard.core.db.MAIN_PROFILE
import com.evcalex.testcard.core.db.atomic
import com.evcalex.testcard.core.db.hiddenForSource
import com.evcalex.testcard.core.db.keyPrefix
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.db.textOrNull
import com.evcalex.testcard.core.normalise.jsTrim
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** `localChanges.ts`: what this device pushes and how it applies what it pulls. */
class SyncState(val lastPulledAt: Long, val lastPushedAt: Long)

fun SQLiteConnection.getSyncState(): SyncState {
    val row = one("SELECT last_pulled_at AS lastPulledAt, last_pushed_at AS lastPushedAt FROM sync_state WHERE id = 1") { SyncState(it.getLong(0), it.getLong(1)) }
    if (row != null) return row
    run("INSERT INTO sync_state (id, last_pulled_at, last_pushed_at) VALUES (1, 0, 0)")
    return SyncState(0, 0)
}

fun SQLiteConnection.setSyncState(lastPulledAt: Long? = null, lastPushedAt: Long? = null) {
    getSyncState() // ensures the singleton row exists
    if (lastPulledAt != null) run("UPDATE sync_state SET last_pulled_at = ? WHERE id = 1", lastPulledAt)
    if (lastPushedAt != null) run("UPDATE sync_state SET last_pushed_at = ? WHERE id = 1", lastPushedAt)
}

/** A source's backup server addresses as stored (a JSON array), or none. */
fun parseBackupUrls(value: String?): List<String> {
    if (value.isNullOrEmpty()) return emptyList()
    return try {
        (Json.parseToJsonElement(value) as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString && p.content != "" }?.content } ?: emptyList()
    } catch (_: Exception) {
        emptyList()
    }
}

private fun blankToNull(value: String?): String? = value?.jsTrim()?.takeIf { it.isNotEmpty() }

/**
 * Sources added before they were syncable (M3U ones never were) have no `remote_key` / `sync_updated_at`; give them one
 * so the next push picks them up.
 */
private fun SQLiteConnection.backfillSourceKeys(login: (String) -> XtreamLogin) {
    val rows = query("SELECT id, kind, playlist_url, base_url FROM sources WHERE remote_key IS NULL OR sync_updated_at IS NULL") { arrayOf(it.getText(0), it.getText(1), it.textOrNull(2), it.textOrNull(3)) }
    for (row in rows) {
        val remoteKey = if (row[1] == "m3u") {
            if (row[2].isNullOrEmpty()) continue
            remoteKeyForPlaylist(row[2]!!)
        } else remoteKeyFor(row[3] ?: login(row[0]!!).baseUrl, "source")
        run("UPDATE sources SET remote_key = COALESCE(remote_key, ?), sync_updated_at = COALESCE(sync_updated_at, ?) WHERE id = ?", remoteKey, nowMs(), row[0])
    }
}

/** Sources given a guide address before it was synced were pushed without one. Once, mark those as changed. */
private fun SQLiteConnection.resendSourceGuides() {
    if (one("SELECT 1 FROM schema_meta WHERE key = 'sync_epg_urls_sent'") { it.getLong(0) } != null) return
    run("UPDATE sources SET sync_updated_at = ? WHERE remote_key IS NOT NULL AND epg_url IS NOT NULL AND TRIM(epg_url) <> ''", nowMs())
    run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('sync_epg_urls_sent', '1')")
}

private fun profilePayload(name: String, colour: Int, avatar: String?, pin: String?, position: Int): String = buildJsonObject {
    put("name", name)
    put("colour", colour)
    put("avatar", avatar?.let { JsonPrimitive(it) } ?: JsonNull)
    put("pin", pin?.let { JsonPrimitive(it) } ?: JsonNull)
    put("position", position)
}.toString()

/** The profiles changed since `sinceMs`, sealed, or as tombstones. */
private fun SQLiteConnection.collectProfiles(sinceMs: Long, key: ByteArray): List<WireProfile> = query(
    "SELECT id, name, colour, avatar, pin, position, updated_at AS updatedAt, deleted_at AS deletedAt FROM profiles WHERE updated_at > ?",
    sinceMs,
) { s ->
    val id = s.getText(0)
    val updatedAt = s.getLong(6)
    if (!s.isNull(7)) WireProfile(id, updatedAt, s.getLong(7), null, null)
    else {
        val sealed = seal(profilePayload(s.getText(1), s.getLong(2).toInt(), s.textOrNull(3), s.textOrNull(4), s.getLong(5).toInt()), key)
        WireProfile(id, updatedAt, null, sealed.blob, sealed.iv)
    }
}

private fun SQLiteConnection.collectFavouritesOrRecents(table: String, timestampColumn: String, sinceMs: Long): List<Triple<String, Long, Long>> =
    query("SELECT remote_key, $timestampColumn, updated_at FROM $table WHERE updated_at > ? AND remote_key IS NOT NULL", sinceMs) { Triple(it.getText(0), it.getLong(1), if (it.isNull(2)) 0L else it.getLong(2)) }

/**
 * Builds this device's push: every row changed since `sinceMs`, plus every tombstone recorded since the last push. Source
 * logins come from `login` (the secret store) and are sealed here, right before they leave the device. `profile` is the
 * one whose rows are in the tables now: its favourites, recents, progress and deletes go under its key prefix. Home
 * pins ride in the source's record and are Main's alone.
 */
fun SQLiteConnection.collectLocalChanges(sinceMs: Long, key: ByteArray, login: (String) -> XtreamLogin, profile: String = MAIN_PROFILE): PushRequest {
    val prefix = keyPrefix(profile)
    backfillSourceKeys(login)
    resendSourceGuides()
    class Row(val id: String, val kind: String, val playlistUrl: String?, val baseUrl: String?, val epgUrl: String?, val backupUrls: String?, val remoteKey: String, val name: String, val updatedAt: Long, val live: Boolean, val movies: Boolean, val series: Boolean, val position: Int?)
    val sourceRows = query(
        """SELECT id, kind, playlist_url AS playlistUrl, base_url AS baseUrl, epg_url AS epgUrl, backup_urls AS backupUrls, remote_key, name, sync_updated_at,
                  include_live AS live, include_movies AS movies, include_series AS series, sort_order AS position FROM sources
           WHERE kind IN ('xtream', 'm3u') AND remote_key IS NOT NULL AND sync_updated_at > ?""",
        sinceMs,
    ) {
        Row(
            it.getText(0), it.getText(1), it.textOrNull(2), it.textOrNull(3), it.textOrNull(4), it.textOrNull(5), it.getText(6), it.getText(7), it.getLong(8),
            it.getLong(9) != 0L, it.getLong(10) != 0L, it.getLong(11) != 0L, if (it.isNull(12)) null else it.getLong(12).toInt(),
        )
    }

    val sources = ArrayList<WireSource>()
    for (row in sourceRows) {
        val pins = if (profile == MAIN_PROFILE) pinsForSource(row.id) else null
        val content = SourceContent(row.live, row.movies, row.series)
        val payload: JsonObject = if (row.kind == "m3u") {
            if (row.playlistUrl.isNullOrEmpty()) continue
            encodeSource(null, row.playlistUrl, null, emptyList(), content, row.position, pins, skipsForSource(row.id), blankToNull(row.epgUrl), hiddenForSource(row.id))
        } else {
            encodeSource(login(row.id), null, row.baseUrl, parseBackupUrls(row.backupUrls), content, row.position, pins, skipsForSource(row.id), blankToNull(row.epgUrl), hiddenForSource(row.id))
        }
        val sealed = seal(payload.toString(), key)
        sources += WireSource(row.remoteKey, row.updatedAt, null, row.name, sealed.blob, sealed.iv)
    }

    val tombstones = query("SELECT table_name, remote_key, deleted_at FROM sync_tombstones") { Triple(it.getText(0), it.getText(1), it.getLong(2)) }.groupBy({ it.first }) { it.second to it.third }
    // A source removed on this device: tell the others (no credentials go with it).
    for ((remoteKey, deletedAt) in tombstones["sources"].orEmpty()) sources += WireSource(remoteKey, deletedAt, deletedAt, null, null, null)

    // A delete has no meaningful historical value for `addedAt` / `playedAt`: the deletion time stands in.
    fun favourites(table: String) = (collectFavouritesOrRecents(table, "added_at", sinceMs).map { (k, at, upd) -> WireFavourite(prefix + k, upd, null, at) } +
        tombstones[table].orEmpty().map { (k, at) -> WireFavourite(prefix + k, at, at, at) })
    fun recents(table: String) = (collectFavouritesOrRecents(table, "played_at", sinceMs).map { (k, at, upd) -> WireRecent(prefix + k, upd, null, at) } +
        tombstones[table].orEmpty().map { (k, at) -> WireRecent(prefix + k, at, at, at) })

    val progress = query(
        """SELECT remote_key, item_type, position_secs, duration_secs, watched, updated_at, deleted_at
           FROM playback_progress WHERE updated_at > ? AND remote_key IS NOT NULL""",
        sinceMs,
    ) {
        WireProgress(prefix + it.getText(0), it.getLong(5), if (it.isNull(6)) null else it.getLong(6), it.getText(1), it.getDouble(2).toLong(), if (it.isNull(3)) null else it.getDouble(3).toLong(), it.getLong(4) != 0L)
    }
    val channels = collectChannelHistory(sinceMs)
    return PushRequest(
        sources = sources,
        movieFavourites = favourites("movie_favourites"),
        movieRecents = recents("movie_recents"),
        seriesFavourites = favourites("series_favourites"),
        seriesRecents = recents("series_recents"),
        progress = progress,
        profiles = collectProfiles(sinceMs, key),
        channelFavourites = channels.channelFavourites.map { WireChannelFavourite(prefix + it.remoteKey, it.updatedAt, it.deletedAt, it.addedAt, it.position) },
        channelRecents = channels.channelRecents.map { WireRecent(prefix + it.remoteKey, it.updatedAt, it.deletedAt, it.playedAt) },
    )
}

/** Clears tombstones with `deleted_at <= beforeMs`: only ones actually included in a push that just succeeded. */
fun SQLiteConnection.clearTombstones(beforeMs: Long) = run("DELETE FROM sync_tombstones WHERE deleted_at <= ?", beforeMs)

/**
 * Applies a pull into the local tables, matching each remote row to its local row by `remote_key` (never by local id).
 * A row with no local match yet (a title this device has not imported) is skipped; that is only safe because the caller
 * does not advance its pull cursor past it (the returned `deferredBeforeMs`). `profile` is whose rows are in the tables
 * now: only that profile's rows apply, with their key prefix taken off.
 */
fun SQLiteConnection.applyRemoteChanges(
    pulled: PullResponse,
    key: ByteArray,
    onDecryptedSource: (remoteKey: String, label: String, payload: SourcePayload, updatedAt: Long) -> Unit,
    onRemovedSource: (remoteKey: String, deletedAt: Long) -> Unit,
    profile: String = MAIN_PROFILE,
): Long? {
    var minDeferred: Long? = null
    fun defer(updatedAt: Long) { if (minDeferred == null || updatedAt < minDeferred!!) minDeferred = updatedAt }
    val prefix = keyPrefix(profile)
    // A server that predates profiles sends every row; another profile's are not this one's to apply (and must not hold
    // the cursor back, as a row for a title not here yet does).
    fun mine(remoteKey: String): String? = if (prefix == "") (if (remoteKey.startsWith("p.")) null else remoteKey) else if (remoteKey.startsWith(prefix)) remoteKey.substring(prefix.length) else null

    // Profiles: last write wins. A deleted one goes, with its rows on this device, unless it is the one watching now.
    for (row in pulled.profiles) {
        val local = one("SELECT updated_at FROM profiles WHERE id = ?", row.remoteKey) { it.getLong(0) }
        if (local != null && local >= row.updatedAt) continue
        if (row.deletedAt != null || row.blob == null || row.iv == null) {
            if (row.remoteKey == MAIN_PROFILE) continue
            run(
                """INSERT INTO profiles (id, name, updated_at, deleted_at) VALUES (?, '', ?, ?)
                   ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, deleted_at = excluded.deleted_at""",
                row.remoteKey, row.updatedAt, row.deletedAt ?: row.updatedAt,
            )
            if (row.remoteKey != profile) run("DELETE FROM profile_stash WHERE profile_id = ?", row.remoteKey)
            continue
        }
        val payload = try { Json.parseToJsonElement(open(Sealed(row.blob, row.iv), key)) as? JsonObject } catch (_: Exception) { null } ?: continue
        val name = (payload["name"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotEmpty() } ?: continue
        val colour = (payload["colour"] as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toDoubleOrNull()?.takeIf { it >= 0 && it == Math.floor(it) }?.toInt() ?: continue
        val position = (payload["position"] as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toDoubleOrNull()?.takeIf { it >= 0 && it == Math.floor(it) }?.toInt() ?: continue
        val avatar = (payload["avatar"] as? JsonPrimitive)?.takeIf { it.isString && it.content.isNotEmpty() }?.content
        val pin = (payload["pin"] as? JsonPrimitive)?.takeIf { it.isString && it.content.isNotEmpty() }?.content
        run(
            """INSERT INTO profiles (id, name, colour, avatar, pin, position, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
               ON CONFLICT(id) DO UPDATE SET name = excluded.name, colour = excluded.colour, avatar = excluded.avatar, pin = excluded.pin,
                 position = excluded.position, updated_at = excluded.updated_at, deleted_at = NULL""",
            row.remoteKey, name, colour, avatar, pin, position, row.updatedAt,
        )
    }

    for (source in pulled.sources) {
        // Removed on another device: the caller decides whether this device's copy goes too.
        if (source.deletedAt != null) {
            onRemovedSource(source.remoteKey, source.deletedAt)
            continue
        }
        // A live row always has all three parts; skipped defensively if ever violated.
        if (!source.isLiveWithAllParts()) continue
        val payload = parseSourcePayload(Json.parseToJsonElement(open(Sealed(source.credentialsBlob!!, source.credentialsIv!!), key)))
        onDecryptedSource(source.remoteKey, source.label!!, payload, source.updatedAt)
    }

    atomic {
        for (row in pulled.movieFavourites) {
            val remoteKey = mine(row.remoteKey) ?: continue
            if (row.deletedAt != null) { run("DELETE FROM movie_favourites WHERE remote_key = ?", remoteKey); continue }
            val id = one("SELECT id FROM movies WHERE remote_key = ?", remoteKey) { it.getText(0) }
            if (id == null) { defer(row.updatedAt); continue }
            run(
                """INSERT INTO movie_favourites (movie_id, added_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(movie_id) DO UPDATE SET added_at = excluded.added_at, updated_at = excluded.updated_at
                   WHERE excluded.updated_at > movie_favourites.updated_at""",
                id, row.addedAt, remoteKey, row.updatedAt,
            )
        }
        for (row in pulled.movieRecents) {
            val remoteKey = mine(row.remoteKey) ?: continue
            if (row.deletedAt != null) { run("DELETE FROM movie_recents WHERE remote_key = ?", remoteKey); continue }
            val id = one("SELECT id FROM movies WHERE remote_key = ?", remoteKey) { it.getText(0) }
            if (id == null) { defer(row.updatedAt); continue }
            run(
                """INSERT INTO movie_recents (movie_id, played_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(movie_id) DO UPDATE SET played_at = excluded.played_at, updated_at = excluded.updated_at
                   WHERE excluded.updated_at > movie_recents.updated_at""",
                id, row.playedAt, remoteKey, row.updatedAt,
            )
        }
        for (row in pulled.seriesFavourites) {
            val remoteKey = mine(row.remoteKey) ?: continue
            if (row.deletedAt != null) { run("DELETE FROM series_favourites WHERE remote_key = ?", remoteKey); continue }
            val id = one("SELECT id FROM series WHERE remote_key = ?", remoteKey) { it.getText(0) }
            if (id == null) { defer(row.updatedAt); continue }
            run(
                """INSERT INTO series_favourites (series_id, added_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(series_id) DO UPDATE SET added_at = excluded.added_at, updated_at = excluded.updated_at
                   WHERE excluded.updated_at > series_favourites.updated_at""",
                id, row.addedAt, remoteKey, row.updatedAt,
            )
        }
        for (row in pulled.seriesRecents) {
            val remoteKey = mine(row.remoteKey) ?: continue
            if (row.deletedAt != null) { run("DELETE FROM series_recents WHERE remote_key = ?", remoteKey); continue }
            val id = one("SELECT id FROM series WHERE remote_key = ?", remoteKey) { it.getText(0) }
            if (id == null) { defer(row.updatedAt); continue }
            run(
                """INSERT INTO series_recents (series_id, played_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(series_id) DO UPDATE SET played_at = excluded.played_at, updated_at = excluded.updated_at
                   WHERE excluded.updated_at > series_recents.updated_at""",
                id, row.playedAt, remoteKey, row.updatedAt,
            )
        }
        for (row in pulled.progress) {
            val remoteKey = mine(row.remoteKey) ?: continue
            val table = if (row.itemType == "movie") "movies" else "episodes"
            val id = one("SELECT id FROM $table WHERE remote_key = ?", remoteKey) { it.getText(0) }
            if (id == null) {
                // A cleared position for a title this device does not have has nothing to clear here. Waiting for the
                // title would hold the sync cursor back on it for good when it never comes.
                if (row.deletedAt == null) defer(row.updatedAt)
                continue
            }
            run(
                """INSERT INTO playback_progress (item_type, item_id, position_secs, duration_secs, watched, updated_at, remote_key, deleted_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(item_type, item_id) DO UPDATE SET
                     position_secs = excluded.position_secs, duration_secs = excluded.duration_secs,
                     watched = excluded.watched, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
                   WHERE excluded.updated_at > playback_progress.updated_at""",
                row.itemType, id, row.positionSecs, row.durationSecs, if (row.watched) 1 else 0, row.updatedAt, remoteKey, row.deletedAt,
            )
        }
    }
    // Channels: never deferred (see channelHistory.ts); waiting ones are tried again on every pull.
    applyChannelHistory(
        pulled.channelFavourites.mapNotNull { row -> mine(row.remoteKey)?.let { WireChannelFavourite(it, row.updatedAt, row.deletedAt, row.addedAt, row.position) } },
        pulled.channelRecents.mapNotNull { row -> mine(row.remoteKey)?.let { WireRecent(it, row.updatedAt, row.deletedAt, row.playedAt) } },
    )
    return minDeferred
}
