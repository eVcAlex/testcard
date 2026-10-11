package com.evcalex.testcard.tv.platform

import android.content.Context
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Tracks
import androidx.media3.common.util.Util
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.evcalex.testcard.core.playback.PlayerStatus
import com.evcalex.testcard.core.playback.TileBuffer
import com.evcalex.testcard.core.playback.TrackLabel
import okhttp3.OkHttpClient

/**
 * The player's setup (PLY-22, PLY-24): read well ahead so a provider hiccup is absorbed instead of stalling the picture, with a
 * byte cap so a high-bitrate 4K stream cannot fill a small device's memory before the time target is reached; and the Media3
 * default User-Agent, through an OkHttp data source.
 */
object Media3Player {
    private const val PLAY_AT_MS = 2_500
    private const val MB = 1024 * 1024

    fun create(context: Context, http: OkHttpClient, vod: Boolean): ExoPlayer {
        val target = if (vod) 40_000 else 60_000
        val cap = (if (vod) 64 else 48) * MB
        val load = DefaultLoadControl.Builder()
            .setBufferDurationsMs(target, target, PLAY_AT_MS, PLAY_AT_MS)
            .setTargetBufferBytes(cap)
            .setPrioritizeTimeOverSizeThresholds(false)
            .build()
        val upstream = OkHttpDataSource.Factory(http).setUserAgent(Util.getUserAgent(context, "Testcard"))
        return ExoPlayer.Builder(context)
            .setLoadControl(load)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(context, upstream)))
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .build()
            .also {
                // Some providers flag a subtitle track as the stream's default, which the player would otherwise turn on by
                // itself; captions only come on here when the CC button is pressed (or the viewer asked for them always).
                it.trackSelectionParameters = it.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
            }
    }

    /**
     * A player for one picture of Multi view. Several run at once, so each reads only a little ahead (the player with sound a
     * bit more) where one full-screen player reads a minute: the sum of their buffers has to fit a small device's memory, and
     * what they read ahead is bandwidth the others need. A muted picture also drops its audio track, so it neither decodes
     * nor renders sound. A decoder that cannot be had falls back to another instead of failing, and the picture is capped
     * at the tile's own size, which only matters for adaptive streams but costs nothing.
     */
    fun createTile(context: Context, http: OkHttpClient, buffer: TileBuffer, muted: Boolean, maxHeight: Int): ExoPlayer {
        val load = DefaultLoadControl.Builder()
            .setBufferDurationsMs(buffer.targetMs, buffer.targetMs, buffer.playAtMs, buffer.playAtMs)
            .setTargetBufferBytes(buffer.capBytes)
            .setPrioritizeTimeOverSizeThresholds(false)
            .build()
        val upstream = OkHttpDataSource.Factory(http).setUserAgent(Util.getUserAgent(context, "Testcard"))
        val renderers = androidx.media3.exoplayer.DefaultRenderersFactory(context).setEnableDecoderFallback(true)
        return ExoPlayer.Builder(context, renderers)
            .setLoadControl(load)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(context, upstream)))
            // Only the picture with sound takes audio focus; the rest must not pause it by asking for theirs.
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), !muted)
            .setHandleAudioBecomingNoisy(!muted)
            .build()
            .also { applyTileLook(it, muted, maxHeight) }
    }

    /** Sound on or off for a tile, and its size cap. Off also stops the audio renderer, which is most of a muted picture's other cost. */
    fun applyTileLook(player: ExoPlayer, muted: Boolean, maxHeight: Int) {
        player.volume = if (muted) 0f else 1f
        player.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), !muted)
        player.setHandleAudioBecomingNoisy(!muted)
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, muted)
            .setMaxVideoSize(maxHeight * 16 / 9, maxHeight)
            .build()
    }

    fun status(state: Int, errored: Boolean): PlayerStatus = when {
        errored -> PlayerStatus.Error
        state == androidx.media3.common.Player.STATE_BUFFERING -> PlayerStatus.Loading
        state == androidx.media3.common.Player.STATE_READY || state == androidx.media3.common.Player.STATE_ENDED -> PlayerStatus.Ready
        else -> PlayerStatus.Idle
    }

    /**
     * What `explain` and `plainReason` look for in an error: Media3's code name ("…EXCEEDS_CAPABILITIES"), its message, and the
     * class names and messages down the cause chain ("UnknownHostException", "Response code: 403").
     */
    fun describe(error: PlaybackException): String {
        val parts = ArrayList<String>()
        parts += error.errorCodeName
        logProviderReply(error)
        var cause: Throwable? = error
        var depth = 0
        while (cause != null && depth < 6) {
            parts += "${cause.javaClass.simpleName}: ${cause.message ?: ""}"
            cause = cause.cause
            depth += 1
        }
        return parts.joinToString(" ")
    }

    /** What the provider said when it refused a stream (status, headers, start of the body; never the address), for `adb logcat -s TestcardPlay`. */
    private fun logProviderReply(error: Throwable) {
        var cause: Throwable? = error
        while (cause != null) {
            if (cause is androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException) {
                android.util.Log.w("TestcardPlay", "provider answered ${cause.responseCode} ${cause.responseMessage} headers=${cause.headerFields} body=${String(cause.responseBody, Charsets.UTF_8).take(300)}")
                return
            }
            cause = cause.cause
        }
    }

    /** A selectable track of one kind: the group and track index to override with, and what it says about itself. */
    class Option(val group: Tracks.Group, val index: Int, val label: TrackLabel, val selected: Boolean)

    fun options(tracks: Tracks, type: Int): List<Option> = tracks.groups.filter { it.type == type && it.isSupported }.flatMap { group ->
        (0 until group.length).filter { group.isTrackSupported(it) }.map { index ->
            val format = group.getTrackFormat(index)
            Option(group, index, TrackLabel(format.language, format.label), group.isTrackSelected(index))
        }
    }
}
