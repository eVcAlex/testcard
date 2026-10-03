package com.evcalex.testcard.core.importing

import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.m3u.Classified
import com.evcalex.testcard.core.m3u.M3uItem
import com.evcalex.testcard.core.m3u.classifyEntry
import com.evcalex.testcard.core.m3u.parseM3u
import com.evcalex.testcard.core.normalise.Catchup
import com.evcalex.testcard.core.normalise.Channel
import com.evcalex.testcard.core.normalise.RawChannelEntry
import com.evcalex.testcard.core.normalise.groupVariants
import com.evcalex.testcard.core.normalise.jsNumber
import com.evcalex.testcard.core.sync.await
import com.evcalex.testcard.core.xtream.DID_NOT_RESPOND
import com.evcalex.testcard.core.xtream.XCategory
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/** A film found in a playlist. `url` is the direct stream URL (M3U has nothing else to identify it by). */
class M3uMovieItem(val url: String, val title: String, val group: String, val extension: String?, val posterUrl: String?)

/** One episode found in a playlist, already split into show / season / episode. */
class M3uEpisodeItem(val url: String, val series: String, val season: Int, val episode: Int, val title: String, val group: String, val extension: String?, val posterUrl: String?)

/** Everything in a playlist that is not a live channel. */
class M3uVodCatalog(val movies: List<M3uMovieItem>, val episodes: List<M3uEpisodeItem>) {
    val isEmpty get() = movies.isEmpty() && episodes.isEmpty()
}

/** One fetch and one parse of a playlist, split by what each entry is. */
class M3uPlaylist(val livePages: List<Pair<XCategory, List<Channel>>>, val vod: M3uVodCatalog, val urlTvg: String?)

private fun openPlaylist(http: OkHttpClient, url: String) =
    http.newBuilder().readTimeout(20, TimeUnit.SECONDS).build().newCall(Request.Builder().url(url).header("User-Agent", "node").build())

/**
 * One fetch and one streaming parse of the playlist (the M3U adapter's `loadEntries`): it is parsed as it streams and
 * never held as text. Films and episodes go to the VOD catalogue; only what is left is a live channel, grouped by
 * `group-title`. The raw entries of a category are let go as it is grouped.
 */
suspend fun loadPlaylist(http: OkHttpClient, sourceId: String, playlistUrl: String, onProgress: (done: Int, total: Int) -> Unit = { _, _ -> }): M3uPlaylist {
    val response = try {
        openPlaylist(http, playlistUrl).await()
    } catch (_: SocketTimeoutException) {
        throw IllegalStateException(DID_NOT_RESPOND)
    }
    val categories = LinkedHashMap<String, XCategory>()
    val entries = LinkedHashMap<String, MutableList<RawChannelEntry>>()
    val movies = ArrayList<M3uMovieItem>()
    val episodes = ArrayList<M3uEpisodeItem>()
    var urlTvg: String? = null
    response.use {
        if (!it.isSuccessful) throw IllegalStateException("Failed to fetch playlist: HTTP ${it.code}")
        withContext(Dispatchers.Default) {
            parseM3u(it.body.source()) { item ->
                if (item is M3uItem.Header) {
                    urlTvg = item.urlTvg
                    return@parseM3u
                }
                if (item !is M3uItem.Entry) return@parseM3u
                val entry = item.entry
                val attributes = entry.attributes
                val group = entry.groupTitle ?: "Uncategorised"
                when (val classified = classifyEntry(entry.rawName, entry.url)) {
                    is Classified.Movie -> movies += M3uMovieItem(entry.url, classified.title, group, classified.extension, attributes["tvg-logo"]?.takeIf { logo -> logo.isNotEmpty() })
                    is Classified.Episode -> episodes += M3uEpisodeItem(
                        entry.url, classified.series, classified.season, classified.episode, classified.title, group, classified.extension,
                        attributes["tvg-logo"]?.takeIf { logo -> logo.isNotEmpty() },
                    )
                    Classified.Live -> {
                        val category = categories.getOrPut(group) { XCategory("$sourceId:cat:$group", sourceId, group, group) }
                        entries.getOrPut(category.id) { mutableListOf() } += RawChannelEntry(
                            sourceId = sourceId,
                            categoryId = category.id,
                            // M3U has no numeric stream id: the URL is the stable provider handle.
                            providerStreamId = entry.url,
                            rawName = entry.rawName,
                            tvgId = attributes["tvg-id"]?.takeIf { id -> id.isNotEmpty() },
                            logoUrl = attributes["tvg-logo"],
                            channelNumber = attributes["tvg-chno"]?.let(::jsNumber)?.toInt(),
                            catchup = attributes["catchup-type"]?.let { type -> Catchup(type, attributes["catchup-days"]?.let(::jsNumber)?.toInt() ?: 0) },
                        )
                    }
                }
            }
        }
    }
    var done = 0
    val pages = withContext(Dispatchers.Default) {
        categories.values.map { category ->
            // Each category's raw entries are let go once grouped.
            (category to groupVariants(entries.remove(category.id).orEmpty()) { "$sourceId:$it" }).also { onProgress(++done, categories.size) }
        }
    }
    return M3uPlaylist(pages, M3uVodCatalog(movies, episodes), urlTvg)
}

private object FirstItemSeen : RuntimeException() {
    private fun readResolve(): Any = FirstItemSeen
}

/** The playlist's `url-tvg` guide address, from its header alone: the rest of the download is dropped. */
suspend fun probePlaylistGuide(http: OkHttpClient, playlistUrl: String): String? {
    val response = openPlaylist(http, playlistUrl).await()
    return response.use {
        if (!it.isSuccessful) return@use null
        var found: String? = null
        // Only the first item matters; throwing out of the parse drops the rest of the download.
        runCatching { parseM3u(it.body.source()) { item -> found = (item as? M3uItem.Header)?.urlTvg; throw FirstItemSeen } }
        found
    }
}

/** A playlist's live channels, imported on their own. */
suspend fun importM3uLive(db: Db, http: OkHttpClient, sourceId: String, playlistUrl: String, onProgress: (done: Int, total: Int) -> Unit = { _, _ -> }): ImportResult {
    val startedAt = nowMs()
    return storeLivePages(db, sourceId, loadPlaylist(http, sourceId, playlistUrl, onProgress).livePages, startedAt)
}
