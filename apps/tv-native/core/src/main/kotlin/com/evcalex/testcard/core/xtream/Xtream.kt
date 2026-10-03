package com.evcalex.testcard.core.xtream

import com.evcalex.testcard.core.crypto.Base64
import com.evcalex.testcard.core.normalise.jsNumber
import com.evcalex.testcard.core.normalise.jsTrim
import com.evcalex.testcard.core.sync.XtreamLogin
import com.evcalex.testcard.core.sync.await
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request

/** How long a provider gets to start answering before the request is given up (`RESPONSE_TIMEOUT_MS`). */
private const val RESPONSE_TIMEOUT_SECS = 20L

internal const val DID_NOT_RESPOND = "The provider did not respond. Try again in a moment."

/** `String(value)` of a JSON value as JavaScript prints it: 123.0 is "123". Null for a missing or null value. */
fun JsonElement?.jsString(): String? {
    val primitive = this as? JsonPrimitive ?: return null
    if (primitive is JsonNull) return null
    if (primitive.isString) return primitive.content
    val number = primitive.content.toDoubleOrNull()
    return if (number != null && number == Math.floor(number) && Math.abs(number) < 1e21) number.toLong().toString() else primitive.content
}

/** The value as text only when it is a non-empty string, as the DTO mappers check `x !== undefined && x !== ""`. */
private fun JsonElement?.nonEmpty(): String? = jsString()?.takeIf { it.isNotEmpty() }

/** `toFiniteNumber`: a finite number above zero, or null. */
private fun JsonElement?.positiveNumber(): Double? {
    val primitive = this as? JsonPrimitive ?: return null
    if (primitive is JsonNull) return null
    val n = if (primitive.isString) jsNumber(primitive.content) else primitive.content.toDoubleOrNull()
    return n?.takeIf { it.isFinite() && it > 0 }
}

/**
 * The provider's `player_api.php`, with the login added to every call. Never logs or throws a URL: it carries the login.
 * `loginOf` is asked on every call, so a backup server taking over is used from the next request.
 */
class XtreamApi(private val loginOf: () -> XtreamLogin, http: OkHttpClient = OkHttpClient()) {
    constructor(login: XtreamLogin, http: OkHttpClient = OkHttpClient()) : this({ login }, http)

    internal val http = http.newBuilder().readTimeout(RESPONSE_TIMEOUT_SECS, TimeUnit.SECONDS).build()

    val login: XtreamLogin get() = loginOf()

    fun url(action: String, params: Map<String, String> = emptyMap()): HttpUrl {
        val login = loginOf()
        return "${login.baseUrl}/player_api.php".toHttpUrl().newBuilder()
            .addQueryParameter("username", login.username).addQueryParameter("password", login.password).addQueryParameter("action", action)
            .apply { params.forEach { (key, value) -> addQueryParameter(key, value) } }
            .build()
    }

    /** The reply parsed (off the caller's thread: a big catalogue is megabytes of JSON). `explain` adds the provider's own words to a failure. */
    suspend fun call(action: String, params: Map<String, String> = emptyMap(), explain: Boolean = false): JsonElement {
        val response = try {
            http.newCall(Request.Builder().url(url(action, params)).header("User-Agent", "node").build()).await()
        } catch (_: SocketTimeoutException) {
            throw IllegalStateException(DID_NOT_RESPOND)
        }
        return response.use {
            if (!it.isSuccessful) {
                // The provider's own words say why ("blocked", "too many connections"). Never the URL.
                val reason = if (explain) runCatching { it.body.string() }.getOrDefault("").replace(Regex("<[^>]*>"), " ").replace(Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+"), " ").jsTrim().take(100) else ""
                throw IllegalStateException("Xtream $action failed: HTTP ${it.code}${if (reason == "") "" else " ($reason)"}")
            }
            withContext(Dispatchers.Default) { Json.parseToJsonElement(it.body.byteStream().bufferedReader().readText()) }
        }
    }

    /** A call that answers `null` instead of failing (`!response.ok` → undefined/empty in the TS). */
    suspend fun callOrNull(action: String, params: Map<String, String> = emptyMap()): JsonElement? = try {
        call(action, params)
    } catch (_: IllegalStateException) {
        null
    }
}

// -------------------------------------------------------------------------------------------------
// Detecting a login (detect.ts)

/** Extracts credentials from a pasted `get.php` link or a raw stream URL, with no network call. */
fun extractXtreamCredentials(url: String): XtreamLogin? {
    val parsed = url.toHttpUrlOrNull() ?: return null
    val base = "${parsed.scheme}://${hostWithPort(parsed)}"
    val username = parsed.queryParameter("username")
    val password = parsed.queryParameter("password")
    if (!username.isNullOrEmpty() && !password.isNullOrEmpty()) return XtreamLogin(base, username, password)
    val segments = parsed.encodedPath.split("/").filter { it.isNotEmpty() }
    if (segments.size >= 2) return XtreamLogin(base, segments[0], segments[1])
    return null
}

/** `URL.host`: the host, with the port unless it is the scheme's default. */
internal fun hostWithPort(url: HttpUrl): String {
    val host = if (':' in url.host) "[${url.host}]" else url.host
    return if (url.port == HttpUrl.defaultPort(url.scheme)) host else "$host:${url.port}"
}

/** Confirms the credentials work against `player_api.php` with no `action` (an auth check). */
suspend fun probeXtream(login: XtreamLogin, http: OkHttpClient = OkHttpClient()): Boolean {
    val url = "${login.baseUrl}/player_api.php".toHttpUrl().newBuilder().addQueryParameter("username", login.username).addQueryParameter("password", login.password).build()
    val response = http.newCall(Request.Builder().url(url).header("User-Agent", "node").build()).await()
    return response.use {
        if (!it.isSuccessful) return@use false
        val body = runCatching { Json.parseToJsonElement(it.body.string()) as? JsonObject }.getOrNull()
        ((body?.get("user_info") as? JsonObject)?.get("auth") as? JsonPrimitive)?.takeIf { p -> !p.isString }?.content == "1"
    }
}

/** What an Xtream provider says about the account itself: when it ends and how many streams it may run at once. */
class XtreamAccount(
    /** Unix ms; null when the provider gives none (an account that does not expire). */
    val expiresAt: Long?,
    val maxConnections: Int?,
    val activeConnections: Int?,
    /** The provider's word for it: "Active", "Expired", "Banned", "Disabled"... */
    val status: String?,
    val trial: Boolean,
)

private fun numberOrNull(value: JsonElement?): Double? {
    val primitive = value as? JsonPrimitive ?: return null
    if (primitive is JsonNull) return null
    val n = if (primitive.isString) (if (primitive.content.jsTrim().isEmpty()) null else jsNumber(primitive.content)) else primitive.content.toDoubleOrNull()
    return n?.takeIf { it.isFinite() }
}

/** The account's `user_info` from `player_api.php`. Null when the provider does not answer with one. */
suspend fun fetchXtreamAccount(login: XtreamLogin, http: OkHttpClient = OkHttpClient()): XtreamAccount? {
    val url = "${login.baseUrl}/player_api.php".toHttpUrl().newBuilder().addQueryParameter("username", login.username).addQueryParameter("password", login.password).build()
    val response = http.newCall(Request.Builder().url(url).header("User-Agent", "node").build()).await()
    val info = response.use {
        if (!it.isSuccessful) return null
        runCatching { (Json.parseToJsonElement(it.body.string()) as? JsonObject)?.get("user_info") as? JsonObject }.getOrNull()
    } ?: return null
    val expires = numberOrNull(info["exp_date"])
    return XtreamAccount(
        expiresAt = if (expires != null && expires > 0) (expires * 1000).toLong() else null,
        maxConnections = numberOrNull(info["max_connections"])?.toInt(),
        activeConnections = numberOrNull(info["active_cons"])?.toInt(),
        status = (info["status"] as? JsonPrimitive)?.takeIf { it.isString && it.content != "" }?.content,
        trial = (info["is_trial"] as? JsonPrimitive)?.let { (it.isString && it.content == "1") || (!it.isString && it.content == "1") } == true,
    )
}

// -------------------------------------------------------------------------------------------------
// Films, series and their detail (vod.ts)

class XCategory(val id: String, val sourceId: String, val providerId: String, val rawName: String)

class XMovie(
    val id: String,
    val sourceId: String,
    val categoryId: String,
    val providerStreamId: String,
    val name: String,
    val posterUrl: String?,
    val containerExtension: String?,
    val rating: String?,
)

class XSeries(
    val id: String,
    val sourceId: String,
    val categoryId: String,
    val providerSeriesId: String,
    val name: String,
    val posterUrl: String?,
    val rating: String?,
    val plot: String?,
)

class XSeason(val id: String, val seriesId: String, val seasonNumber: Int, val name: String?, val posterUrl: String?)

class XEpisode(
    val id: String,
    val seasonId: String,
    val seriesId: String,
    val providerEpisodeId: String,
    val episodeNumber: Int,
    val name: String,
    val containerExtension: String?,
    val durationSecs: Double?,
    val plot: String?,
    val imageUrl: String?,
)

private fun JsonElement?.obj(): JsonObject? = this as? JsonObject

fun mapCategories(reply: JsonElement, sourceId: String): List<XCategory> = (reply as JsonArray).map { item ->
    val dto = item as JsonObject
    val providerId = dto["category_id"].jsString() ?: ""
    XCategory("$sourceId:$providerId", sourceId, providerId, dto["category_name"].jsString() ?: "")
}

private fun ratingOf(dto: JsonObject): String? = dto["rating"].jsString()?.takeIf { it != "" && it != "0" }

fun mapMovieDto(dto: JsonObject, sourceId: String, category: XCategory): XMovie {
    val streamId = dto["stream_id"].jsString() ?: ""
    return XMovie("$sourceId:$streamId", sourceId, category.id, streamId, dto["name"].jsString() ?: "", dto["stream_icon"].nonEmpty(), dto["container_extension"].nonEmpty(), ratingOf(dto))
}

fun mapSeriesDto(dto: JsonObject, sourceId: String, category: XCategory): XSeries {
    val seriesId = dto["series_id"].jsString() ?: ""
    return XSeries("$sourceId:$seriesId", sourceId, category.id, seriesId, dto["name"].jsString() ?: "", dto["cover"].nonEmpty(), ratingOf(dto), dto["plot"].nonEmpty())
}

/** JavaScript's own order for an object's keys: integer-like ones ascending first, then the rest as inserted. */
private fun jsKeyOrder(keys: Collection<String>): List<String> {
    fun isIndex(key: String) = key.isNotEmpty() && key.all { it in '0'..'9' } && (key == "0" || key[0] != '0') && key.length < 10
    val (indexes, others) = keys.partition(::isIndex)
    return indexes.sortedBy { it.toLong() } + others
}

private fun episodeDtos(episodes: JsonElement?): List<JsonObject> = when (episodes) {
    is JsonObject -> jsKeyOrder(episodes.keys).flatMap { key ->
        when (val list = episodes[key]) {
            is JsonArray -> list.mapNotNull { it as? JsonObject }
            is JsonObject -> listOf(list)
            else -> emptyList()
        }
    }
    // An empty list is how some panels write "no episodes".
    is JsonArray -> episodes.flatMap { item -> if (item is JsonArray) item.mapNotNull { it as? JsonObject } else listOfNotNull(item as? JsonObject) }
    else -> emptyList()
}

private fun JsonElement?.intOrZero(): Int = (this as? JsonPrimitive)?.let { if (it.isString) jsNumber(it.content) else it.content.toDoubleOrNull() }?.takeIf { it.isFinite() }?.toInt() ?: 0

class SeriesDetails(val seasons: List<XSeason>, val episodes: List<XEpisode>)

fun mapSeriesDetails(reply: JsonObject, series: XSeries): SeriesDetails {
    val seasons = ((reply["seasons"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }).map { s ->
        val number = s["season_number"].intOrZero()
        XSeason("${series.id}:$number", series.id, number, s["name"].nonEmpty(), s["cover"].nonEmpty())
    }.toMutableList()
    // Providers do not always list every season an episode references (season 0 "specials" often has episodes but no
    // `seasons` entry), and `episodes.season_id` is a NOT NULL FK into `seasons`.
    val known = seasons.map { it.seasonNumber }.toMutableSet()
    val dtos = episodeDtos(reply["episodes"])
    for (e in dtos) {
        val season = e["season"].intOrZero()
        if (!known.add(season)) continue
        seasons += XSeason("${series.id}:$season", series.id, season, null, null)
    }
    val episodes = dtos.map { e ->
        val seasonId = "${series.id}:${e["season"].intOrZero()}"
        val info = e["info"].obj()
        val providerId = e["id"].jsString() ?: ""
        XEpisode(
            "$seasonId:$providerId", seasonId, series.id, providerId, e["episode_num"].intOrZero(), e["title"].jsString() ?: "",
            e["container_extension"].nonEmpty(), info?.get("duration_secs").positiveNumber(), info?.get("plot").nonEmpty(), info?.get("movie_image").nonEmpty(),
        )
    }
    return SeriesDetails(seasons, episodes)
}

class VodDetails(val plot: String?, val durationSecs: Double?, val containerExtension: String?)

fun mapVodDetails(reply: JsonObject): VodDetails {
    val info = reply["info"].obj()
    return VodDetails(info?.get("plot").nonEmpty(), info?.get("duration_secs").positiveNumber(), reply["movie_data"].obj()?.get("container_extension").nonEmpty())
}

suspend fun XtreamApi.fetchVodCategories(sourceId: String) = mapCategories(call("get_vod_categories"), sourceId)

suspend fun XtreamApi.fetchMovies(sourceId: String, category: XCategory): List<XMovie> =
    (call("get_vod_streams", mapOf("category_id" to category.providerId)) as JsonArray).map { mapMovieDto(it as JsonObject, sourceId, category) }

suspend fun XtreamApi.fetchSeriesCategories(sourceId: String) = mapCategories(call("get_series_categories"), sourceId)

suspend fun XtreamApi.fetchSeriesList(sourceId: String, category: XCategory): List<XSeries> =
    (call("get_series", mapOf("category_id" to category.providerId)) as JsonArray).map { mapSeriesDto(it as JsonObject, sourceId, category) }

/** `get_series_info`: one API call per series, made lazily. */
suspend fun XtreamApi.fetchSeriesDetails(series: XSeries): SeriesDetails = mapSeriesDetails(call("get_series_info", mapOf("series_id" to series.providerSeriesId)) as JsonObject, series)

/** `get_vod_info`: plot and duration, plus (as a fallback only) `container_extension` for panels that omit it from the bulk call. */
suspend fun XtreamApi.fetchVodDetails(providerStreamId: String): VodDetails = mapVodDetails(call("get_vod_info", mapOf("vod_id" to providerStreamId)) as JsonObject)

// Stream addresses carry the login raw, as the TypeScript does: encoding it would change what the provider sees. Only the player sees them.

fun buildMovieStreamUrl(login: XtreamLogin, providerStreamId: String, containerExtension: String?): String =
    "${login.baseUrl}/movie/${login.username}/${login.password}/$providerStreamId.${containerExtension?.takeIf { it.isNotEmpty() } ?: "mp4"}"

fun buildEpisodeStreamUrl(login: XtreamLogin, providerEpisodeId: String, containerExtension: String?): String =
    "${login.baseUrl}/series/${login.username}/${login.password}/$providerEpisodeId.${containerExtension?.takeIf { it.isNotEmpty() } ?: "mp4"}"

fun buildLiveStreamUrl(login: XtreamLogin, providerStreamId: String): String = "${login.baseUrl}/live/${login.username}/${login.password}/$providerStreamId.ts"

/** Full XMLTV for the account. Credential-bearing: used, never persisted or logged. */
fun xmltvUrl(login: XtreamLogin): String =
    "${login.baseUrl}/xmltv.php".toHttpUrl().newBuilder().addQueryParameter("username", login.username).addQueryParameter("password", login.password).build().toString()

// -------------------------------------------------------------------------------------------------
// Short EPG and catch-up (client.ts, catchup.ts)

/** Xtream base64-encodes EPG text fields. Falls back to the text itself when it is not base64. */
fun base64Decode(value: String): String = try {
    String(Base64.decode(value), Charsets.UTF_8)
} catch (_: Exception) {
    value
}

class ShortEpgListing(val title: String, val startMs: Long, val endMs: Long)

/** The next `limit` programmes for a single stream (now and next by default), read on demand per row. */
suspend fun XtreamApi.fetchShortEpg(streamId: String, limit: Int = 2): List<ShortEpgListing> {
    val body = callOrNull("get_short_epg", mapOf("stream_id" to streamId, "limit" to limit.toString())) as? JsonObject ?: return emptyList()
    return (body["epg_listings"] as? JsonArray).orEmpty().mapNotNull { item ->
        val listing = item as? JsonObject ?: return@mapNotNull null
        val start = listing["start_timestamp"].let { v -> (v as? JsonPrimitive)?.contentOrNull?.let(::jsNumber) } ?: return@mapNotNull null
        val stop = listing["stop_timestamp"].let { v -> (v as? JsonPrimitive)?.contentOrNull?.let(::jsNumber) } ?: return@mapNotNull null
        ShortEpgListing(base64Decode(listing["title"].jsString() ?: ""), (start * 1000).toLong(), (stop * 1000).toLong())
    }
}

class CatchupProgramme(
    val title: String,
    val startMs: Long,
    val endMs: Long,
    /** The start as the provider's own clock wrote it ("2026-09-21 06:30:00"). The timeshift URL is built from this, not from the device's zone. */
    val serverStart: String,
    /** Whether the provider still has this one to play back. */
    val archived: Boolean,
)

/** A provider clock string is "YYYY-MM-DD HH:mm:ss"; anything else cannot be turned into a timeshift address. */
private val SERVER_TIME = Regex("^([0-9]{4}-[0-9]{2}-[0-9]{2})[ T]([0-9]{2}):([0-9]{2})")

/** The "YYYY-MM-DD:HH-mm" a timeshift URL wants, or null if the provider's time is not in the usual form. */
fun timeshiftStamp(serverStart: String): String? = SERVER_TIME.find(serverStart)?.let { "${it.groupValues[1]}:${it.groupValues[2]}-${it.groupValues[3]}" }

/** Whole minutes the programme runs for, at least 1: the timeshift URL asks for a length. */
fun programmeMinutes(startMs: Long, endMs: Long): Int = maxOf(1.0, Math.floor((endMs - startMs) / 60_000.0 + 0.5)).toInt()

/** Every listing the provider returns for the channel, oldest first. Listings it cannot address are dropped. */
suspend fun XtreamApi.fetchCatchupProgrammes(streamId: String): List<CatchupProgramme> {
    val body = callOrNull("get_simple_data_table", mapOf("stream_id" to streamId)) as? JsonObject ?: return emptyList()
    val programmes = mutableListOf<CatchupProgramme>()
    for (item in (body["epg_listings"] as? JsonArray).orEmpty()) {
        val listing = item as? JsonObject ?: continue
        val start = (listing["start_timestamp"] as? JsonPrimitive)?.contentOrNull?.let(::jsNumber)
        val end = (listing["stop_timestamp"] as? JsonPrimitive)?.contentOrNull?.let(::jsNumber)
        val serverStart = listing["start"].jsString()
        val title = listing["title"].jsString()
        if (start == null || end == null || !start.isFinite() || !end.isFinite() || end <= start || serverStart == null || title == null) continue
        programmes += CatchupProgramme(base64Decode(title), (start * 1000).toLong(), (end * 1000).toLong(), serverStart, listing["has_archive"].let { v -> (v as? JsonPrimitive)?.contentOrNull?.let(::jsNumber) } == 1.0)
    }
    return programmes.sortedBy { it.startMs }
}

class CatchupSplit(val current: CatchupProgramme?, val past: List<CatchupProgramme>)

/** The programme airing at `atMs` (if any) and the ones already over, newest first. Only archived ones, within `days`. */
fun splitCatchup(programmes: List<CatchupProgramme>, atMs: Long, days: Int): CatchupSplit {
    val oldest = atMs - days * 86_400_000L
    val usable = programmes.filter { it.archived && timeshiftStamp(it.serverStart) != null }
    return CatchupSplit(usable.firstOrNull { it.startMs <= atMs && atMs < it.endMs }, usable.filter { it.endMs <= atMs && it.startMs >= oldest }.reversed())
}

/** The address that plays `programme` from its start. Only for the player. */
fun buildTimeshiftUrl(login: XtreamLogin, streamId: String, programme: CatchupProgramme): String {
    val stamp = timeshiftStamp(programme.serverStart) ?: throw IllegalStateException("This programme has no catch-up time.")
    return "${login.baseUrl}/timeshift/${login.username}/${login.password}/${programmeMinutes(programme.startMs, programme.endMs)}/$stamp/$streamId.ts"
}
