package com.evcalex.testcard.core.playback

import com.evcalex.testcard.core.db.ChannelFeed
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.getEpisodePlaybackTarget
import com.evcalex.testcard.core.db.getMoviePlaybackTarget
import com.evcalex.testcard.core.db.getPlaybackProgress
import com.evcalex.testcard.core.db.getPlaybackTarget
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.sync.SourceLogins
import com.evcalex.testcard.core.xtream.CatchupProgramme
import com.evcalex.testcard.core.xtream.buildEpisodeStreamUrl
import com.evcalex.testcard.core.xtream.buildLiveStreamUrl
import com.evcalex.testcard.core.xtream.buildMovieStreamUrl
import com.evcalex.testcard.core.xtream.buildTimeshiftUrl

enum class PlayKind { Channel, Movie, Episode }

class PlayItem(val kind: PlayKind, val id: String, val title: String)

class ResolvedStream(val url: String, val title: String, /** Where to start, for a film or episode that was left part-way. */ val resumeSecs: Double?)

/**
 * Turns a channel, film or episode id into a playable URL (`playback/resolveStream.ts`). As on desktop, an M3U film or
 * episode stores its direct URL as the provider id; Xtream URLs are built from the stored login. The URL goes straight to
 * the player and is never shown or logged. With `catchup`, a channel plays that past programme from its start instead of
 * the live picture. With `feed`, a channel plays that one of its feeds.
 */
suspend fun resolveStream(db: Db, logins: SourceLogins, item: PlayItem, resume: Boolean, catchup: CatchupProgramme? = null, feed: ChannelFeed? = null): ResolvedStream {
    when (item.kind) {
        PlayKind.Channel -> {
            val target = db.read { if (feed != null) it.getPlaybackTarget(feed.channelId, feed.variantId) else it.getPlaybackTarget(item.id) }
                ?: throw IllegalStateException("That channel is no longer available.")
            if (catchup != null) {
                val url = buildTimeshiftUrl(logins.current(target.source.id), target.variant.providerStreamId, catchup)
                return ResolvedStream(url, "${catchup.title} on ${item.title}", null)
            }
            val url = if (target.source.kind == "xtream") buildLiveStreamUrl(logins.current(target.source.id), target.variant.providerStreamId) else target.variant.providerStreamId
            return ResolvedStream(url, item.title, null)
        }
        PlayKind.Movie -> {
            val target = db.read { it.getMoviePlaybackTarget(item.id) } ?: throw IllegalStateException("That movie could not be found.")
            val url = if (target.source.kind == "m3u") target.providerStreamId else buildMovieStreamUrl(logins.current(target.source.id), target.providerStreamId, target.containerExtension)
            val progress = db.read { it.getPlaybackProgress("movie", item.id) }
            return ResolvedStream(url, target.movieName, if (resume && progress != null) progress.positionSecs else null)
        }
        PlayKind.Episode -> {
            val target = db.read { it.getEpisodePlaybackTarget(item.id) } ?: throw IllegalStateException("That episode could not be found.")
            val url = if (target.source.kind == "m3u") target.providerEpisodeId else buildEpisodeStreamUrl(logins.current(target.source.id), target.providerEpisodeId, target.containerExtension)
            val progress = db.read { it.getPlaybackProgress("episode", item.id) }
            return ResolvedStream(url, target.episodeName, if (resume && progress != null) progress.positionSecs else null)
        }
    }
}

/** The source a film, episode or channel is played from, as (id, kind). */
suspend fun sourceOfPlay(db: Db, kind: PlayKind, id: String): Pair<String, String>? {
    val sql = when (kind) {
        PlayKind.Channel -> "SELECT s.id, s.kind FROM channels c JOIN sources s ON s.id = c.source_id WHERE c.id = ?"
        PlayKind.Movie -> "SELECT s.id, s.kind FROM movies m JOIN sources s ON s.id = m.source_id WHERE m.id = ?"
        PlayKind.Episode -> "SELECT s.id, s.kind FROM episodes e JOIN series sr ON sr.id = e.series_id JOIN sources s ON s.id = sr.source_id WHERE e.id = ?"
    }
    return try { db.read { it.one(sql, id) { r -> r.getText(0) to r.getText(1) } } } catch (_: Exception) { null }
}

/** The Xtream source a film, episode or channel is played from, for asking about its account. Null for a playlist. */
suspend fun xtreamSourceOf(db: Db, kind: PlayKind, id: String): String? = sourceOfPlay(db, kind, id)?.takeIf { it.second == "xtream" }?.first
