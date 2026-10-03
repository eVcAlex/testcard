package com.evcalex.testcard.core.db

import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.normalise.WS
import com.evcalex.testcard.core.normalise.jsTrim
import com.evcalex.testcard.core.normalise.fallbackRank
import com.evcalex.testcard.core.normalise.sameChannelKey
import com.evcalex.testcard.core.normalise.titleKey
import java.util.Locale

/** `searchQueries.ts`: one box, films, series and live channels. */
class SearchResults(val movies: List<MovieRow>, val series: List<SeriesRow>, val channels: List<ChannelRow>) {
    companion object {
        val Empty = SearchResults(emptyList(), emptyList(), emptyList())
    }
}

/** Shortest query worth running: one letter would match half the catalogue. */
const val MIN_SEARCH_LENGTH = 2

/** Each word must start a word in the title: "spid man" finds "Spider-Man". Quoted so punctuation cannot break the query. */
private fun ftsQuery(text: String): String? {
    val words = text.split(Regex("[$WS]+")).map { it.replace(Regex("[\"*]"), "") }.filter { it.isNotEmpty() }
    return if (words.isEmpty()) null else words.joinToString(" ") { "\"$it\"*" }
}

/** Divider, junk and adult categories are not searchable, as they are not browsable. */
private fun visible(categoryAlias: String) =
    "(' ' || $categoryAlias.tags || ' ') NOT LIKE '% adult %' AND (' ' || $categoryAlias.tags || ' ') NOT LIKE '% junk %' AND (' ' || $categoryAlias.tags || ' ') NOT LIKE '% separator %'"

/** Best matches first, titles with a poster ahead of those without, the same title in another quality shown once. */
fun SQLiteConnection.searchAll(query: String, sourceId: String? = null, perKind: Int = 24): SearchResults {
    val trimmed = query.jsTrim()
    val match = if (trimmed.length >= MIN_SEARCH_LENGTH) ftsQuery(trimmed) else null
    if (match == null) return SearchResults.Empty
    val spare = perKind * 5
    fun scope(alias: String) = if (sourceId != null) " AND $alias.source_id = ?" else ""
    val params = listOfNotNull(match, sourceId).toTypedArray()

    val movies = query(
        """SELECT $MOVIE_COLUMNS
           FROM movies_fts JOIN movies m ON m.rowid = movies_fts.rowid JOIN movie_categories c ON c.id = m.category_id
           WHERE movies_fts MATCH ? AND ${visible("c")} AND ${categoryShown("c", CategoryKind.Movies)}${scope("m")}
           ORDER BY (m.poster_url IS NULL OR m.poster_url = ''), rank LIMIT $spare""",
        *params,
    ) { it.movieRow() }
    val series = query(
        """SELECT $SERIES_COLUMNS
           FROM series_fts JOIN series sr ON sr.rowid = series_fts.rowid JOIN series_categories c ON c.id = sr.category_id
           WHERE series_fts MATCH ? AND ${visible("c")} AND ${categoryShown("c", CategoryKind.Series)}${scope("sr")}
           ORDER BY (sr.poster_url IS NULL OR sr.poster_url = ''), rank LIMIT $spare""",
        *params,
    ) { it.seriesRow() }
    val channels = query(
        """SELECT $CHANNEL_COLUMNS
           FROM channels_fts JOIN channels c ON c.rowid = channels_fts.rowid JOIN categories cat ON cat.id = c.category_id
           WHERE channels_fts MATCH ? AND ${visible("cat")} AND ${channelShown("c")}${scope("c")}
           ORDER BY rank LIMIT $spare""",
        *params,
    ) { it.channelRow() }

    return SearchResults(
        once(movies, { titleKey(it.name) }, perKind),
        once(series, { titleKey(it.name) }, perKind),
        once(channels, { it.normalisedName.lowercase(Locale.ROOT) }, perKind),
    )
}

private fun <T> once(rows: List<T>, keyOf: (T) -> String, limit: Int): List<T> {
    val seen = HashSet<String>()
    val out = ArrayList<T>()
    for (row in rows) {
        if (!seen.add(keyOf(row))) continue
        out += row
        if (out.size == limit) break
    }
    return out
}

/** One way to play a channel: a Variant of it, or of the same channel listed elsewhere. */
class ChannelFeed(val channelId: String, val variantId: String, /** The display name of the channel this feed belongs to. */ val name: String, /** The Variant's quality label ("720p25"), when it has one. */ val quality: String?)

/** Enough to get past a dead stream without trying every copy a large list carries. */
private const val MOST_FEEDS = 8

/**
 * Every way to play a channel, in the order to try them: its own Variants first (best first, as grouped), then the same
 * channel listed in another category or quality, from the same source before another. The same country only.
 */
fun SQLiteConnection.listChannelFeeds(channelId: String): List<ChannelFeed> {
    class Own(val id: String, val sourceId: String, val name: String, val country: String?)
    val channel = one("SELECT id, source_id AS sourceId, normalised_name AS name, country FROM channels WHERE id = ?", channelId) { Own(it.getText(0), it.getText(1), it.getText(2), it.textOrNull(3)) } ?: return emptyList()
    // Playlists list one stream under several categories: the same stream is not worth trying twice.
    val tried = HashSet<String>()
    val feeds = ArrayList<ChannelFeed>()
    fun addFeedsOf(id: String, name: String) {
        val variants = query(
            "SELECT v.id, v.quality, c.source_id || ' ' || v.provider_stream_id AS stream FROM channel_variants v JOIN channels c ON c.id = v.channel_id WHERE v.channel_id = ? ORDER BY v.sort_order",
            id,
        ) { Triple(it.getText(0), it.textOrNull(1), it.getText(2)) }
        for ((variantId, quality, stream) in variants) {
            if (!tried.add(stream)) continue
            feeds += ChannelFeed(id, variantId, name, quality)
        }
    }

    addFeedsOf(channel.id, channel.name)
    val key = sameChannelKey(channel.name)
    val like = "${key.replace(Regex("[\\\\%_]")) { "\\${it.value}" }}%"
    val collator = java.text.Collator.getInstance()
    val others = query(
        """SELECT id, source_id AS sourceId, normalised_name AS name FROM channels
           WHERE normalised_name LIKE ? ESCAPE '\' AND id <> ? AND country IS ?""",
        like, channel.id, channel.country,
    ) { Own(it.getText(0), it.getText(1), it.getText(2), null) }
        .filter { sameChannelKey(it.name) == key }
        .sortedWith(
            compareBy<Own> { if (it.sourceId != channel.sourceId) 1 else 0 }
                .thenBy { fallbackRank(it.name) }
                .thenComparator { a, b -> collator.compare(a.name, b.name) },
        )
    for (other in others) {
        if (feeds.size >= MOST_FEEDS) break
        addFeedsOf(other.id, other.name)
    }
    return feeds.take(MOST_FEEDS)
}
