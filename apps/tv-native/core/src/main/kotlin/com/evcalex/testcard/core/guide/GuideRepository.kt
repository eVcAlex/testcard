package com.evcalex.testcard.core.guide

import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.getPlaybackTarget
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.programmesInWindow
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.sync.SourceLogins
import com.evcalex.testcard.core.xtream.XtreamApi
import com.evcalex.testcard.core.xtream.fetchCatchupProgrammes
import com.evcalex.testcard.core.xtream.fetchShortEpg
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.OkHttpClient

/** A programme on a channel, in epoch ms. */
class Airing(val title: String, val start: Long, val end: Long)

/** What is on a channel now and what follows. Either can be missing. */
class ChannelGuide(val now: Airing?, val next: Airing?)

/** Thrown to a caller whose guide was never fetched because another channel was asked for while it waited. */
class GuideSuperseded : CancellationException("Another channel's guide was asked for first.")

/** How long a channel's answer is reused when nothing in it says sooner (no guide, or nothing airing now). */
private const val FRESH_MS = 5 * 60 * 1000L

/** How many programmes the guide grid asks the provider for per channel: enough for most of a day. */
private const val LISTINGS_LIMIT = 24

/** How long a channel's listings are reused before they are asked for again. */
private const val LISTINGS_FRESH_MS = 20 * 60 * 1000L

/** Channels asked about at once: enough to fill a screen of the guide quickly without flooding the provider. */
private const val LISTINGS_AT_ONCE = 3

/**
 * What a channel is showing, and the guide grid's listings (`playback/airing.ts`). Read on demand and optional: playback
 * never waits for it.
 *
 * One channel is asked about at a time, and only the latest one asked for: a channel still waiting when a newer one is
 * asked for is dropped with [GuideSuperseded]. Answers are kept until the programme airing ends, so coming back to a
 * channel costs nothing.
 */
class GuideRepository(private val db: Db, private val logins: SourceLogins, private val http: OkHttpClient, private val scope: CoroutineScope) {
    private class Answer(val guide: ChannelGuide?, val until: Long)

    private val answers = ConcurrentHashMap<String, Answer>()
    private val pending = ConcurrentHashMap<String, Deferred<ChannelGuide?>>()
    private val queue = Mutex()
    @Volatile private var latest: String? = null

    suspend fun fetchGuide(channelId: String): ChannelGuide? {
        answers[channelId]?.let { if (nowMs() < it.until) return it.guide }
        latest = channelId
        val run = pending.getOrPut(channelId) {
            scope.async {
                try {
                    queue.withLock {
                        if (latest != channelId) throw GuideSuperseded()
                        val guide = readGuide(channelId)
                        val now = nowMs()
                        answers[channelId] = Answer(guide, if (guide?.now != null) minOf(guide.now.end, now + 30 * 60 * 1000) else now + FRESH_MS)
                        guide
                    }
                } finally {
                    pending.remove(channelId)
                }
            }
        }
        return run.await()
    }

    /** What is on now and next from the imported guide, when it has this channel. */
    private suspend fun storedGuide(channelId: String): ChannelGuide? {
        val at = nowMs()
        val rows = db.read { it.programmesInWindow(listOf(channelId), at, at + 24 * 60 * 60 * 1000) }
        val now = rows.firstOrNull { it.startAt <= at && at < it.endAt }
        val next = rows.firstOrNull { it.startAt > at }
        return if (now == null && next == null) null else ChannelGuide(now?.let { Airing(it.title, it.startAt, it.endAt) }, next?.let { Airing(it.title, it.startAt, it.endAt) })
    }

    /** Drops every answer kept, so a guide just imported is read from the next time a channel is asked about. */
    fun forget() {
        answers.clear()
        listings.clear()
    }

    /**
     * The imported guide is read first. Without one, the short guide is tried; some providers only list what is coming up
     * there, so the full table (the one catch-up reads) fills in the rest, but only for a channel that keeps past programmes.
     */
    private suspend fun readGuide(channelId: String): ChannelGuide? {
        storedGuide(channelId)?.let { return it }
        val target = db.read { it.getPlaybackTarget(channelId) } ?: return null
        if (target.source.kind != "xtream") return null
        val api = XtreamApi({ logins.current(target.source.id) }, http)
        val streamId = target.variant.providerStreamId
        val at = nowMs()
        fun covers(start: Long, end: Long) = start <= at && at < end

        val short = try { api.fetchShortEpg(streamId) } catch (error: Exception) { if (error is CancellationException) throw error else emptyList() }
        var now: Airing? = short.firstOrNull { covers(it.startMs, it.endMs) }?.let { Airing(it.title, it.startMs, it.endMs) }
        var next: Airing? = short.firstOrNull { it.startMs > at }?.let { Airing(it.title, it.startMs, it.endMs) }

        if (now == null && keepsPast(channelId)) {
            val table = try { api.fetchCatchupProgrammes(streamId) } catch (error: Exception) { if (error is CancellationException) throw error else emptyList() }
            table.firstOrNull { covers(it.startMs, it.endMs) }?.let { now = Airing(it.title, it.startMs, it.endMs) }
            if (next == null) table.firstOrNull { it.startMs > at }?.let { next = Airing(it.title, it.startMs, it.endMs) }
        }
        return if (now == null && next == null) null else ChannelGuide(now, next)
    }

    private suspend fun keepsPast(channelId: String): Boolean =
        (db.read { it.one("SELECT catchup_days FROM channels WHERE id = ?", channelId) { r -> if (r.isNull(0)) 0L else r.getLong(0) } } ?: 0L) > 0

    // ---- the guide grid's listings

    private class Listing(val airings: List<Airing>, val until: Long)

    private val listings = ConcurrentHashMap<String, Listing>()
    private val listingsPending = HashMap<String, CompletableDeferred<List<Airing>>>()
    private val listingsQueue = ArrayList<String>()
    private var listingsRunning = 0

    /** Listings already fetched for a channel and still fresh, without asking the provider. */
    fun knownListings(channelId: String): List<Airing>? = listings[channelId]?.takeIf { nowMs() < it.until }?.airings

    /**
     * A channel's programmes from now on, in start order, for the guide grid: from the imported guide when the database has
     * one for it, else asked of the provider (Xtream only). Empty when neither has anything. A few channels are asked about
     * at a time, newest request first, and answers are kept for a while.
     */
    suspend fun fetchListings(channelId: String): List<Airing> {
        knownListings(channelId)?.let { return it }
        val deferred = synchronized(this) {
            listingsPending[channelId] ?: CompletableDeferred<List<Airing>>().also {
                listingsPending[channelId] = it
                listingsQueue += channelId
            }
        }
        nextListing()
        return deferred.await()
    }

    private fun nextListing() {
        while (true) {
            val id = synchronized(this) {
                if (listingsRunning >= LISTINGS_AT_ONCE || listingsQueue.isEmpty()) return
                listingsRunning += 1
                // Newest first: the rows the viewer has just scrolled to matter more than the ones they scrolled past.
                listingsQueue.removeAt(listingsQueue.lastIndex)
            }
            scope.launch {
                val airings = try { readListings(id) } catch (error: Exception) { if (error is CancellationException) throw error else emptyList() }
                listings[id] = Listing(airings, nowMs() + LISTINGS_FRESH_MS)
                val done = synchronized(this@GuideRepository) {
                    listingsRunning -= 1
                    listingsPending.remove(id)
                }
                done?.complete(airings)
                nextListing()
            }
        }
    }

    private suspend fun readListings(channelId: String): List<Airing> {
        val at = nowMs()
        val stored = db.read { it.programmesInWindow(listOf(channelId), at - 6 * 60 * 60 * 1000, at + 36 * 60 * 60 * 1000) }
        if (stored.isNotEmpty()) return stored.map { Airing(it.title, it.startAt, it.endAt) }
        val target = db.read { it.getPlaybackTarget(channelId) } ?: return emptyList()
        if (target.source.kind != "xtream") return emptyList()
        val short = XtreamApi({ logins.current(target.source.id) }, http).fetchShortEpg(target.variant.providerStreamId, LISTINGS_LIMIT)
        return short.map { Airing(it.title, it.startMs, it.endMs) }.filter { it.end > it.start }.sortedBy { it.start }
    }
}
