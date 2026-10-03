package com.evcalex.testcard.core.m3u

import com.evcalex.testcard.core.normalise.WS
import com.evcalex.testcard.core.normalise.WORD_END
import com.evcalex.testcard.core.normalise.WORD_START
import com.evcalex.testcard.core.normalise.jsTrim
import java.util.Locale
import okio.BufferedSource

class M3uEntry(val rawName: String, val url: String, val attributes: Map<String, String>, val groupTitle: String?)

sealed interface M3uItem {
    class Header(val urlTvg: String?) : M3uItem
    class Entry(val entry: M3uEntry) : M3uItem
}

private val ATTRIBUTE = Regex("([a-zA-Z0-9-]+)=\"([^\"]*)\"")
private val URL_TVG = Regex("url-tvg=\"([^\"]*)\"")

private fun parseAttributes(extinf: String): Map<String, String> {
    val attributes = LinkedHashMap<String, String>()
    for (match in ATTRIBUTE.findAll(extinf)) attributes[match.groupValues[1]] = match.groupValues[2]
    return attributes
}

private fun parseDisplayName(extinf: String): String {
    val comma = extinf.lastIndexOf(',')
    return if (comma == -1) "" else extinf.substring(comma + 1).jsTrim()
}

/**
 * Streaming EXTM3U parser (port of `parseM3U.ts`): reads the source one line at a time, so a playlist of tens of
 * thousands of entries is never held as text. `\n` and `\r\n` both end a line.
 */
fun parseM3u(source: BufferedSource, onItem: (M3uItem) -> Unit) {
    var pendingExtinf: String? = null
    var headerEmitted = false
    while (true) {
        val line = source.readUtf8Line() ?: break
        val trimmed = line.jsTrim()
        if (trimmed.isEmpty()) continue
        if (trimmed.startsWith("#EXTM3U")) {
            if (!headerEmitted) {
                onItem(M3uItem.Header(URL_TVG.find(trimmed)?.groupValues?.get(1)))
                headerEmitted = true
            }
            continue
        }
        if (trimmed.startsWith("#EXTINF")) {
            pendingExtinf = trimmed
            continue
        }
        if (trimmed.startsWith("#")) continue
        val extinf = pendingExtinf ?: continue
        val attributes = parseAttributes(extinf)
        onItem(M3uItem.Entry(M3uEntry(parseDisplayName(extinf), trimmed, attributes, attributes["group-title"])))
        pendingExtinf = null
    }
}

// ---------------------------------------------------------------------------------------------
// classifyEntry

sealed interface Classified {
    data object Live : Classified
    class Movie(val title: String, val extension: String?) : Classified
    class Episode(val series: String, val season: Int, val episode: Int, val title: String, val extension: String?) : Classified
}

private val VOD_EXTENSIONS = setOf("mp4", "mkv", "avi", "mov", "m4v", "wmv", "flv", "mpg", "mpeg", "webm")
private val LIVE_PATH = Regex("/live/", RegexOption.IGNORE_CASE)
private val MOVIE_PATH = Regex("/(?:movie|movies|vod)/", RegexOption.IGNORE_CASE)
private val SERIES_PATH = Regex("/series/", RegexOption.IGNORE_CASE)
private val SEASON_EPISODE = Regex(
    "^(?<title>.*?)[$WS._\\-:]*[\\[(]?${WORD_START}S(?<season>[0-9]{1,3})[$WS._-]*E(?<episode>[0-9]{1,4})(?![0-9])[\\])]?(?:[$WS._-]*E[0-9]{1,4})*[$WS._\\-:]*(?<rest>.*)\\z",
    RegexOption.IGNORE_CASE,
)
private val CROSS_EPISODE = Regex(
    "^(?<title>.*?)[$WS._\\-:]*${WORD_START}(?<season>[0-9]{1,2})x(?<episode>[0-9]{2,3})$WORD_END[$WS._\\-:]*(?<rest>.*)\\z",
    RegexOption.IGNORE_CASE,
)
private val FILE_EXTENSION = Regex("\\.(?:mkv|mp4|avi|mov|m4v|wmv|flv|mpg|mpeg|webm)\\z", RegexOption.IGNORE_CASE)
private val HAS_SPACE = Regex("[$WS]")
private val DOTS_AND_UNDERSCORES = Regex("[._]+")
private val SPACES = Regex("[$WS]+")
private val SEPARATOR_ENDS = Regex("^[$WS\\-:|]+|[$WS\\-:|]+\\z")

/** Trims separators; turns "The.Wire" style dots and underscores into spaces only when the text has no spaces at all. */
private fun tidy(text: String): String {
    val spaced = if (HAS_SPACE.containsMatchIn(text.jsTrim())) text else text.replace(DOTS_AND_UNDERSCORES, " ")
    return spaced.replace(SPACES, " ").replace(SEPARATOR_ENDS, "").jsTrim()
}

/** The file extension of the URL's path (query and fragment ignored), lower-cased, or null. */
fun urlExtension(url: String): String? {
    val path = url.split('?', '#', limit = 2)[0]
    return Regex("\\.([a-z0-9]{2,5})\\z", RegexOption.IGNORE_CASE).find(path)?.groupValues?.get(1)?.lowercase(Locale.ROOT)
}

private fun parseEpisode(rawName: String): Classified.Episode? {
    val name = rawName.replace(FILE_EXTENSION, "")
    val match = SEASON_EPISODE.find(name) ?: CROSS_EPISODE.find(name) ?: return null
    val series = tidy(match.groups["title"]?.value ?: "")
    if (series == "") return null
    return Classified.Episode(
        series, match.groups["season"]!!.value.toInt(), match.groups["episode"]!!.value.toInt(), tidy(match.groups["rest"]?.value ?: ""), null,
    )
}

/**
 * Decides whether one M3U entry is a live channel, a film or a TV episode, from the stream URL (Xtream-style paths and a
 * video-file extension) and, for episodes, an `S01E02` / `1x02` marker. Anything it cannot place stays live.
 */
fun classifyEntry(rawName: String, url: String): Classified {
    if (LIVE_PATH.containsMatchIn(url)) return Classified.Live
    val extension = urlExtension(url)
    val vodPath = MOVIE_PATH.containsMatchIn(url) || SERIES_PATH.containsMatchIn(url)
    val vodFile = extension != null && extension in VOD_EXTENSIONS
    if (!vodPath && !vodFile) return Classified.Live

    val episode = parseEpisode(rawName)
    if (episode != null && (SERIES_PATH.containsMatchIn(url) || !MOVIE_PATH.containsMatchIn(url))) {
        return Classified.Episode(episode.series, episode.season, episode.episode, episode.title, extension)
    }
    val title = tidy(rawName.replace(FILE_EXTENSION, ""))
    return Classified.Movie(if (title == "") rawName.jsTrim() else title, extension)
}

/** A grouping key that ignores case, punctuation and a trailing "(2019)" so "Show" and "Show (2019)" are one series. */
fun seriesKey(title: String): String =
    title.lowercase(Locale.ROOT).replace(Regex("\\((?:19|20)[0-9]{2}\\)"), " ").replace(Regex("[^a-z0-9]+"), " ").jsTrim().replace(Regex("[$WS]+"), "-")

/** A stable key for a movie title (year kept, so two films with the same name but different years stay apart). */
fun movieKey(title: String): String =
    title.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), " ").jsTrim().replace(Regex("[$WS]+"), "-")
