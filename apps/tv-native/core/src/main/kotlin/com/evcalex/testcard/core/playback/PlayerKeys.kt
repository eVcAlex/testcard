package com.evcalex.testcard.core.playback

/** Seconds each skip button moves (what its icon says). */
const val SEEK_STEP_SECS = 15

/** Presses in a row (each within this of the last) reach further: 15 s, then 30 s, 1 min, 2 min (PLY-11). */
const val STREAK_WITHIN_MS = 600L

fun stepForStreak(count: Int) = if (count < 2) SEEK_STEP_SECS else if (count < 4) 30 else if (count < 7) 60 else 120

/** A held key moves the bar this often, by a step that grows the longer it is held. */
const val SCRUB_TICK_MS = 150L

fun scrubStep(ticks: Int) = if (ticks < 10) 10 else if (ticks < 25) 30 else if (ticks < 45) 60 else 120

/** Held longer than this many ticks (a minute) without the remote saying it was let go: the run is committed and stops. */
const val SCRUB_MAX_TICKS = 300

/** The chrome fades after this long without a key. */
const val CHROME_HIDES_AFTER_MS = 4_000L

/** After an episode ends, the next one starts by itself this many seconds later unless a key is pressed. */
const val AUTO_NEXT_SECS = 8

/** Remembers the last seek press, so quick presses in one direction add up. */
class SeekStreak(private val now: () -> Long) {
    private var at = 0L
    private var direction = 0
    private var count = 0

    /** The seconds this press moves, and counts it. */
    fun press(dir: Int): Int {
        val t = now()
        val streak = if (direction == dir && t - at < STREAK_WITHIN_MS) count + 1 else 0
        at = t
        direction = dir
        count = streak
        return stepForStreak(streak)
    }
}

enum class Control { Exit, Seek, Back, Play, Forward, Captions, Next, Last, Live, Catchup, Audio, Picture, Speed }

enum class RemoteKey { Up, Down, Left, Right, Select, PlayPause, Rewind, FastForward }

enum class KeyPhase {
    /** A press, acted on when released (key-down duplicates are ignored: PLY-25). */
    Release,

    /** The start of a hold (Left, Right, Rewind and Fast-forward only). */
    HoldStart,

    /** The end of a hold. */
    HoldEnd,
}

class KeyInput(val key: RemoteKey, val phase: KeyPhase = KeyPhase.Release)

enum class Panel { None, Audio, Captions, Guide }

/** What the key handler needs to know about the screen at the moment of a key. */
class KeyContext(
    val vod: Boolean,
    val timeshift: Boolean,
    val zapping: Boolean,
    val chrome: Boolean,
    val panel: Panel,
    /** The next-episode card is up. */
    val cardUp: Boolean,
    val rows: List<List<Control>>,
    val behindLive: Boolean = false,
    /** A channel was watched before this one (for Last). */
    val hasPrevious: Boolean = false,
    /** In the captions panel: the highlighted row is one of the style settings, not a track. */
    val captionOnSetting: Boolean = false,
    /** In the catch-up panel: the list has loaded. */
    val guideReady: Boolean = false,
)

sealed interface KeyAction {
    data object Wake : KeyAction
    data object Exit : KeyAction
    class Seek(val direction: Int) : KeyAction
    class Step(val direction: Int) : KeyAction
    class Zap(val direction: Int) : KeyAction
    data object ZapToPrevious : KeyAction
    class StartScrub(val direction: Int) : KeyAction
    class EndScrub(val commit: Boolean) : KeyAction
    data object CancelCountdown : KeyAction
    data object GoNext : KeyAction
    data object RemotePlayPause : KeyAction
    data object TogglePause : KeyAction
    data object OpenCaptions : KeyAction
    data object OpenAudio : KeyAction
    data object OpenGuide : KeyAction
    data object CyclePicture : KeyAction
    data object CycleSpeed : KeyAction
    data object BackToLive : KeyAction
    data object GoLive : KeyAction
    class PanelMove(val panel: Panel, val delta: Int) : KeyAction
    class PanelChoose(val panel: Panel) : KeyAction
    class PanelClose(val panel: Panel) : KeyAction

    /** A captions style setting stepped with Left, Right or Select (`direction` -1 or 1). */
    class StepSetting(val direction: Int) : KeyAction
}

/**
 * The remote's model of the player (`Player.tsx` key handler, PLY-10..14, 20): a highlight over the controls that Up and Down
 * move between rows and Left and Right along them, OK presses, with the controls hidden Left and Right skip, and on live Up and
 * Down change channel. It owns the highlight, "surfing", and the selection carried across a channel change; the screen owns
 * everything else and carries out the returned actions. It lives above the player so a channel change does not reset it.
 */
class PlayerKeys {
    var selected = Control.Play
        private set

    /** Up and Down keep changing channel (after one did) until another key is pressed. */
    var surfing = false
        private set

    /** A held key is scrubbing; the screen sets this false when a run ends by itself. */
    var scrubbing = false

    private var carriedSelection: Control? = null
    private var carriedSurfing = false

    /** A new stream is on screen: take up what the last one carried, or start on Play. */
    fun begin() {
        selected = carriedSelection ?: Control.Play
        carriedSelection = null
        surfing = carriedSurfing
        carriedSurfing = false
    }

    fun select(control: Control) { selected = control }

    fun handle(input: KeyInput, c: KeyContext): List<KeyAction> {
        val out = ArrayList<KeyAction>()
        val key = input.key
        // A held Left or Right: its start and its end are the only two events the remote sends.
        if (input.phase != KeyPhase.Release) {
            val direction = if (key == RemoteKey.Right || key == RemoteKey.FastForward) 1 else -1
            val onBar = !c.chrome || selected == Control.Seek || key == RemoteKey.Rewind || key == RemoteKey.FastForward
            if (input.phase == KeyPhase.HoldStart) {
                if (c.vod && onBar && c.panel == Panel.None) out += KeyAction.StartScrub(direction)
            } else if (scrubbing) out += KeyAction.EndScrub(true)
            return out
        }
        if (scrubbing) out += KeyAction.EndScrub(true)
        // While the next episode is on offer and the controls are hidden, OK starts it. Any other key means the viewer is doing something else.
        if (c.cardUp && c.panel == Panel.None) {
            if (!c.chrome && key == RemoteKey.Select) return out + KeyAction.GoNext
            out += KeyAction.CancelCountdown
        }
        val vertical = if (key == RemoteKey.Down) 1 else if (key == RemoteKey.Up) -1 else 0
        when (c.panel) {
            Panel.Audio -> {
                if (vertical != 0) out += KeyAction.PanelMove(Panel.Audio, vertical)
                else if (key == RemoteKey.Select) out += KeyAction.PanelChoose(Panel.Audio)
                else if (key == RemoteKey.Left) out += KeyAction.PanelClose(Panel.Audio)
                return out
            }
            Panel.Captions -> {
                if (vertical != 0) out += KeyAction.PanelMove(Panel.Captions, vertical)
                else if (c.captionOnSetting && (key == RemoteKey.Select || key == RemoteKey.Left || key == RemoteKey.Right)) out += KeyAction.StepSetting(if (key == RemoteKey.Left) -1 else 1)
                else if (key == RemoteKey.Select) out += KeyAction.PanelChoose(Panel.Captions)
                else if (key == RemoteKey.Left) out += KeyAction.PanelClose(Panel.Captions)
                return out
            }
            Panel.Guide -> {
                if (vertical != 0) out += KeyAction.PanelMove(Panel.Guide, vertical)
                else if (key == RemoteKey.Select && c.guideReady) out += KeyAction.PanelChoose(Panel.Guide)
                else if (key == RemoteKey.Left) out += KeyAction.PanelClose(Panel.Guide)
                return out
            }
            Panel.None -> {}
        }
        if (key == RemoteKey.PlayPause) return out + KeyAction.RemotePlayPause
        if (key == RemoteKey.Rewind) return out + KeyAction.Step(-1)
        if (key == RemoteKey.FastForward) return out + KeyAction.Step(1)
        // Live: up and down change channel, as on any TV, unless the viewer has stopped to use the controls.
        if (c.zapping && vertical != 0 && (!c.chrome || surfing)) {
            carriedSurfing = true
            carriedSelection = selected
            return out + KeyAction.Wake + KeyAction.Zap(vertical)
        }
        surfing = false
        if (!c.chrome) {
            // Any key brings the controls up, highlighted on Play/Pause; pausing is the play key's job. Left and right
            // skip straight away on a film or episode, as on every TV player.
            selected = Control.Play
            if (c.vod && (key == RemoteKey.Left || key == RemoteKey.Right)) return out + KeyAction.Seek(if (key == RemoteKey.Right) 1 else -1)
            return out + KeyAction.Wake
        }
        out += KeyAction.Wake
        val row = c.rows.indexOfFirst { selected in it }
        if (vertical != 0) {
            val next = c.rows[(row + vertical).coerceIn(0, c.rows.size - 1)]
            selected = if (Control.Play in next) Control.Play else next[0]
        } else if (key == RemoteKey.Left || key == RemoteKey.Right) {
            val direction = if (key == RemoteKey.Right) 1 else -1
            if (selected == Control.Seek) return out + KeyAction.Seek(direction)
            val controls = c.rows.getOrNull(row) ?: emptyList()
            val at = controls.indexOf(selected)
            controls.getOrNull((at + direction).coerceIn(0, controls.size - 1))?.let { selected = it }
        } else if (key == RemoteKey.Select) {
            out += press(selected, c)
        }
        return out
    }

    /** What pressing a control does (OK on it, or a tap). */
    fun press(control: Control, c: KeyContext): List<KeyAction> = when (control) {
        Control.Exit -> listOf(KeyAction.Exit)
        Control.Back, Control.Forward -> {
            if (c.zapping) carriedSelection = control
            listOf(KeyAction.Step(if (control == Control.Back) -1 else 1))
        }
        Control.Captions -> listOf(KeyAction.OpenCaptions)
        Control.Next -> listOf(KeyAction.GoNext)
        Control.Last -> if (c.hasPrevious) { carriedSelection = Control.Last; listOf(KeyAction.ZapToPrevious) } else emptyList()
        Control.Catchup -> listOf(KeyAction.OpenGuide)
        Control.Audio -> listOf(KeyAction.OpenAudio)
        Control.Picture -> listOf(KeyAction.CyclePicture)
        Control.Speed -> listOf(KeyAction.CycleSpeed)
        Control.Live -> listOf(if (c.timeshift) KeyAction.BackToLive else if (c.behindLive) KeyAction.GoLive else KeyAction.Wake)
        Control.Seek, Control.Play -> listOf(KeyAction.TogglePause)
    }
}

/**
 * The rows of controls the highlight moves over (PLY-10). The options row (soundtrack, picture, speed) is reached with Down
 * from the transport keys; speed only where there is a timeline to speed through.
 */
fun controlRows(vod: Boolean, timeshift: Boolean, zapping: Boolean, captionsKey: Boolean, nextKey: Boolean, last: Boolean, catchup: Boolean, audioKey: Boolean): List<List<Control>> {
    val more = listOfNotNull(if (last) Control.Last else null, if (catchup) Control.Catchup else null)
    val options = listOfNotNull(if (audioKey) Control.Audio else null, Control.Picture, if (vod || timeshift) Control.Speed else null)
    return if (vod) listOf(
        listOf(Control.Exit), listOf(Control.Seek),
        listOf(Control.Back, Control.Play, Control.Forward) + listOfNotNull(if (captionsKey) Control.Captions else null, if (nextKey) Control.Next else null), options,
    )
    else if (zapping) listOf(listOf(Control.Exit, Control.Live, Control.Back, Control.Play, Control.Forward) + more, options)
    else listOf(listOf(Control.Exit, Control.Live, Control.Play) + more, options)
}
