package com.evcalex.testcard.core.importing

import com.evcalex.testcard.core.nowMs
import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.exec
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.normalise.Catchup
import com.evcalex.testcard.core.normalise.Channel
import com.evcalex.testcard.core.normalise.RawChannelEntry
import com.evcalex.testcard.core.normalise.classifyCategory
import com.evcalex.testcard.core.normalise.encodeTags
import com.evcalex.testcard.core.normalise.groupVariants
import com.evcalex.testcard.core.normalise.parseName
import com.evcalex.testcard.core.xtream.XCategory
import com.evcalex.testcard.core.xtream.XtreamApi
import com.evcalex.testcard.core.xtream.jsString
import com.evcalex.testcard.core.xtream.mapCategories
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Provider list requests, a few at a time (`LIST_REQUESTS_AT_ONCE` in `inTurn.ts`). */
const val LIST_REQUESTS_AT_ONCE = 4

class ImportResult(val categories: Int, val channels: Int, val variants: Int, val durationMs: Long)

/** `fetchAll`: `fetch` over every item, `limit` at a time, with the results in the items' order. The first failure is thrown. */
suspend fun <T, R> fetchAll(items: List<T>, limit: Int = LIST_REQUESTS_AT_ONCE, fetch: suspend (T) -> R): List<R> {
    val gate = Semaphore(limit)
    return coroutineScope { items.map { item -> async { gate.withPermit { fetch(item) } } }.awaitAll() }
}

/** What every category table stores beside the provider's own name: country, genre, language, service, tags. */
internal fun categoryColumns(rawName: String): Array<Any?> {
    val classified = classifyCategory(rawName)
    return arrayOf(parseName(rawName).country, classified.genre, classified.language, classified.service, encodeTags(classified.tags))
}

private fun JsonElement?.text(): String? = jsString()

/** `fetchChannels` of the Xtream adapter: the streams of one category, grouped into channels with their quality variants. */
fun xtreamChannels(reply: JsonElement, sourceId: String, category: XCategory): List<Channel> {
    val entries = (reply as? JsonArray).orEmpty().map { item ->
        val dto = item as JsonObject
        RawChannelEntry(
            sourceId = sourceId,
            categoryId = category.id,
            providerStreamId = dto["stream_id"].text() ?: "",
            rawName = dto["name"].text() ?: "",
            tvgId = dto["epg_channel_id"].text()?.takeIf { it.isNotEmpty() },
            logoUrl = dto["stream_icon"].text()?.takeIf { it.isNotEmpty() },
            channelNumber = dto["num"].text()?.toDoubleOrNull()?.toInt(),
            // `tv_archive === 1` in TypeScript: the number 1, not the text "1".
            catchup = if ((dto["tv_archive"] as? JsonPrimitive)?.let { !it.isString && it.content == "1" } == true) {
                Catchup("xtream", dto["tv_archive_duration"].text()?.toDoubleOrNull()?.toInt() ?: 0)
            } else null,
        )
    }
    return groupVariants(entries) { "$sourceId:$it" }
}

/**
 * Imports (or re-imports) a source's live categories and channels, diff-and-merge and never destructive, like
 * `importSource.ts`: the SQL is the same text, and a channel or a variant list that has not changed is not rewritten.
 * Network and parsing run off the writer; the database is touched in slices of about 1,500 rows.
 */
suspend fun importLive(db: Db, api: XtreamApi, sourceId: String, onProgress: (done: Int, total: Int) -> Unit = { _, _ -> }): ImportResult {
    val startedAt = nowMs()
    val categories = mapCategories(api.call("get_live_categories", explain = true), sourceId)
    var fetched = 0
    val pages = fetchAll(categories) { category ->
        val reply = api.call("get_live_streams", mapOf("category_id" to category.providerId), explain = true)
        (category to withContext(Dispatchers.Default) { xtreamChannels(reply, sourceId, category) }).also { onProgress(++fetched, categories.size) }
    }
    return storeLivePages(db, sourceId, pages, startedAt)
}

private const val UPSERT_CATEGORY = """INSERT INTO categories (id, source_id, provider_id, raw_name, country, genre, language, service, tags)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET raw_name = excluded.raw_name, country = excluded.country,
     genre = excluded.genre, language = excluded.language, service = excluded.service, tags = excluded.tags
   WHERE categories.raw_name IS NOT excluded.raw_name OR categories.tags IS NOT excluded.tags"""

private const val UPSERT_CHANNEL = """INSERT INTO channels (
     id, source_id, category_id, normalised_name, raw_name, country, logo_url,
     channel_number, catchup_type, catchup_days, tvg_id, first_seen_at, last_seen_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     normalised_name = excluded.normalised_name, raw_name = excluded.raw_name, country = excluded.country,
     logo_url = excluded.logo_url, channel_number = excluded.channel_number, tvg_id = excluded.tvg_id,
     catchup_type = excluded.catchup_type, catchup_days = excluded.catchup_days, last_seen_at = excluded.last_seen_at
   WHERE channels.normalised_name IS NOT excluded.normalised_name OR channels.raw_name IS NOT excluded.raw_name
     OR channels.country IS NOT excluded.country OR channels.logo_url IS NOT excluded.logo_url
     OR channels.channel_number IS NOT excluded.channel_number OR channels.tvg_id IS NOT excluded.tvg_id
     OR channels.catchup_type IS NOT excluded.catchup_type OR channels.catchup_days IS NOT excluded.catchup_days"""

private fun variantKey(id: String, stream: String, quality: String?, offline: Boolean) = "$id|$stream|${quality ?: ""}|${if (offline) 1 else 0}"

/** The write half of a live import, shared by Xtream and M3U: the same SQL as `importSource.ts`. */
internal suspend fun storeLivePages(db: Db, sourceId: String, pages: List<Pair<XCategory, List<Channel>>>, startedAt: Long): ImportResult {
    val now = startedAt
    // Each channel's streams as stored, so a channel whose streams are unchanged is left alone.
    val storedVariants = db.read { connection ->
        val byChannel = LinkedHashMap<String, String>()
        connection.query(
            "SELECT v.channel_id, v.id, v.provider_stream_id, v.quality, v.is_offline FROM channel_variants v JOIN channels c ON c.id = v.channel_id WHERE c.source_id = ? ORDER BY v.channel_id, v.sort_order",
            sourceId,
        ) { row ->
            val entry = variantKey(row.getText(1).replace('\u0001', '\u0000'), row.getText(2), if (row.isNull(3)) null else row.getText(3), row.getLong(4) != 0L)
            byChannel.merge(row.getText(0), entry) { before, add -> "$before\n$add" }
        }
        byChannel
    }

    var categoryCount = 0
    var channelCount = 0
    var variantCount = 0
    db.applyInSlices(pages, { it.second.size * 2 }) { connection: SQLiteConnection, (category, channels) ->
        val upsertCategory = connection.prepare(UPSERT_CATEGORY)
        val upsertChannel = connection.prepare(UPSERT_CHANNEL)
        try {
            upsertCategory.exec(category.id, sourceId, category.providerId, category.rawName, *categoryColumns(category.rawName))
            categoryCount += 1
            for (channel in channels) {
                upsertChannel.exec(
                    channel.id, channel.sourceId, channel.categoryId, channel.normalisedName, channel.rawName, channel.country,
                    channel.logoUrl, channel.channelNumber, channel.catchup?.type, channel.catchup?.days, channel.tvgId, now, now,
                )
                channelCount += 1
                variantCount += channel.variants.size
                val wanted = channel.variants.joinToString("\n") { variantKey(it.id, it.providerStreamId, it.quality, it.isOffline) }
                if (storedVariants[channel.id.replace('\u0000', '\u0001')] == wanted) continue
                connection.run("DELETE FROM channel_variants WHERE channel_id = ?", channel.id)
                channel.variants.forEachIndexed { index, variant ->
                    connection.run(
                        "INSERT INTO channel_variants (id, channel_id, provider_stream_id, quality, is_offline, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
                        variant.id, channel.id, variant.providerStreamId, variant.quality, variant.isOffline, index,
                    )
                }
            }
        } finally {
            upsertCategory.close()
            upsertChannel.close()
        }
    }
    db.write { it.run("UPDATE sources SET last_refreshed_at = ? WHERE id = ?", now, sourceId) }
    // Channels missing from this refresh are deliberately kept: a favourite briefly absent must not lose its place.
    return ImportResult(categoryCount, channelCount, variantCount, nowMs() - startedAt)
}
