package com.evcalex.testcard.core.playback

/** What the player says it is doing. */
enum class PlayerStatus { Idle, Loading, Ready, Error }

/** What the screen must do about a stream that is not behaving. */
sealed interface HealthAction {
    /** Ask for the same stream again from the start and play it. */
    data object Reload : HealthAction

    /** Give up on this feed or copy and try the next. */
    data object FailOver : HealthAction

    /** A server that cannot be reached: try the source's other addresses (answer with [PlaybackHealth.serverChecked]). */
    class TryOtherServer(val raw: String) : HealthAction
}

/** A live picture stuck refilling this long is reloaded, at most [MAX_RELOADS] times (PLY-06). */
const val STUCK_AFTER_MS = 12_000L
const val MAX_RELOADS = 4

/** How long a live feed may take to show a picture before the next one is tried (PLY-03). */
const val START_WITHIN_MS = 15_000L

/** A live picture paused for longer than this has fallen behind the broadcast (PLY-07). */
const val BEHIND_AFTER_MS = 2_000L

/** A film's next copy is only tried when this one never really played: one that played this long says so instead (PLY-04). */
const val REALLY_PLAYED_MS = 8_000L

/** How long the "that feed wouldn't play" note stays up. */
const val FELL_BACK_SHOWN_MS = 5_000L

/**
 * Everything the screen does about a stream that is not behaving (`usePlaybackHealth.ts`): reload a live picture that sticks,
 * move to the next feed or copy when one dies or never starts, try the source's other addresses, say which feed took over,
 * and notice when a paused live picture has fallen behind the broadcast.
 *
 * The player reports what it does through [onStatus] and [onPlaying]; [tick] (called every half second or so) fires whatever
 * has been waiting on time. Each returns the actions to carry out. Time comes from [now], so tests run on a fake clock.
 * One difference from the React Native version: a reload re-arms the stuck timer itself, where there it relied on the status
 * changing again.
 */
class PlaybackHealth(
    private val vod: Boolean,
    private val timeshift: Boolean,
    private val moreFeeds: Boolean,
    fellBack: String?,
    private val now: () -> Long,
) {
    /** The note to show once the picture is up on a feed that was not the first; may be set after the player has started. */
    var fellBack: String? = fellBack

    var status = PlayerStatus.Idle
        private set
    var error: String? = null
        private set
    var isPlaying = false
        private set
    var everPlayed = false
        private set

    /** "checking" while the other addresses are tried, "none" when none answered, null otherwise. */
    var otherServer: String? = null
        private set
    var fellBackShown = false
        private set
    var behindLive = false
        private set

    private var loadingSince: Long? = null
    private var reloads = 0
    private var playingSince: Long? = null
    private var failedOver = false
    private var serverAsked = false
    private var neverStartedSince: Long? = null
    private var fellBackSaid = false
    private var fellBackUntil = 0L
    private var pausedAt: Long? = null

    /** A film's or channel's error with another feed or copy left to try: shown as "Trying another feed...". */
    val failing get() = status == PlayerStatus.Error && !timeshift && moreFeeds

    fun onStatus(next: PlayerStatus, message: String? = null): List<HealthAction> {
        val before = status
        status = next
        error = if (next == PlayerStatus.Error) message else null
        if (next == PlayerStatus.Ready) everPlayed = true
        if (next == PlayerStatus.Loading && before != PlayerStatus.Loading) loadingSince = now()
        if (next != PlayerStatus.Loading) loadingSince = null
        if (next != PlayerStatus.Error) { failedOver = false; serverAsked = false; otherServer = null }
        updateNeverStarted()
        updatePause()
        updateFellBack()
        return evaluate()
    }

    fun onPlaying(playing: Boolean): List<HealthAction> {
        isPlaying = playing
        if (playing && playingSince == null) playingSince = now()
        updatePause()
        return emptyList()
    }

    fun tick(): List<HealthAction> {
        if (fellBackShown && now() >= fellBackUntil) fellBackShown = false
        updateFellBack()
        return evaluate()
    }

    /** The answer to [HealthAction.TryOtherServer]: `started` false when there was nothing to try; `changed` when another server answered. */
    fun serverChecked(started: Boolean, changed: Boolean) {
        if (!started) { otherServer = null; return }
        otherServer = if (changed) "checking" else "none"
    }

    /** "Live" pressed on a picture that has fallen behind: the stream is loaded afresh. */
    fun goLive(): List<HealthAction> {
        behindLive = false
        pausedAt = null
        return listOf(HealthAction.Reload)
    }

    private fun evaluate(): List<HealthAction> {
        val actions = ArrayList<HealthAction>()
        val t = now()
        // Live TV: a picture that stays stuck refilling is asked for again from the start, a few times, before giving up.
        val since = loadingSince
        if (!vod && !timeshift && status == PlayerStatus.Loading && everPlayed && reloads < MAX_RELOADS && since != null && t - since >= STUCK_AFTER_MS) {
            reloads += 1
            loadingSince = t
            actions += HealthAction.Reload
        }
        // With no other feed or copy left, a server that cannot be reached is tried on the source's other addresses.
        if (status == PlayerStatus.Error && !failing && !serverAsked) {
            serverAsked = true
            actions += HealthAction.TryOtherServer(error ?: "")
        }
        // A live channel that errors is tried on its next feed; a film's copy only when it never really played.
        if (failing && !failedOver) {
            failedOver = true
            val played = playingSince
            if (!vod || played == null || t - played < REALLY_PLAYED_MS) actions += HealthAction.FailOver
        }
        // Some dead streams never error, they just never start: after a while, the next feed is tried instead.
        val waiting = neverStartedSince
        if (waiting != null && !everPlayed && t - waiting >= START_WITHIN_MS) {
            neverStartedSince = null
            actions += HealthAction.FailOver
        }
        return actions
    }

    private fun updateNeverStarted() {
        val never = !timeshift && moreFeeds && status != PlayerStatus.Ready && status != PlayerStatus.Error
        if (never) { if (neverStartedSince == null) neverStartedSince = now() } else neverStartedSince = null
    }

    /** Once the picture is up on a feed that was not the first, say which, for a moment. */
    private fun updateFellBack() {
        if (fellBack == null || status != PlayerStatus.Ready || fellBackSaid) return
        fellBackSaid = true
        fellBackShown = true
        fellBackUntil = now() + FELL_BACK_SHOWN_MS
    }

    /** Live TV: pausing lets the picture fall behind the broadcast. Only a real pause counts, not the picture still starting or refilling. */
    private fun updatePause() {
        if (vod || timeshift) return
        if (!isPlaying && status == PlayerStatus.Ready && everPlayed) { if (pausedAt == null) pausedAt = now() }
        else if (isPlaying) {
            val at = pausedAt
            if (at != null) {
                if (now() - at > BEHIND_AFTER_MS) behindLive = true
                pausedAt = null
            }
        }
    }
}
