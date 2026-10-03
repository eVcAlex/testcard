package com.evcalex.testcard.core.db

import com.evcalex.testcard.core.nowMs
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import com.evcalex.testcard.core.sync.recordChannelTombstone
import com.evcalex.testcard.core.normalise.WS
import com.evcalex.testcard.core.normalise.jsTrim

/** `queries.ts`: live channels, categories, favourites, recents and what is on now. SQL is verbatim. */
class ChannelRow(
    val id: String,
    val sourceId: String,
    val categoryId: String,
    val normalisedName: String,
    val rawName: String,
    val country: String?,
    val logoUrl: String?,
    val channelNumber: Int?,
    val isFavourite: Boolean,
)

const val CHANNEL_COLUMNS = """c.id, c.source_id, c.category_id, c.normalised_name, c.raw_name,
  c.country, c.logo_url, c.channel_number,
  (SELECT 1 FROM favourites f WHERE f.channel_id = c.id) IS NOT NULL AS is_favourite"""

internal fun SQLiteStatement.channelRow() = ChannelRow(
    getText(0), getText(1), getText(2), getText(3), getText(4), textOrNull(5), textOrNull(6), longOrNull(7)?.toInt(), getLong(8) != 0L,
)

/** `trimmed.split(/\s+/).map(token => token.replace(/["*]/g, "") + "*").join(" ")` of `searchChannels` and its siblings. */
internal fun prefixQuery(trimmed: String): String =
    trimmed.split(Regex("[$WS]+")).joinToString(" ") { token -> "${token.replace(Regex("[\"*]"), "")}*" }

/** FTS5 search over the normalised channel name. */
fun SQLiteConnection.searchChannels(query: String, limit: Int = 200, sourceId: String? = null): List<ChannelRow> {
    val trimmed = query.jsTrim()
    if (trimmed.isEmpty()) return emptyList()
    val args = listOfNotNull<Any>(prefixQuery(trimmed), sourceId, limit)
    return query(
        """SELECT $CHANNEL_COLUMNS
           FROM channels_fts
           JOIN channels c ON c.rowid = channels_fts.rowid
           WHERE channels_fts MATCH ? AND ${channelShown("c")}${if (sourceId != null) " AND c.source_id = ?" else ""}
           ORDER BY rank
           LIMIT ?""",
        *args.toTypedArray(),
    ) { it.channelRow() }
}

/**
 * The default channel grid, in the provider's order (`channels.rowid`). `categoryId` wins over `country` when both are
 * given. Capped: screens narrow rather than render everything at once.
 */
fun SQLiteConnection.browseChannels(
    categoryId: String? = null,
    country: String? = null,
    sourceId: String? = null,
    genre: String? = null,
    limit: Int = 300,
    offset: Int = 0,
): List<ChannelRow> {
    val where = mutableListOf(channelShown("c"))
    val filters = mutableListOf<Any?>()
    if (categoryId != null) {
        where += "c.category_id = ?"
        filters += categoryId
    } else if (country != null) {
        where += "c.country IS ?"
        filters += country
    }
    if (sourceId != null) {
        where += "c.source_id = ?"
        filters += sourceId
    }
    if (genre != null) {
        where += "c.category_id IN (SELECT id FROM categories WHERE genre = ?)"
        filters += genre
    }
    return query(
        """SELECT $CHANNEL_COLUMNS
           FROM channels c
           WHERE ${where.joinToString(" AND ")}
           ORDER BY c.rowid
           LIMIT ? OFFSET ?""",
        *filters.toTypedArray(), limit, offset,
    ) { it.channelRow() }
}

class CategoryRow(
    val id: String,
    val name: String,
    val country: String?,
    /** Advisory classification: null or "" when unrecognised. */
    val genre: String?,
    val language: String?,
    val service: String?,
    val tags: String,
    val count: Int,
)

private fun SQLiteStatement.categoryRow() = CategoryRow(getText(0), getText(1), textOrNull(2), textOrNull(3), textOrNull(4), textOrNull(5), getText(6), getLong(7).toInt())

/** Every category that still has channels, in the provider's order (`categories.rowid`). */
fun SQLiteConnection.listCategories(sourceId: String? = null): List<CategoryRow> = query(
    """SELECT cat.id, cat.raw_name AS name, cat.country, cat.genre, cat.language, cat.service, cat.tags, COUNT(ch.id) AS channel_count
       FROM categories cat
       JOIN channels ch ON ch.category_id = cat.id
       WHERE ${categoryShown("cat", CategoryKind.Live)}${if (sourceId != null) " AND cat.source_id = ?" else ""}
       GROUP BY cat.id
       ORDER BY cat.rowid""",
    *listOfNotNull(sourceId).toTypedArray(),
) { it.categoryRow() }

/** Recently played channels, most recent first. */
fun SQLiteConnection.listRecentChannels(limit: Int = 24): List<ChannelRow> = query(
    """SELECT $CHANNEL_COLUMNS
       FROM recents r
       JOIN channels c ON c.id = r.channel_id
       WHERE ${channelShown("c")}
       ORDER BY r.played_at DESC
       LIMIT ?""",
    limit,
) { it.channelRow() }

/** Favourited channels in the viewer's order: newest favourite first until they move one. */
fun SQLiteConnection.listFavouriteChannels(): List<ChannelRow> = query(
    """SELECT $CHANNEL_COLUMNS
       FROM favourites f
       JOIN channels c ON c.id = f.channel_id
       WHERE ${channelShown("c")}
       ORDER BY f.position IS NOT NULL, f.position, f.added_at DESC""",
) { it.channelRow() }

class ChannelCountry(val country: String, val count: Int)

fun SQLiteConnection.listChannelCountries(sourceId: String? = null): List<ChannelCountry> = query(
    """SELECT country, COUNT(*) AS count
       FROM channels
       WHERE country IS NOT NULL AND country <> ''${if (sourceId != null) " AND source_id = ?" else ""}
       GROUP BY country
       ORDER BY count DESC, country ASC""",
    *listOfNotNull(sourceId).toTypedArray(),
) { ChannelCountry(it.getText(0), it.getLong(1).toInt()) }

/** Adds or removes a favourite channel. Synced. Returns true when it is a favourite now. */
fun SQLiteConnection.toggleFavourite(channelId: String): Boolean = atomic {
    val existing = one("SELECT 1 FROM favourites WHERE channel_id = ?", channelId) { it.getLong(0) }
    if (existing != null) {
        run("DELETE FROM favourites WHERE channel_id = ?", channelId)
        recordChannelTombstone("channel_favourites", channelId)
        false
    } else {
        run("INSERT INTO favourites (channel_id, added_at, updated_at) VALUES (?, ?, ?)", channelId, nowMs(), nowMs())
        true
    }
}

fun SQLiteConnection.recordRecent(channelId: String) = run(
    """INSERT INTO recents (channel_id, played_at, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET played_at = excluded.played_at, updated_at = excluded.updated_at""",
    channelId, nowMs(), nowMs(),
)

/** Takes a channel out of Recently watched. Synced. */
fun SQLiteConnection.removeChannelFromRecents(channelId: String) {
    run("DELETE FROM recents WHERE channel_id = ?", channelId)
    if (changes() > 0) recordChannelTombstone("channel_recents", channelId)
}

class ProgrammeRow(val channelId: String, val title: String, val description: String?, val startAt: Long, val endAt: Long)

private fun SQLiteStatement.programmeRow() = ProgrammeRow(getText(0), getText(1), textOrNull(2), getLong(3), getLong(4))

/** SQLite caps a statement at 999 bound variables; chunk any `IN (...)` list below that. */
private const val SQL_VARS_MAX = 900

class NowNext(var now: ProgrammeRow? = null, var next: ProgrammeRow? = null)

/** The now-airing and next programme for each of `channelIds`, batched for a visible grid. `at` is unix ms. */
fun SQLiteConnection.nowNextForChannels(channelIds: List<String>, at: Long = nowMs()): Map<String, NowNext> {
    val result = LinkedHashMap<String, NowNext>()
    if (channelIds.isEmpty()) return result
    val horizon = at + 24 * 60 * 60 * 1000
    for (ids in channelIds.chunked(SQL_VARS_MAX)) {
        val rows = query(
            """SELECT channel_id, title, description, start_at, end_at
               FROM programmes
               WHERE channel_id IN (${ids.joinToString(",") { "?" }})
                 AND end_at > ? AND start_at < ?
               ORDER BY channel_id, start_at""",
            *ids.toTypedArray(), at, horizon,
        ) { it.programmeRow() }
        for (row in rows) {
            val entry = result.getOrPut(row.channelId) { NowNext() }
            if (row.startAt <= at && at < row.endAt) entry.now = row
            else if (row.startAt > at && (entry.next == null || row.startAt < entry.next!!.startAt)) entry.next = row
        }
    }
    return result
}

/** Every programme overlapping `[fromMs, toMs]` for the given channels, for the guide grid. */
fun SQLiteConnection.programmesInWindow(channelIds: List<String>, fromMs: Long, toMs: Long): List<ProgrammeRow> {
    if (channelIds.isEmpty()) return emptyList()
    val out = mutableListOf<ProgrammeRow>()
    for (ids in channelIds.chunked(SQL_VARS_MAX)) {
        out += query(
            """SELECT channel_id, title, description, start_at, end_at
               FROM programmes
               WHERE channel_id IN (${ids.joinToString(",") { "?" }})
                 AND start_at < ? AND end_at > ?
               ORDER BY channel_id, start_at""",
            *ids.toTypedArray(), toMs, fromMs,
        ) { it.programmeRow() }
    }
    return out
}

class SourceRef(val id: String, val kind: String, val name: String, val baseUrl: String?, val playlistUrl: String?, val epgUrl: String?)

class VariantRef(val id: String, val sourceId: String, val providerStreamId: String, val quality: String?, val isOffline: Boolean)

/** What the player needs to turn a channel id into a stream: the channel, the variant to play, and its source. */
class PlaybackTarget(val channelId: String, val channelName: String, val variant: VariantRef, val source: SourceRef)

/** Resolves a channel (and an optional explicit variant) to its source and the variant to play (`sort_order` 0 by default). */
fun SQLiteConnection.getPlaybackTarget(channelId: String, variantId: String? = null): PlaybackTarget? {
    val (id, name) = one("SELECT id, normalised_name AS name FROM channels WHERE id = ?", channelId) { it.getText(0) to it.getText(1) } ?: return null
    val variant = one(
        """SELECT id, channel_id AS channelId, provider_stream_id AS providerStreamId, quality, is_offline AS isOffline
           FROM channel_variants
           WHERE channel_id = ? ${if (variantId != null) "AND id = ?" else ""}
           ORDER BY sort_order
           LIMIT 1""",
        *listOfNotNull(channelId, variantId).toTypedArray(),
    ) { VariantRef(it.getText(0), "", it.getText(2), it.textOrNull(3), it.getLong(4) == 1L) } ?: return null
    val source = one(
        """SELECT s.id, s.kind, s.name, s.base_url AS baseUrl, s.playlist_url AS playlistUrl, s.epg_url AS epgUrl
           FROM sources s
           JOIN channels c ON c.source_id = s.id
           WHERE c.id = ?""",
        channelId,
    ) { SourceRef(it.getText(0), it.getText(1), it.getText(2), it.textOrNull(3), it.textOrNull(4), it.textOrNull(5)) } ?: return null
    return PlaybackTarget(id, name, VariantRef(variant.id, source.id, variant.providerStreamId, variant.quality, variant.isOffline), source)
}

/** Moves a favourite channel one place earlier (-1) or later (1) in the viewer's order. Synced. False at either end. */
fun SQLiteConnection.moveFavourite(channelId: String, delta: Int): Boolean {
    val ids = listFavouriteChannels().map { it.id }.toMutableList()
    val from = ids.indexOf(channelId)
    val to = from + delta
    if (from < 0 || to < 0 || to >= ids.size) return false
    ids[from] = ids[to].also { ids[to] = ids[from] }
    val now = nowMs()
    atomic { ids.forEachIndexed { index, id -> run("UPDATE favourites SET position = ?, updated_at = ? WHERE channel_id = ?", index, now, id) } }
    return true
}
