package com.evcalex.testcard.core.sync

import com.evcalex.testcard.core.db.KindKeyLabel
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/**
 * A source's secret as it exists on the device, before sealing (`SourceCredentialsPayloadSchema`): an Xtream login or a
 * playlist address, plus what rides with the source (content switches, position, pins, skips, guide address, hidden).
 * `null` means the field was absent: a device that gets none keeps what it has. `epgUrl` has three states.
 */
class SourcePayload(
    val host: String?,
    val username: String?,
    val password: String?,
    val backupHosts: List<String>?,
    val keyHost: String?,
    val playlistUrl: String?,
    val content: SourceContent?,
    val position: Int?,
    val pins: List<KindKeyLabel>?,
    val skips: List<SourceSkip>?,
    val epgPresent: Boolean,
    val epgUrl: String?,
    val hidden: List<KindKeyLabel>?,
) {
    val isPlaylist get() = playlistUrl != null && host == null
}

private fun JsonElement?.string(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
private fun JsonElement?.int(): Int? = (this as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.takeIf { it == Math.floor(it) }?.toInt()

private fun parseContent(element: JsonElement?): SourceContent? {
    val obj = element as? JsonObject ?: return null
    val live = (obj["live"] as? JsonPrimitive)?.booleanOrNull ?: return null
    val movies = (obj["movies"] as? JsonPrimitive)?.booleanOrNull ?: return null
    val series = (obj["series"] as? JsonPrimitive)?.booleanOrNull ?: return null
    return SourceContent(live, movies, series)
}

private fun parseKindList(element: JsonElement?, kinds: Set<String>, minLabel: Int): List<KindKeyLabel>? =
    (element as? JsonArray)?.mapNotNull { item ->
        val obj = item as? JsonObject ?: return@mapNotNull null
        val kind = obj["kind"].string()?.takeIf { it in kinds } ?: return@mapNotNull null
        val key = obj["key"].string()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
        val label = obj["label"].string()?.takeIf { it.length >= minLabel } ?: return@mapNotNull null
        KindKeyLabel(kind, key, label)
    }

/** Parses and validates a decrypted record the way zod does; throws on a shape no device would have sent. */
fun parseSourcePayload(element: JsonElement): SourcePayload {
    val obj = element as? JsonObject ?: throw IllegalArgumentException("A source's record is not an object")
    val host = obj["host"].string()?.takeIf { it.isNotEmpty() }
    val username = obj["username"].string()?.takeIf { it.isNotEmpty() }
    val password = obj["password"].string()?.takeIf { it.isNotEmpty() }
    val playlistUrl = obj["playlistUrl"].string()?.takeIf { it.isNotEmpty() }
    val isXtream = host != null && username != null && password != null
    if (!isXtream && playlistUrl == null) throw IllegalArgumentException("A source's record has neither a login nor a playlist")
    val epg = obj["epgUrl"]
    return SourcePayload(
        host = if (isXtream) host else null,
        username = if (isXtream) username else null,
        password = if (isXtream) password else null,
        backupHosts = (obj["backupHosts"] as? JsonArray)?.mapNotNull { it.string()?.takeIf { s -> s.isNotEmpty() } },
        keyHost = obj["keyHost"].string()?.takeIf { it.isNotEmpty() },
        playlistUrl = playlistUrl,
        content = parseContent(obj["content"]),
        position = obj["position"].int(),
        pins = parseKindList(obj["pins"], setOf("live", "movies", "series"), 1),
        skips = (obj["skips"] as? JsonArray)?.mapNotNull { item ->
            val s = item as? JsonObject ?: return@mapNotNull null
            val key = s["key"].string()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            val from = s["from"].int()?.takeIf { it >= 0 } ?: return@mapNotNull null
            val to = s["to"].int()?.takeIf { it > 0 } ?: return@mapNotNull null
            SourceSkip(key, from, to)
        },
        epgPresent = epg != null && (epg is JsonNull || epg.string()?.isNotEmpty() == true),
        epgUrl = epg.string()?.takeIf { it.isNotEmpty() },
        hidden = parseKindList(obj["hidden"], setOf("live", "movies", "series", "channel"), 0),
    )
}

private fun kindList(items: List<KindKeyLabel>): JsonArray = buildJsonArray { items.forEach { add(buildJsonObject { put("kind", it.kind); put("key", it.key); put("label", it.label) }) } }

/**
 * `encodeSource`: the record as `collectLocalChanges` writes it. Field rules of the TypeScript: `backupHosts` and
 * `hidden` always, `keyHost` when the source has a stored address, `position` only when placed, `pins` for Main only,
 * `skips` only when there are some, `epgUrl` always (null when none).
 */
fun encodeSource(
    login: XtreamLogin?,
    playlistUrl: String?,
    keyHost: String?,
    backupHosts: List<String>,
    content: SourceContent,
    position: Int?,
    pins: List<KindKeyLabel>?,
    skips: List<SourceSkip>,
    epgUrl: String?,
    hidden: List<KindKeyLabel>,
): JsonObject = buildJsonObject {
    if (login != null) {
        put("host", login.baseUrl)
        put("username", login.username)
        put("password", login.password)
        put("backupHosts", buildJsonArray { backupHosts.forEach { add(JsonPrimitive(it)) } })
        if (keyHost != null) put("keyHost", keyHost)
    } else {
        put("playlistUrl", playlistUrl!!)
    }
    put("content", buildJsonObject { put("live", content.live); put("movies", content.movies); put("series", content.series) })
    if (position != null) put("position", position)
    if (pins != null) put("pins", kindList(pins))
    if (skips.isNotEmpty()) put("skips", buildJsonArray { skips.forEach { add(buildJsonObject { put("key", it.key); put("from", it.from); put("to", it.to) }) } })
    put("epgUrl", epgUrl?.let { JsonPrimitive(it) } ?: JsonNull)
    put("hidden", kindList(hidden))
}
