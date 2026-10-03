package com.evcalex.testcard.tv.ui.player

import android.view.KeyEvent as AndroidKeyEvent
import android.view.View
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import com.evcalex.testcard.core.db.findNextEpisode
import com.evcalex.testcard.core.db.getPlaybackProgress
import com.evcalex.testcard.core.db.recordMovieRecent
import com.evcalex.testcard.core.db.recordRecent
import com.evcalex.testcard.core.db.recordSeriesRecent
import com.evcalex.testcard.core.db.setPlaybackProgress
import com.evcalex.testcard.core.guide.Airing
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.playback.AUTO_NEXT_SECS
import com.evcalex.testcard.core.playback.CAPTION_SETTINGS
import com.evcalex.testcard.core.playback.CAPTION_TEXT_FRACTION
import com.evcalex.testcard.core.playback.CHROME_HIDES_AFTER_MS
import com.evcalex.testcard.core.playback.CaptionPrefs
import com.evcalex.testcard.core.playback.CaptionSetting
import com.evcalex.testcard.core.playback.CatchupEntry
import com.evcalex.testcard.core.playback.Control
import com.evcalex.testcard.core.playback.HealthAction
import com.evcalex.testcard.core.playback.KeyAction
import com.evcalex.testcard.core.playback.KeyContext
import com.evcalex.testcard.core.playback.KeyInput
import com.evcalex.testcard.core.playback.KeyPhase
import com.evcalex.testcard.core.playback.Panel
import com.evcalex.testcard.core.playback.PictureFit
import com.evcalex.testcard.core.playback.PlayItem
import com.evcalex.testcard.core.playback.PlayKind
import com.evcalex.testcard.core.playback.PlaybackHealth
import com.evcalex.testcard.core.playback.PlayerKeys
import com.evcalex.testcard.core.playback.PlayerStatus
import com.evcalex.testcard.core.playback.RemoteKey
import com.evcalex.testcard.core.playback.ResolvedStream
import com.evcalex.testcard.core.playback.SCRUB_MAX_TICKS
import com.evcalex.testcard.core.playback.SCRUB_TICK_MS
import com.evcalex.testcard.core.playback.SeekStreak
import com.evcalex.testcard.core.playback.audioName
import com.evcalex.testcard.core.playback.autoAudioTrack
import com.evcalex.testcard.core.playback.autoCaptionTrack
import com.evcalex.testcard.core.playback.captionLook
import com.evcalex.testcard.core.playback.catchupEntries
import com.evcalex.testcard.core.playback.channelCatchup
import com.evcalex.testcard.core.playback.clock
import com.evcalex.testcard.core.playback.clock24
import com.evcalex.testcard.core.playback.controlRows
import com.evcalex.testcard.core.playback.loadCatchupGuide
import com.evcalex.testcard.core.playback.nextSpeed
import com.evcalex.testcard.core.playback.readPictureFit
import com.evcalex.testcard.core.playback.scrubStep
import com.evcalex.testcard.core.playback.settingLabel
import com.evcalex.testcard.core.playback.speedLabel
import com.evcalex.testcard.core.playback.stepSetting
import com.evcalex.testcard.core.playback.streamFacts
import com.evcalex.testcard.core.playback.NO_FACTS
import com.evcalex.testcard.core.playback.trackLanguage
import com.evcalex.testcard.core.playback.two
import com.evcalex.testcard.core.playback.writePictureFit
import com.evcalex.testcard.core.text.playerTitle
import com.evcalex.testcard.core.xtream.CatchupProgramme
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.platform.Media3Player
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.Glyph
import com.evcalex.testcard.tv.ui.components.GlyphIcon
import com.evcalex.testcard.tv.ui.theme.Palette
import java.util.Calendar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val PROGRESS_EVERY_MS = 5_000L

private sealed interface GuideState {
    data object Loading : GuideState
    data object Failed : GuideState
    class Ready(val entries: List<CatchupEntry>) : GuideState
}

private fun remoteKey(code: Int): RemoteKey? = when (code) {
    AndroidKeyEvent.KEYCODE_DPAD_UP -> RemoteKey.Up
    AndroidKeyEvent.KEYCODE_DPAD_DOWN -> RemoteKey.Down
    AndroidKeyEvent.KEYCODE_DPAD_LEFT -> RemoteKey.Left
    AndroidKeyEvent.KEYCODE_DPAD_RIGHT -> RemoteKey.Right
    AndroidKeyEvent.KEYCODE_DPAD_CENTER, AndroidKeyEvent.KEYCODE_ENTER, AndroidKeyEvent.KEYCODE_NUMPAD_ENTER -> RemoteKey.Select
    AndroidKeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, AndroidKeyEvent.KEYCODE_MEDIA_PLAY, AndroidKeyEvent.KEYCODE_MEDIA_PAUSE -> RemoteKey.PlayPause
    AndroidKeyEvent.KEYCODE_MEDIA_REWIND -> RemoteKey.Rewind
    AndroidKeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> RemoteKey.FastForward
    else -> null
}

private fun holdable(key: RemoteKey) = key == RemoteKey.Left || key == RemoteKey.Right || key == RemoteKey.Rewind || key == RemoteKey.FastForward

/**
 * The player once there is a stream (`Player.tsx` Playing): the picture, the controls drawn over it, and everything that keeps
 * the stream healthy and the viewer's place saved. Left and Right seek, OK plays or pauses, Up and Down show the controls
 * or change channel, Back hides them and then leaves.
 */
@Composable
fun Playing(
    app: AppController,
    item: PlayItem,
    stream: ResolvedStream,
    catchup: CatchupProgramme?,
    onCatchup: (CatchupProgramme?) -> Unit,
    seriesId: String?,
    channels: List<PlayItem>?,
    onZap: (PlayItem) -> Unit,
    onNextEpisode: (PlayItem) -> Unit,
    keys: PlayerKeys,
    history: ChannelHistory,
    moreFeeds: Boolean,
    onFailOver: () -> Unit,
    onResolveAgain: () -> Unit,
    onServerDown: suspend (String) -> Boolean?,
    fellBack: String?,
    onExit: () -> Unit,
    sourceForm: (@Composable (sourceId: String, onClose: () -> Unit) -> Unit)?,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val vod = item.kind != PlayKind.Channel
    val timeshift = catchup != null
    val player = remember { Media3Player.create(context, app.http, vod) }
    DisposableEffect(player) { onDispose { player.release() } }
    // Once per play: a value is returned because `remember` must not return Unit.
    remember { keys.begin(); if (item.kind == PlayKind.Channel && !timeshift) history.see(item); true }

    // ---- stream health
    val health = remember { PlaybackHealth(vod, timeshift, moreFeeds, fellBack, ::nowMs) }
    health.fellBack = fellBack
    var healthTick by remember { mutableIntStateOf(0) }
    var errored by remember { mutableStateOf(false) }
    var facts by remember { mutableStateOf(NO_FACTS) }
    var tracks by remember { mutableStateOf(Tracks.EMPTY) }
    var textOn by remember { mutableStateOf(false) }
    fun replay() {
        errored = false
        player.setMediaItem(MediaItem.fromUri(stream.url))
        player.prepare()
        player.play()
    }
    fun applyHealth(actions: List<HealthAction>) {
        for (action in actions) when (action) {
            HealthAction.Reload -> replay()
            HealthAction.FailOver -> onFailOver()
            is HealthAction.TryOtherServer -> scope.launch {
                val result = onServerDown(action.raw)
                health.serverChecked(started = result != null, changed = result == true)
                healthTick += 1
            }
        }
        healthTick += 1
    }
    var errorText by remember { mutableStateOf("") }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) { applyHealth(health.onStatus(Media3Player.status(state, errored), if (errored) errorText else null)) }
            override fun onIsPlayingChanged(isPlaying: Boolean) { applyHealth(health.onPlaying(isPlaying)) }
            override fun onPlayerError(error: PlaybackException) {
                errored = true
                errorText = Media3Player.describe(error)
                applyHealth(health.onStatus(PlayerStatus.Error, errorText))
            }
            override fun onTracksChanged(newTracks: Tracks) {
                tracks = newTracks
                textOn = !player.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)
                facts = player.videoFormat?.let { streamFacts(it.width, it.height, it.sampleMimeType, it.frameRate.takeIf { f -> f > 0 }, it.bitrate.takeIf { b -> b > 0 }, it.colorInfo?.colorTransfer) } ?: NO_FACTS
            }
            override fun onVideoSizeChanged(size: androidx.media3.common.VideoSize) {
                facts = player.videoFormat?.let { streamFacts(it.width, it.height, it.sampleMimeType, it.frameRate.takeIf { f -> f > 0 }, it.bitrate.takeIf { b -> b > 0 }, it.colorInfo?.colorTransfer) } ?: NO_FACTS
            }
        }
        player.addListener(listener)
        player.setMediaItem(MediaItem.fromUri(stream.url), stream.resumeSecs?.let { (it * 1000).toLong() } ?: C.TIME_UNSET)
        player.prepare()
        player.play()
        onDispose { player.removeListener(listener) }
    }
    @Suppress("UNUSED_VARIABLE") val observed = healthTick
    val status = health.status
    val isPlaying = health.isPlaying

    // ---- position, polled (a time update re-draws the screen, so live needs far fewer)
    var positionSecs by remember { mutableDoubleStateOf(stream.resumeSecs ?: 0.0) }
    var duration by remember { mutableDoubleStateOf(0.0) }
    var bufferedSecs by remember { mutableDoubleStateOf(0.0) }
    var seekedTo by remember { mutableStateOf<Double?>(null) }
    LaunchedEffect(player) {
        while (true) {
            positionSecs = player.currentPosition / 1000.0
            val length = player.duration
            duration = if (length != C.TIME_UNSET && length > 0) length / 1000.0 else 0.0
            bufferedSecs = player.bufferedPosition / 1000.0
            val before = health.fellBackShown
            val actions = health.tick()
            if (actions.isNotEmpty() || before != health.fellBackShown) applyHealth(actions)
            delay(if (vod) 500 else 1000)
        }
    }
    LaunchedEffect(positionSecs) { if (!keys.scrubbing) seekedTo = null }
    val position = seekedTo ?: positionSecs
    // Progress is saved from these, not from the player: on leaving, the player is already released by the time cleanup runs.
    val latest = remember { doubleArrayOf(0.0, 0.0) }
    latest[0] = position
    latest[1] = duration
    // The position last written here, and when: where the player started counts, so an untouched play writes nothing.
    val saved = remember { doubleArrayOf(stream.resumeSecs ?: 0.0, nowMs().toDouble()) }

    // ---- what is on now (live)
    val airing by produceState<Airing?>(null, item.id, timeshift, vod) {
        if (vod || timeshift) return@produceState
        while (true) {
            val found = try { withContext(Dispatchers.Default) { app.guides.fetchGuide(item.id) }?.now } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error else null }
            value = found
            delay(if (found != null) Math.min(30 * 60_000L, Math.max(30_000L, found.end - nowMs() + 2000)) else 5 * 60_000L)
        }
    }

    // ---- captions
    val captionOptions = remember(tracks) { Media3Player.options(tracks, C.TRACK_TYPE_TEXT) }
    val captions = app.captions
    val currentCaption = if (!textOn) 0 else (captionOptions.indexOfFirst { it.selected } + 1)
    var panel by remember { mutableStateOf(Panel.None) }
    var captionAt by remember { mutableIntStateOf(0) }
    fun selectCaption(index: Int) {
        val option = captionOptions.getOrNull(index - 1)
        val builder = player.trackSelectionParameters.buildUpon()
        if (option == null) builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).clearOverridesOfType(C.TRACK_TYPE_TEXT)
        else builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setOverrideForType(TrackSelectionOverride(option.group.mediaTrackGroup, listOf(option.index)))
        player.trackSelectionParameters = builder.build()
        textOn = option != null
    }
    // Films and episodes start with captions on when the viewer has asked for them always, in their language. Once per stream,
    // when its tracks turn up (a moment after it starts); after that the viewer's own choice stands.
    val autoCaptioned = remember { booleanArrayOf(false) }
    LaunchedEffect(tracks, captions) {
        if (!vod || autoCaptioned[0] || captionOptions.isEmpty()) return@LaunchedEffect
        autoCaptioned[0] = true
        autoCaptionTrack(captions, captionOptions) { it.label }?.let { selectCaption(captionOptions.indexOf(it) + 1) }
    }
    fun changeCaptions(prefs: CaptionPrefs, setting: CaptionSetting) {
        app.changeCaptions(prefs)
        // Turning "always" on, or changing its language, also picks the track that goes with it now.
        if ((setting.key == "always" || setting.key == "language") && prefs.always) {
            val track = autoCaptionTrack(prefs, captionOptions) { it.label }
            selectCaption(if (track == null) 0 else captionOptions.indexOf(track) + 1)
        }
    }
    val captionRows = captionOptions.size + 1 + CAPTION_SETTINGS.size

    // ---- soundtrack, picture size, speed
    val audioOptions = remember(tracks) { Media3Player.options(tracks, C.TRACK_TYPE_AUDIO) }
    val currentAudio = audioOptions.indexOfFirst { it.selected }
    var audioAt by remember { mutableIntStateOf(0) }
    val autoAudioed = remember { booleanArrayOf(false) }
    LaunchedEffect(tracks, app.audioLanguage) {
        if (autoAudioed[0] || audioOptions.size < 2) return@LaunchedEffect
        autoAudioed[0] = true
        val track = autoAudioTrack(app.audioLanguage, audioOptions, audioOptions.firstOrNull { it.selected }) { it.label } ?: return@LaunchedEffect
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setOverrideForType(TrackSelectionOverride(track.group.mediaTrackGroup, listOf(track.index))).build()
    }
    fun chooseAudio(index: Int) {
        val track = audioOptions.getOrNull(index) ?: return
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setOverrideForType(TrackSelectionOverride(track.group.mediaTrackGroup, listOf(track.index))).build()
        app.changeAudioLanguage(trackLanguage(track.label))
    }
    // Picture size is kept per channel; a film or episode starts at Fit.
    var fit by remember { mutableStateOf(PictureFit.Fit) }
    LaunchedEffect(item.id) { if (item.kind == PlayKind.Channel) fit = app.db.read { it.readPictureFit(item.id) } }
    fun cycleFit() {
        val next = fit.next()
        fit = next
        if (item.kind == PlayKind.Channel) scope.launch { app.db.write { it.writePictureFit(item.id, next) } }
    }
    // Speed is never kept: each film starts at normal speed.
    var speed by remember { mutableFloatStateOf(1f) }
    fun cycleSpeed() { val next = nextSpeed(speed); player.setPlaybackSpeed(next); speed = next }

    // ---- pick-up from another TV: paused here and watched further on another, the player moves to it rather than offering the old place
    var pickedUp by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(app.version, isPlaying, status) {
        if (!vod || timeshift || isPlaying || status != PlayerStatus.Ready) return@LaunchedEffect
        val row = app.db.read { it.getPlaybackProgress(item.kind.name.lowercase(), item.id) } ?: return@LaunchedEffect
        if (row.updatedAt <= saved[1] || Math.abs(row.positionSecs - latest[0]) < 20) return@LaunchedEffect
        player.seekTo((row.positionSecs * 1000).toLong())
        saved[0] = row.positionSecs
        saved[1] = row.updatedAt.toDouble()
        pickedUp = "Picked up at ${clock(row.positionSecs)} from your other TV"
    }
    LaunchedEffect(pickedUp) { if (pickedUp != null) { delay(5000); pickedUp = null } }

    // ---- next episode: when an episode ends, the next is offered and starts by itself after a short countdown
    val next by produceState<com.evcalex.testcard.core.db.NextEpisode?>(null, item.id) { value = if (item.kind == PlayKind.Episode) app.db.read { it.findNextEpisode(item.id) } else null }
    val finished = next != null && duration > 300 && position >= duration - 0.5
    var autoCancelled by remember { mutableStateOf(false) }
    LaunchedEffect(finished) { if (!finished) autoCancelled = false }
    fun goNext() { next?.let { onNextEpisode(PlayItem(PlayKind.Episode, it.id, it.name)) } }
    val counting = finished && !autoCancelled
    val countdown = remember { Animatable(0f) }
    LaunchedEffect(counting) {
        countdown.snapTo(0f)
        if (!counting) return@LaunchedEffect
        countdown.animateTo(1f, tween(AUTO_NEXT_SECS * 1000, easing = LinearEasing))
        goNext()
    }

    // ---- the controls fade out while playing and come back on any key or pause
    var awake by remember { mutableStateOf(true) }
    // Back hides the controls even over a paused picture (where they would otherwise stay up); any key brings them back.
    var muted by remember { mutableStateOf(false) }
    var wakeStamp by remember { mutableIntStateOf(0) }
    fun wake() { muted = false; awake = true; wakeStamp += 1 }
    LaunchedEffect(wakeStamp) { delay(CHROME_HIDES_AFTER_MS); awake = false }
    val chrome = !muted && (awake || !isPlaying)
    val fade by animateFloatAsState(if (chrome) 1f else 0f, tween(200), label = "chrome")
    var flash by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(flash) { if (flash != null) { delay(350); flash = null } }

    // ---- seeking
    val streak = remember { SeekStreak(::nowMs) }
    fun seek(direction: Int) {
        if (!vod) return
        val step = streak.press(direction)
        // From a seek still under way, so quick presses add up rather than each starting from where the picture was.
        val from = seekedTo ?: (player.currentPosition / 1000.0)
        val target = Math.min(if (duration > 0) duration - 1 else Double.MAX_VALUE, Math.max(0.0, from + direction * step))
        player.seekTo((target * 1000).toLong())
        seekedTo = target
        flash = if (direction == 1) "forward" else "back"
        wake()
    }
    // Holding left or right (on the bar, or with the controls hidden) scrubs: the bar runs ahead, faster the longer the key is held,
    // and the picture jumps there when it is let go.
    val scrub = remember { arrayOf<Job?>(null, null) }
    var scrubTarget by remember { mutableDoubleStateOf(0.0) }
    fun endScrub(commit: Boolean) {
        scrub[0]?.cancel()
        scrub[0] = null
        if (!keys.scrubbing) return
        keys.scrubbing = false
        if (commit) { player.seekTo((scrubTarget * 1000).toLong()); seekedTo = scrubTarget } else seekedTo = null
        wake()
    }
    fun startScrub(direction: Int) {
        if (!vod || duration <= 0) return
        endScrub(false)
        scrubTarget = seekedTo ?: (player.currentPosition / 1000.0)
        keys.scrubbing = true
        seekedTo = scrubTarget
        flash = if (direction == 1) "forward" else "back"
        wake()
        scrub[0] = scope.launch {
            var ticks = 0
            while (true) {
                delay(SCRUB_TICK_MS)
                ticks += 1
                scrubTarget = Math.min(duration - 1, Math.max(0.0, scrubTarget + direction * scrubStep(ticks)))
                seekedTo = scrubTarget
                wake()
                // Let go of somewhere the remote never told us about: stop after a minute rather than run on for good.
                if (ticks > SCRUB_MAX_TICKS) { endScrub(true); break }
            }
        }
    }
    DisposableEffect(Unit) { onDispose { scrub[0]?.cancel() } }

    // ---- live: step through the channels of the list the viewer came from
    val at = channels?.indexOfFirst { it.id == item.id } ?: -1
    val zapping = !vod && !timeshift && at >= 0 && channels != null && channels.size > 1
    fun zap(direction: Int) {
        if (!zapping || channels == null) return
        onZap(channels[(at + direction + channels.size) % channels.size])
    }
    fun step(direction: Int) = if (vod) seek(direction) else zap(direction)

    // ---- catch-up: when the provider keeps this channel's past programmes, the viewer can open the list and play one from its start
    val archive by produceState<com.evcalex.testcard.core.playback.ChannelCatchup?>(null, item.id, vod) { value = if (vod) null else channelCatchup(app.db, item.id) }
    var guide by remember { mutableStateOf<GuideState?>(null) }
    var guideAt by remember { mutableIntStateOf(0) }
    fun openGuide() {
        val source = archive ?: return
        guide = GuideState.Loading
        guideAt = 0
        panel = Panel.Guide
        scope.launch {
            guide = try { GuideState.Ready(catchupEntries(withContext(Dispatchers.Default) { loadCatchupGuide(app.logins, app.http, source) })) } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error else GuideState.Failed }
        }
    }

    // ---- play and pause
    val lastToggle = remember { longArrayOf(0) }
    fun togglePause() {
        val t = nowMs()
        if (t - lastToggle[0] < 500) return
        lastToggle[0] = t
        if (player.isPlaying) player.pause() else player.play()
        flash = "play"
        wake()
    }

    // ---- the remote
    val previousChannel = if (zapping) history.previous else null
    val captionsKey = tracks.groups.any { it.type == C.TRACK_TYPE_TEXT } && vod && captionOptions.isNotEmpty()
    val nextKey = next != null
    val rows = controlRows(vod, timeshift, zapping, vod && captionsKey, nextKey, previousChannel != null, archive != null, audioOptions.size > 1)
    val ctx = KeyContext(
        vod, timeshift, zapping, chrome, panel, finished, rows, health.behindLive, previousChannel != null,
        captionOnSetting = captionAt > captionOptions.size, guideReady = guide is GuideState.Ready,
    )
    fun perform(action: KeyAction) {
        when (action) {
            KeyAction.Wake -> wake()
            KeyAction.Exit -> onExit()
            is KeyAction.Seek -> seek(action.direction)
            is KeyAction.Step -> step(action.direction)
            is KeyAction.Zap -> zap(action.direction)
            KeyAction.ZapToPrevious -> history.previous?.let(onZap)
            is KeyAction.StartScrub -> startScrub(action.direction)
            is KeyAction.EndScrub -> endScrub(action.commit)
            KeyAction.CancelCountdown -> autoCancelled = true
            KeyAction.GoNext -> goNext()
            // There is no media session here to toggle on its own, so the media key toggles directly (debounced as OK is).
            KeyAction.RemotePlayPause, KeyAction.TogglePause -> togglePause()
            KeyAction.OpenCaptions -> { captionAt = Math.max(0, currentCaption); panel = Panel.Captions }
            KeyAction.OpenAudio -> { audioAt = Math.max(0, currentAudio); panel = Panel.Audio }
            KeyAction.OpenGuide -> openGuide()
            KeyAction.CyclePicture -> cycleFit()
            KeyAction.CycleSpeed -> cycleSpeed()
            KeyAction.BackToLive -> onCatchup(null)
            KeyAction.GoLive -> applyHealth(health.goLive())
            is KeyAction.PanelMove -> when (action.panel) {
                Panel.Audio -> audioAt = (audioAt + action.delta).coerceIn(0, Math.max(0, audioOptions.size - 1))
                Panel.Captions -> captionAt = (captionAt + action.delta).coerceIn(0, captionRows - 1)
                Panel.Guide -> guideAt = (guideAt + action.delta).coerceIn(0, Math.max(0, ((guide as? GuideState.Ready)?.entries?.size ?: 0) - 1))
                Panel.None -> {}
            }
            is KeyAction.PanelChoose -> when (action.panel) {
                Panel.Audio -> { panel = Panel.None; chooseAudio(audioAt) }
                Panel.Captions -> { panel = Panel.None; selectCaption(captionAt) }
                Panel.Guide -> { val entry = (guide as? GuideState.Ready)?.entries?.getOrNull(guideAt); panel = Panel.None; guide = null; if (entry != null) onCatchup(entry.programme) }
                Panel.None -> {}
            }
            is KeyAction.PanelClose -> { panel = Panel.None; guide = null }
            is KeyAction.StepSetting -> CAPTION_SETTINGS.getOrNull(captionAt - captionOptions.size - 1)?.let { setting -> changeCaptions(stepSetting(captions, setting, action.direction), setting) }
        }
    }
    // Back closes an open panel, else hides the controls (playing or paused), else leaves, checked in that order on every press.
    BackHandler {
        if (panel != Panel.None) { panel = Panel.None; guide = null }
        else if (chrome) { awake = false; muted = true }
        else onExit()
    }
    val held = remember { arrayOf<RemoteKey?>(null) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    // ---- recents on first play; progress every few seconds for films and episodes
    val started = remember { booleanArrayOf(false) }
    DisposableEffect(item.id, seriesId, timeshift) {
        if (!started[0]) {
            started[0] = true
            scope.launch {
                app.db.write { c ->
                    when (item.kind) {
                        PlayKind.Channel -> if (!timeshift) c.recordRecent(item.id)
                        PlayKind.Movie -> c.recordMovieRecent(item.id)
                        PlayKind.Episode -> if (seriesId != null) c.recordSeriesRecent(seriesId)
                    }
                }
                app.sync.notifyLocalChange()
            }
        }
        val save = {
            val at = latest[0]
            val length = latest[1]
            // No known length means nothing has played (a failed start), so there is no position worth keeping. Nor is one that has
            // not moved: a player left paused must not keep stamping its old place as the newest, or it would win over where the
            // viewer has since got to on another TV.
            if (vod && at > 0 && length > 0 && Math.abs(at - saved[0]) >= 2) {
                saved[0] = at
                saved[1] = nowMs().toDouble()
                val type = item.kind.name.lowercase()
                app.scope.launch { app.db.write { it.setPlaybackProgress(type, item.id, Math.floor(at), Math.floor(length)) }; app.sync.notifyLocalChange() }
            }
        }
        val job = if (vod) scope.launch { while (true) { delay(PROGRESS_EVERY_MS); save() } } else null
        onDispose { job?.cancel(); save() }
    }

    // ---- what is drawn
    if (health.failing) { StatusScreen(item.title, "Trying another feed..."); return }
    if (health.otherServer == "checking") { StatusScreen(item.title, "The provider's server isn't answering. Trying its other addresses..."); return }
    if (status == PlayerStatus.Error) {
        val raw = health.error ?: errorText
        val message = explain(raw)
        val known = message != "This couldn't be played."
        val undecodable = Regex("EXCEEDS_CAPABILITIES|MediaCodec|Decoder|decoder").containsMatchIn(raw)
        val editSource by produceState<String?>(null, item.id) { value = com.evcalex.testcard.core.playback.sourceOfPlay(app.db, item.kind, item.id)?.first }
        val account by produceState<String?>(null, item.id, undecodable) { value = if (undecodable) null else com.evcalex.testcard.core.playback.xtreamSourceOf(app.db, item.kind, item.id) }
        BackHandler(onBack = if (timeshift) ({ onCatchup(null) }) else onExit)
        FailureScreen(
            app, if (vod) playerTitle(stream.title) else stream.title, message, if (known) null else raw, raw, editSource, account,
            // A moved server is asked for afresh (its address may just have been edited); anything else plays again.
            if (undecodable) null else if (com.evcalex.testcard.core.text.serverGone(raw)) onResolveAgain else ({ replay() }),
            if (timeshift) ({ onCatchup(null) }) else onExit, sourceForm,
        )
        return
    }

    val ended = duration > 0 && position >= duration - 0.5
    val loading = (status == PlayerStatus.Loading || (status == PlayerStatus.Idle && !isPlaying)) && !ended
    val ratio = if (duration > 0) Math.min(1.0, position / duration).toFloat() else 0f
    val buffered = if (duration > 0) Math.min(1.0, bufferedSecs / duration).toFloat() else 0f
    val remaining = if (duration > 0) Math.max(0.0, duration - position) else 0.0
    val endsAt = nowMs() + (remaining * 1000).toLong()
    fun lit(control: Control) = chrome && keys.selected == control
    // Live TV's bar is how far through the programme the broadcast is (or, in catch-up, the picture). Films and episodes use their own length.
    val programme = if (vod) null else if (catchup != null) Triple(catchup.title, catchup.startMs, catchup.endMs) else airing?.let { Triple(it.title, it.start, it.end) }
    val programmeRatio = if (programme == null || programme.third <= programme.second) null else Math.min(1.0, Math.max(0.0, (if (timeshift) position * 1000 else (nowMs() - programme.second).toDouble()) / (programme.third - programme.second))).toFloat()
    val atEdge = !vod && !timeshift && programmeRatio == null
    val barRatio = if (vod) ratio else if (atEdge) 1f else (programmeRatio ?: 0f)

    Box(
        Modifier.fillMaxSize().background(Color.Black).focusRequester(focus).focusable()
            .onPreviewKeyEvent { event ->
                val key = remoteKey(event.key.nativeKeyCode) ?: return@onPreviewKeyEvent false
                val native = event.nativeKeyEvent
                when (event.type) {
                    KeyEventType.KeyDown -> {
                        // Holding a direction: the system flags the first repeat as a long press; key-down duplicates are otherwise ignored (PLY-25).
                        if (holdable(key) && native.isLongPress && held[0] != key) {
                            held[0] = key
                            keys.handle(KeyInput(key, KeyPhase.HoldStart), ctx).forEach(::perform)
                        }
                    }
                    KeyEventType.KeyUp -> {
                        if (held[0] == key) { held[0] = null; keys.handle(KeyInput(key, KeyPhase.HoldEnd), ctx).forEach(::perform) }
                        else keys.handle(KeyInput(key), ctx).forEach(::perform)
                    }
                    else -> {}
                }
                true
            },
    ) {
        val exoPlayer = player
        AndroidView(
            factory = { viewContext ->
                PlayerView(viewContext).apply {
                    useController = false
                    setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                    setShutterBackgroundColor(android.graphics.Color.BLACK)
                    keepScreenOn = true
                    isFocusable = false
                    isFocusableInTouchMode = false
                    descendantFocusability = android.view.ViewGroup.FOCUS_BLOCK_DESCENDANTS
                    this.player = exoPlayer
                }
            },
            modifier = Modifier.fillMaxSize(),
            update = { view ->
                view.resizeMode = when (fit) { PictureFit.Fit -> AspectRatioFrameLayout.RESIZE_MODE_FIT; PictureFit.Fill -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM; PictureFit.Stretch -> AspectRatioFrameLayout.RESIZE_MODE_FILL }
                val look = captionLook(captions)
                view.subtitleView?.apply {
                    setStyle(
                        CaptionStyleCompat(
                            look.color, look.background, 0,
                            when (look.edge) { "outline" -> CaptionStyleCompat.EDGE_TYPE_OUTLINE; "shadow" -> CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW; else -> CaptionStyleCompat.EDGE_TYPE_NONE },
                            android.graphics.Color.BLACK, null,
                        ),
                    )
                    setFractionalTextSize(CAPTION_TEXT_FRACTION * look.textScale)
                }
            },
        )
        if (loading) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Spinner(64.dp) }
        pickedUp?.let { Note(it) }
        if (health.fellBackShown && fellBack != null) Note("${if (vod) "That copy" else "That feed"} wouldn't play. $fellBack.")

        Box(Modifier.fillMaxSize().alpha(fade)) {
            Box(Modifier.fillMaxWidth().align(Alignment.TopCenter)) {
                Scrim(true, Modifier.matchParentSize())
                Row(Modifier.fillMaxWidth().padding(start = 96.dp, end = 96.dp, top = 48.dp, bottom = 90.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                    Box(Modifier.size(72.dp).background(if (lit(Control.Exit)) Palette.foreground else Color(0x88000000), androidx.compose.foundation.shape.CircleShape), contentAlignment = Alignment.Center) {
                        GlyphIcon(Glyph.Back, if (lit(Control.Exit)) INK else Palette.foreground, 32.dp)
                    }
                    val now = Calendar.getInstance()
                    AppText("${two(now.get(Calendar.HOUR_OF_DAY))}:${two(now.get(Calendar.MINUTE))}", 30, Palette.foreground.copy(alpha = 0.9f), FontWeight.Medium)
                }
            }
            Column(Modifier.fillMaxWidth().align(Alignment.BottomCenter)) {
                Box {
                    Scrim(false, Modifier.matchParentSize())
                    Column(Modifier.fillMaxWidth().padding(start = 96.dp, end = 96.dp, bottom = 44.dp, top = 220.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (!vod) {
                                val label = if (timeshift) "CATCH-UP" else if (health.behindLive) "BEHIND LIVE" else "LIVE"
                                Row(
                                    Modifier.background(if (timeshift) Palette.accent else if (health.behindLive) Color(0x33FFFFFF) else Palette.live, androidx.compose.foundation.shape.RoundedCornerShape(7.dp)).padding(horizontal = 14.dp, vertical = 5.dp),
                                    horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    if (!timeshift && !health.behindLive) Box(Modifier.size(9.dp).background(Color.White, androidx.compose.foundation.shape.CircleShape))
                                    AppText(label, 19, if (timeshift) Palette.accentInk else Color.White, FontWeight.SemiBold, letterSpacing = 1.5f)
                                }
                            }
                            AppText(if (vod) playerTitle(stream.title) else stream.title, 44, Palette.foreground, FontWeight.SemiBold, maxLines = 1, letterSpacing = -0.5f)
                        }
                        if (programme != null && !timeshift) AppText("${programme.first}   ${clock24(programme.second)} to ${clock24(programme.third)}", 26, Palette.foreground.copy(alpha = 0.75f), maxLines = 1)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { listOf(facts.quality, facts.fps, facts.codec, facts.hdr).forEach { chip -> if (chip != null) Chip(chip) } }
                        ProgressBar(barRatio, if (vod) buffered else null, lit(Control.Seek), atEdge && !health.behindLive)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                if (!vod) Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                                    TextKey(if (timeshift) "Back to live" else "Live", dot = !timeshift && !health.behindLive, selected = lit(Control.Live))
                                    if (zapping) AppText("${at + 1} of ${channels?.size ?: 0}", 28, Palette.foreground.copy(alpha = 0.6f))
                                } else Row {
                                    AppText(clock(position), 28, Palette.foreground, FontWeight.Medium)
                                    if (duration > 0) {
                                        val end = Calendar.getInstance().apply { timeInMillis = endsAt }
                                        AppText(" / ${clock(duration)}   Ends ${two(end.get(Calendar.HOUR_OF_DAY))}:${two(end.get(Calendar.MINUTE))}", 28, Palette.foreground.copy(alpha = 0.6f))
                                    }
                                }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                                if (vod || zapping) TransportKey(selected = lit(Control.Back), active = flash == "back") { ink ->
                                    if (vod) Box(contentAlignment = Alignment.Center) { GlyphIcon(Glyph.Restart, ink, 44.dp); AppText("15", 14, ink, FontWeight.Bold) }
                                    else GlyphIcon(Glyph.ChevronRight, ink, 40.dp, Modifier.scale(-1f, 1f))
                                }
                                TransportKey(big = true, selected = lit(Control.Play), active = flash == "play") { ink -> GlyphIcon(if (isPlaying) Glyph.Pause else Glyph.Play, ink, 44.dp) }
                                if (vod || zapping) TransportKey(selected = lit(Control.Forward), active = flash == "forward") { ink ->
                                    if (vod) Box(contentAlignment = Alignment.Center) { GlyphIcon(Glyph.ForwardCircle, ink, 44.dp); AppText("15", 14, ink, FontWeight.Bold) }
                                    else GlyphIcon(Glyph.ChevronRight, ink, 40.dp)
                                }
                            }
                            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(20.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                                if (vod) TransportKey(selected = lit(Control.Captions), disabled = !captionsKey) { ink -> GlyphIcon(Glyph.ClosedCaption, if (textOn) Palette.accent else ink, 38.dp) }
                                if (nextKey) TransportKey(selected = lit(Control.Next)) { ink -> GlyphIcon(Glyph.SkipNext, ink, 38.dp) }
                                previousChannel?.let { TextKey(if (it.title.length > 16) "Last: ${it.title.take(15)}..." else "Last: ${it.title}", selected = lit(Control.Last)) }
                                if (archive != null) TextKey("Catch up", selected = lit(Control.Catchup))
                            }
                        }
                        // Hidden until the remote is pressed Down onto this row.
                        if (rows.last().let { keys.selected in it }) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(48.dp, Alignment.CenterHorizontally)) {
                            if (audioOptions.size > 1) OptionKey(Glyph.Headset, "Audio", audioOptions.getOrNull(currentAudio)?.let { audioName(it.label.language, it.label.label, it.label.name) } ?: "Default", lit(Control.Audio))
                            OptionKey(Glyph.AspectRatio, "Picture", fit.label, lit(Control.Picture))
                            if (vod || timeshift) OptionKey(Glyph.Speed, "Speed", speedLabel(speed), lit(Control.Speed))
                        }
                    }
                }
            }
        }

        // The streaming apps' corner button: lit (OK presses it) while the controls are hidden.
        val upNext = next
        if (finished && upNext != null) Column(
            Modifier.align(Alignment.BottomEnd).padding(end = 96.dp, bottom = if (chrome) 330.dp else 110.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            AppText("Next: S${upNext.seasonNumber} E${upNext.episodeNumber}  ${upNext.name}", 26, Palette.foreground, FontWeight.Medium, Modifier.padding(start = 0.dp), maxLines = 1)
            NextEpisodeKey(!chrome, countdown.value)
        }

        when (panel) {
            Panel.Audio -> SidePanel("Audio", Modifier.align(Alignment.CenterEnd), "Up and down to choose, OK to play it, Back to close") {
                PanelList(audioOptions.size, audioAt, rememberLazyListState()) { index, lit ->
                    val track = audioOptions[index]
                    PanelRow(lit) { ink ->
                        AppText(audioName(track.label.language, track.label.label, track.label.name), 26, ink ?: Palette.foreground, FontWeight.Medium, Modifier.weight(1f), maxLines = 1)
                        AppText(if (index == currentAudio) "On now" else "", 24, ink ?: Palette.foreground.copy(alpha = 0.8f))
                    }
                }
            }
            Panel.Captions -> SidePanel("Captions", Modifier.align(Alignment.CenterEnd), "OK to select a track, left and right to change a setting, Back to close") {
                // The track rows (Off first), then a heading row, then the style settings; the heading is not a place the highlight can go.
                val tracksCount = captionOptions.size + 1
                PanelList(captionRows + 1, if (captionAt >= tracksCount) captionAt + 1 else captionAt, rememberLazyListState()) { index, lit ->
                    if (index < tracksCount) {
                        val name = if (index == 0) "Off" else captionOptions[index - 1].label.let { if (!it.label.isNullOrEmpty()) it.label!! else if (!it.language.isNullOrEmpty()) it.language!! else "On" }
                        PanelRow(lit) { ink ->
                            AppText(name, 26, ink ?: Palette.foreground, FontWeight.Medium, Modifier.weight(1f), maxLines = 1)
                            AppText(if (index == currentCaption) "On now" else "", 24, ink ?: Palette.foreground.copy(alpha = 0.8f))
                        }
                    } else if (index == tracksCount) PanelRow(false) { _ -> AppText("STYLE AND DEFAULT", 20, Palette.muted, FontWeight.Medium, letterSpacing = 1.5f) }
                    else {
                        val setting = CAPTION_SETTINGS[index - tracksCount - 1]
                        PanelRow(lit) { ink ->
                            AppText(setting.label, 26, ink ?: Palette.foreground, FontWeight.Medium, Modifier.weight(1f), maxLines = 1)
                            AppText(if (lit) "‹  ${settingLabel(captions, setting)}  ›" else settingLabel(captions, setting), 24, ink ?: Palette.muted, maxLines = 1)
                        }
                    }
                }
            }
            Panel.Guide -> SidePanel("Catch up", Modifier.align(Alignment.CenterEnd), "Up and down to choose, OK to play, Back to close") {
                when (val g = guide) {
                    null, GuideState.Loading -> AppText("Loading...", 22, Palette.muted)
                    GuideState.Failed -> AppText("Couldn't reach the provider. Try again in a moment.", 22, Palette.muted)
                    is GuideState.Ready -> if (g.entries.isEmpty()) AppText("Nothing to play back for this channel right now.", 22, Palette.muted)
                    else PanelList(g.entries.size, guideAt, rememberLazyListState()) { index, lit ->
                        val entry = g.entries[index]
                        PanelRow(lit) { ink ->
                            AppText(entry.day, 24, ink ?: Palette.muted, modifier = Modifier.width(160.dp))
                            AppText(entry.time, 24, ink ?: Palette.foreground.copy(alpha = 0.8f), modifier = Modifier.width(90.dp))
                            AppText(entry.programme.title, 26, ink ?: Palette.foreground, FontWeight.Medium, Modifier.weight(1f), maxLines = 1)
                        }
                    }
                }
            }
            Panel.None -> {}
        }
    }
}


