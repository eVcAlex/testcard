package com.evcalex.testcard.core.epg

import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.changes
import com.evcalex.testcard.core.db.exec
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.importing.yieldBetweenSlices
import java.io.InputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.produce
import kotlinx.coroutines.channels.trySendBlocking
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class EpgImportResult(
    /** Distinct channels that received at least one programme. */
    val channels: Int,
    val programmes: Int,
    val durationMs: Long,
)

/** Programmes older than this before "now" are dropped after every import. */
private const val KEEP_PAST_MS = 6L * 60 * 60 * 1000

/** Rows per transaction: the writer is let go between flushes. */
private const val FLUSH_EVERY = 500

/** Rows deleted per statement: a guide can hold hundreds of thousands, and one DELETE of them all blocks for seconds. */
private const val DELETE_EVERY = 3000

private class Pending(val channelId: String, val title: String, val description: String?, val startAt: Long, val endAt: Long)

/**
 * Deletes the programmes `select` finds (a query of their rowids), a slice at a time with other work let in between
 * slices. Returns how many went (`deleteInSlices`).
 */
suspend fun deleteProgrammesInSlices(db: Db, select: String, vararg params: Any?): Int {
    var total = 0
    while (true) {
        val changes = db.write { connection ->
            connection.run("DELETE FROM programmes WHERE rowid IN ($select LIMIT $DELETE_EVERY)", *params)
            connection.changes()
        }
        total += changes
        if (changes < DELETE_EVERY) return total
        yieldBetweenSlices()
    }
}

/** A guide id can be shared by several channels (a playlist lists a channel under more than one group, or in HD and SD); each gets the listings. */
private suspend fun channelsByGuideId(db: Db, sourceId: String): Map<String, List<String>> {
    val out = LinkedHashMap<String, MutableList<String>>()
    db.read { connection ->
        connection.query("SELECT tvg_id, id FROM channels WHERE source_id = ? AND tvg_id IS NOT NULL AND tvg_id <> ''", sourceId) { out.getOrPut(it.getText(0)) { mutableListOf() }.add(it.getText(1)) }
    }
    return out
}

private suspend fun flush(db: Db, rows: List<Pending>) = db.transaction { connection ->
    connection.prepare("INSERT INTO programmes (channel_id, title, description, start_at, end_at) VALUES (?, ?, ?, ?, ?)").use { statement ->
        for (row in rows) statement.exec(row.channelId, row.title, row.description, row.startAt, row.endAt)
    }
}

/**
 * Streams an XMLTV document into the `programmes` table for one source (`importEpg.ts`). The caller fetches the URL and
 * hands the body in; the credential-bearing Xtream `xmltv.php` address is built and used only by the caller, never stored.
 * Delete-then-insert per source makes a re-import idempotent without a key on `programmes`. The file expands to far more
 * rows than there are channels, so it is flushed in batches while the next is parsed. `horizonMs` leaves out programmes
 * starting further ahead than that: a small device need not hold a fortnight of listings.
 */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
suspend fun importEpg(db: Db, sourceId: String, body: InputStream, horizonMs: Long? = null, onProgress: (programmesSoFar: Int) -> Unit = {}): EpgImportResult = coroutineScope {
    val startedAt = nowMs()
    val channels = channelsByGuideId(db, sourceId)
    deleteProgrammesInSlices(db, "SELECT p.rowid FROM programmes p JOIN channels c ON c.id = p.channel_id WHERE c.source_id = ?", sourceId)

    val touched = HashSet<String>()
    var programmes = 0
    val oldest = nowMs() - KEEP_PAST_MS
    val furthest = if (horizonMs != null) nowMs() + horizonMs else Long.MAX_VALUE
    val batches = produce(Dispatchers.IO, capacity = 2) {
        body.use {
            var buffer = ArrayList<Pending>()
            parseXmltv(it, { id -> id in channels }) { programme ->
                if (programme.endMs < oldest || programme.startMs > furthest) return@parseXmltv
                for (channelId in channels.getValue(programme.channel)) {
                    buffer.add(Pending(channelId, programme.title, programme.description, programme.startMs, programme.endMs))
                    touched.add(channelId)
                }
                if (buffer.size >= FLUSH_EVERY) {
                    trySendBlocking(buffer).getOrThrow()
                    buffer = ArrayList()
                }
            }
            if (buffer.isNotEmpty()) trySendBlocking(buffer).getOrThrow()
        }
    }
    for (batch in batches) {
        flush(db, batch)
        programmes += batch.size
        onProgress(programmes)
        yieldBetweenSlices()
    }
    deleteProgrammesInSlices(db, "SELECT rowid FROM programmes WHERE end_at < ?", nowMs() - KEEP_PAST_MS)
    EpgImportResult(touched.size, programmes, nowMs() - startedAt)
}

/**
 * Loads a guide file built by the daily job (`{ at, c: { guideId: [[start, end, title], ...] } }`) into `programmes` for
 * one source, in place of reading the whole XMLTV: only listings for channels the source has are kept (`importGuideFile.ts`).
 */
suspend fun importGuideFile(db: Db, sourceId: String, fileJson: String): EpgImportResult {
    val startedAt = nowMs()
    val channels = channelsByGuideId(db, sourceId)
    val c: JsonObject = Json.parseToJsonElement(fileJson).jsonObject["c"]?.jsonObject ?: JsonObject(emptyMap())
    deleteProgrammesInSlices(db, "SELECT p.rowid FROM programmes p JOIN channels c ON c.id = p.channel_id WHERE c.source_id = ?", sourceId)

    val touched = HashSet<String>()
    var programmes = 0
    var batch = ArrayList<Pending>()
    for ((guideId, listings) in c) {
        for (channelId in channels[guideId].orEmpty()) {
            for (listing in listings.jsonArray) {
                val parts: JsonArray = listing.jsonArray
                batch.add(Pending(channelId, parts[2].jsonPrimitive.content, null, parts[0].jsonPrimitive.content.toDouble().toLong(), parts[1].jsonPrimitive.content.toDouble().toLong()))
                programmes += 1
            }
            touched.add(channelId)
        }
        if (batch.size >= FLUSH_EVERY) {
            flush(db, batch)
            batch = ArrayList()
            yieldBetweenSlices()
        }
    }
    if (batch.isNotEmpty()) flush(db, batch)
    return EpgImportResult(touched.size, programmes, nowMs() - startedAt)
}
