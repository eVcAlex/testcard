package com.evcalex.testcard.core.guide

import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.epg.deleteProgrammesInSlices
import com.evcalex.testcard.core.epg.importEpg
import com.evcalex.testcard.core.epg.importGuideFile
import com.evcalex.testcard.core.normalise.jsTrim
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.sync.await
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request

/** Where the updater and the shared guide files are served from (the sync worker's RELEASES bucket). */
const val UPDATE_BASE_URL = "https://testcard-sync.evcalex.workers.dev/app"

private const val MOST_URL_LENGTH = 500

/** Whether the address is one a device may register and the job may fetch: a plain https link to a guide file (`sync-schema/guide.ts`). */
fun isSharableGuideUrl(address: String): Boolean {
    if (address.length > MOST_URL_LENGTH) return false
    val url = address.toHttpUrlOrNull() ?: return false
    if (url.scheme != "https" || url.username != "" || url.password != "" || url.query != null || url.fragment != null) return false
    val host = url.host
    if (host == "localhost" || host.endsWith(".local") || Regex("^[0-9.]+\\z").matches(host) || ':' in host) return false
    return Regex("\\.(xml|xml\\.gz|gz)\\z", RegexOption.IGNORE_CASE).containsMatchIn(url.encodedPath)
}

/** The name a guide's file is kept under: the same on the device, in the Worker and in the job. */
fun guideFileName(address: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(address.toByteArray(Charsets.UTF_8))
    return "guide-${digest.joinToString("") { "%02x".format(it) }.substring(0, 32)}.json"
}

/** A guide older than this is read again, on launch or on coming back to the app. */
private const val STALE_MS = 12L * 60 * 60 * 1000

/** Listings kept ahead of now: the guide grid shows a day; a small device need not hold a week. */
private const val HORIZON_MS = 36L * 60 * 60 * 1000

/** A failed read is asked again after this, not after `STALE_MS`: a broken address should not be hammered on every launch. */
private const val RETRY_AFTER_FAILURE_MS = 60L * 60 * 1000

/** How long the provider has to start answering; the body then streams for as long as it needs. */
private const val HEADERS_TIMEOUT_S = 60L

/** A shared file older than this is no better than reading the guide oneself. */
private const val SHARED_MOST_AGE_MS = 48L * 60 * 60 * 1000

private class GuideSource(val id: String, val name: String, val epgUrl: String?)

/**
 * The TV guide (XMLTV) for a source, loaded into the `programmes` table (`playback/guideImport.ts`), so Live TV, the player
 * and the guide grid have listings for playlists and for providers whose per-channel guide is empty. The address is the one
 * set for the source (on any device: it syncs); a source with none is left to its per-channel guide. Read in the
 * background, one source at a time, never while a source is importing; nothing waits on it.
 */
class GuideImporter(
    private val db: Db,
    http: OkHttpClient,
    private val scope: CoroutineScope,
    /** Tells the Worker a public guide address; the answer is the name of its shared file (`SyncController.registerGuide`). */
    private val registerGuide: suspend (String) -> String?,
    private val guides: GuideRepository,
    /** True while a source is importing: the guide waits, rather than slowing it down. */
    private val busy: () -> Boolean = { false },
    /** Told after each guide is read, so screens can show the new listings. */
    private val onImported: () -> Unit = {},
    /** Where shared guide files are served from. */
    private val updateBaseUrl: String = UPDATE_BASE_URL,
) {
    private val http = http.newBuilder().readTimeout(HEADERS_TIMEOUT_S, TimeUnit.SECONDS).build()
    private val queue = Mutex()
    private val queued = HashSet<String>()

    private fun metaKey(sourceId: String) = "epg:$sourceId"

    /** What was read last: `{ at, url }` from `schema_meta`, or null. */
    private suspend fun readRecord(sourceId: String): Pair<Long, String>? = try {
        db.read { it.one("SELECT value FROM schema_meta WHERE key = ?", metaKey(sourceId)) { r -> r.getText(0) } }?.let {
            val json = Json.parseToJsonElement(it).jsonObject
            json["at"]!!.jsonPrimitive.content.toDouble().toLong() to json["url"]!!.jsonPrimitive.content
        }
    } catch (_: Exception) {
        null
    }

    private suspend fun guideSources(): List<GuideSource> = db.read {
        it.query(
            """SELECT id, name, epg_url FROM sources
               WHERE include_live = 1 AND TRIM(COALESCE(epg_url, '')) <> ''
                 AND EXISTS (SELECT 1 FROM channels WHERE source_id = sources.id)""",
        ) { r -> GuideSource(r.getText(0), r.getText(1), if (r.isNull(2)) null else r.getText(2)) }
    }

    private fun setAddress(source: GuideSource) = source.epgUrl?.jsTrim() ?: ""

    /** Whether a source's guide is missing, old, or was read from another address than the one set now. */
    private suspend fun isStale(source: GuideSource): Boolean {
        val record = readRecord(source.id)
        return record == null || nowMs() - record.first > STALE_MS || record.second != setAddress(source)
    }

    private suspend fun record(sourceId: String, url: String, at: Long) {
        db.write { it.run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)", metaKey(sourceId), JsonObject(mapOf("at" to JsonPrimitive(at), "url" to JsonPrimitive(url))).toString()) }
    }

    /**
     * The trimmed guide the daily job keeps for a public guide address, a few megabytes in place of tens of megabytes to
     * unpack and parse on the TV. Asking also registers the address, so the job starts keeping one for it. Null when there
     * is none yet or it is not a public one.
     */
    private suspend fun sharedGuide(url: String): String? {
        if (!isSharableGuideUrl(url)) return null
        val file = registerGuide(url) ?: guideFileName(url)
        return try {
            http.newCall(Request.Builder().url("$updateBaseUrl/$file").build()).await().use { response ->
                if (!response.isSuccessful) return@use null
                val text = withContext(Dispatchers.IO) { response.body.string() }
                val at = Json.parseToJsonElement(text).jsonObject["at"]!!.jsonPrimitive.content.toDouble().toLong()
                if (nowMs() - at < SHARED_MOST_AGE_MS) text else null
            }
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            null
        }
    }

    private suspend fun importOne(source: GuideSource) {
        val url = setAddress(source)
        if (url == "") return record(source.id, url, nowMs())
        // Recorded only once it has worked (or failed cleanly): on a Fire Stick the read takes many minutes, and one the app
        // was closed in the middle of must be started again next time, not counted as done for 12 hours.
        try {
            val shared = sharedGuide(url)
            if (shared != null) {
                importGuideFile(db, source.id, shared)
                record(source.id, url, nowMs())
                return
            }
            http.newCall(Request.Builder().url(url).header("User-Agent", "node").build()).await().use { response ->
                if (!response.isSuccessful) throw IllegalStateException("The guide address responded with HTTP ${response.code}.")
                importEpg(db, source.id, response.body.byteStream(), HORIZON_MS)
            }
            record(source.id, url, nowMs())
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            record(source.id, url, nowMs() - STALE_MS + RETRY_AFTER_FAILURE_MS)
            throw error
        }
    }

    /** Reads the guide of each source that needs it (or, with `force`, of the ones named), in turn. */
    fun refresh(force: List<String> = emptyList()) {
        scope.launch {
            for (source in guideSources()) {
                val wanted = (source.id in force || isStale(source)) && synchronized(queued) { queued.add(source.id) }
                if (!wanted) continue
                scope.launch {
                    queue.withLock {
                        try {
                            while (busy()) delay(5000)
                            // Read again when its turn comes: the source may have changed or gone while it waited.
                            val current = guideSources().firstOrNull { it.id == source.id } ?: return@withLock
                            importOne(current)
                            guides.forget()
                            onImported()
                        } catch (error: Exception) {
                            if (error is CancellationException) throw error
                            // A failed guide is only logged: nothing waits on it.
                            System.err.println("Guide for ${source.name} failed: ${error.message}")
                        } finally {
                            synchronized(queued) { queued.remove(source.id) }
                        }
                    }
                }
            }
        }
    }

    /**
     * Clears guides this device keeps no longer: sources with no guide address (0.1.60 and 0.1.61 read every source's), in
     * slices. Once; the guides it reads from now on replace themselves.
     */
    suspend fun dropUnusedGuides() {
        if (db.read { it.one("SELECT 1 FROM schema_meta WHERE key = 'guides_trimmed'") { r -> r.getLong(0) } } != null) return
        val removed = deleteProgrammesInSlices(
            db,
            "SELECT p.rowid FROM programmes p JOIN channels c ON c.id = p.channel_id JOIN sources s ON s.id = c.source_id WHERE TRIM(COALESCE(s.epg_url, '')) = ''",
        )
        db.write { it.run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('guides_trimmed', '1')") }
        if (removed > 0) guides.forget()
    }
}
