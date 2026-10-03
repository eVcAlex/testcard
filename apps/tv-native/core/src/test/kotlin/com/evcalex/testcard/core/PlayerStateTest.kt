package com.evcalex.testcard.core

import com.evcalex.testcard.core.playback.AUTO_NEXT_SECS
import com.evcalex.testcard.core.playback.Control
import com.evcalex.testcard.core.playback.HealthAction
import com.evcalex.testcard.core.playback.KeyAction
import com.evcalex.testcard.core.playback.KeyContext
import com.evcalex.testcard.core.playback.KeyInput
import com.evcalex.testcard.core.playback.KeyPhase
import com.evcalex.testcard.core.playback.Panel
import com.evcalex.testcard.core.playback.PlaybackHealth
import com.evcalex.testcard.core.playback.PlayerKeys
import com.evcalex.testcard.core.playback.PlayerStatus
import com.evcalex.testcard.core.playback.RemoteKey
import com.evcalex.testcard.core.playback.SeekStreak
import com.evcalex.testcard.core.playback.controlRows
import com.evcalex.testcard.core.playback.scrubStep
import com.evcalex.testcard.core.playback.stepForStreak
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** PLY-03..07, 10..14, 20: the player's two state machines, driven by key sequences and a fake clock. */
class PlayerStateTest {
    private var clock = 1_000L
    private fun health(vod: Boolean = false, timeshift: Boolean = false, moreFeeds: Boolean = false, fellBack: String? = null) = PlaybackHealth(vod, timeshift, moreFeeds, fellBack) { clock }

    @Test fun seekStreakGrowsThenResets() {
        val streak = SeekStreak { clock }
        assertEquals(listOf(15, 15, 30, 30, 60, 60, 60, 120), (0 until 8).map { streak.press(1).also { clock += 500 } })
        clock += 700
        assertEquals(15, streak.press(1))
        assertEquals(15, streak.press(-1))
        assertEquals(listOf(15, 30, 60, 120), listOf(0, 2, 4, 7).map(::stepForStreak))
        assertEquals(listOf(10, 30, 60, 120), listOf(0, 10, 25, 45).map(::scrubStep))
        assertEquals(8, AUTO_NEXT_SECS)
    }

    @Test fun stuckLiveReloadsFourTimesThenStops() {
        val h = health()
        h.onStatus(PlayerStatus.Ready)
        assertTrue(h.onStatus(PlayerStatus.Loading).isEmpty())
        clock += 11_900
        assertTrue(h.tick().isEmpty())
        clock += 200
        assertEquals(listOf(HealthAction.Reload), h.tick())
        repeat(3) { clock += 12_000; assertEquals(listOf(HealthAction.Reload), h.tick()) }
        clock += 12_000
        assertTrue(h.tick().isEmpty())
    }

    @Test fun stuckReloadDoesNotApplyToFilmsOrCatchUp() {
        for (h in listOf(health(vod = true), health(timeshift = true))) {
            h.onStatus(PlayerStatus.Ready)
            h.onStatus(PlayerStatus.Loading)
            clock += 60_000
            assertTrue(h.tick().isEmpty())
        }
    }

    @Test fun liveErrorFailsOverOnceAndNotOnTheLastFeed() {
        val h = health(moreFeeds = true)
        assertEquals(listOf(HealthAction.FailOver), h.onStatus(PlayerStatus.Error, "boom"))
        assertTrue(h.failing)
        assertTrue(h.tick().isEmpty())
        val last = health(moreFeeds = false)
        val actions = last.onStatus(PlayerStatus.Error, "UnknownHostException")
        assertFalse(last.failing)
        assertEquals(1, actions.size)
        assertEquals("UnknownHostException", (actions[0] as HealthAction.TryOtherServer).raw)
        last.serverChecked(started = true, changed = false)
        assertEquals("none", last.otherServer)
    }

    @Test fun filmCopyOnlyFailsOverIfItNeverReallyPlayed() {
        val early = health(vod = true, moreFeeds = true)
        early.onStatus(PlayerStatus.Ready)
        early.onPlaying(true)
        clock += 7_000
        assertEquals(listOf(HealthAction.FailOver), early.onStatus(PlayerStatus.Error, "x"))
        val late = health(vod = true, moreFeeds = true)
        late.onStatus(PlayerStatus.Ready)
        late.onPlaying(true)
        clock += 9_000
        assertTrue(late.onStatus(PlayerStatus.Error, "x").isEmpty())
    }

    @Test fun neverStartingFailsOverAfterFifteenSeconds() {
        val h = health(moreFeeds = true)
        h.onStatus(PlayerStatus.Loading)
        clock += 14_900
        assertTrue(h.tick().isEmpty())
        clock += 200
        assertEquals(listOf(HealthAction.FailOver), h.tick())
        assertTrue(h.tick().isEmpty())
    }

    @Test fun fellBackNoteShowsOnceForFiveSeconds() {
        val h = health(moreFeeds = true, fellBack = "Playing the 720p feed instead")
        h.onStatus(PlayerStatus.Loading)
        assertFalse(h.fellBackShown)
        h.onStatus(PlayerStatus.Ready)
        assertTrue(h.fellBackShown)
        clock += 4_900; h.tick()
        assertTrue(h.fellBackShown)
        clock += 200; h.tick()
        assertFalse(h.fellBackShown)
        h.onStatus(PlayerStatus.Loading); h.onStatus(PlayerStatus.Ready)
        assertFalse(h.fellBackShown)
    }

    @Test fun pausedLiveFallsBehindAfterTwoSeconds() {
        val h = health()
        h.onStatus(PlayerStatus.Ready)
        h.onPlaying(true)
        h.onPlaying(false)
        clock += 1_900
        h.onPlaying(true)
        assertFalse(h.behindLive)
        h.onPlaying(false)
        clock += 2_100
        h.onPlaying(true)
        assertTrue(h.behindLive)
        assertEquals(listOf(HealthAction.Reload), h.goLive())
        assertFalse(h.behindLive)
    }

    // ---- keys

    private fun key(k: RemoteKey, phase: KeyPhase = KeyPhase.Release) = KeyInput(k, phase)

    private fun ctx(
        vod: Boolean = true, zapping: Boolean = false, chrome: Boolean = true, panel: Panel = Panel.None, cardUp: Boolean = false, timeshift: Boolean = false,
        behindLive: Boolean = false, hasPrevious: Boolean = false, captionsKey: Boolean = true, nextKey: Boolean = false,
    ) = KeyContext(
        vod, timeshift, zapping, chrome, panel, cardUp, controlRows(vod, timeshift, zapping, captionsKey, nextKey, hasPrevious, false, false),
        behindLive = behindLive, hasPrevious = hasPrevious,
    )

    private fun PlayerKeys.press(k: RemoteKey, c: KeyContext) = handle(key(k), c)

    @Test fun rowsFollowTheSpec() {
        assertEquals(
            listOf(listOf(Control.Exit), listOf(Control.Seek), listOf(Control.Back, Control.Play, Control.Forward, Control.Captions, Control.Next), listOf(Control.Audio, Control.Picture, Control.Speed)),
            controlRows(vod = true, timeshift = false, zapping = false, captionsKey = true, nextKey = true, last = false, catchup = false, audioKey = true),
        )
        assertEquals(
            listOf(listOf(Control.Exit, Control.Live, Control.Back, Control.Play, Control.Forward, Control.Last, Control.Catchup), listOf(Control.Picture)),
            controlRows(vod = false, timeshift = false, zapping = true, captionsKey = false, nextKey = false, last = true, catchup = true, audioKey = false),
        )
        assertEquals(listOf(listOf(Control.Exit, Control.Live, Control.Play), listOf(Control.Picture)), controlRows(false, false, false, false, false, false, false, false))
        assertEquals(listOf(Control.Picture, Control.Speed), controlRows(false, true, false, false, false, false, false, false)[1])
    }

    @Test fun anyKeyWithControlsHiddenWakesOnPlayAndLeftRightSkipAtOnce() {
        val keys = PlayerKeys()
        keys.select(Control.Seek)
        val hidden = ctx(chrome = false)
        val seek = keys.press(RemoteKey.Right, hidden)
        assertEquals(Control.Play, keys.selected)
        assertEquals(1, (seek.single() as KeyAction.Seek).direction)
        assertTrue(keys.press(RemoteKey.Up, hidden).single() is KeyAction.Wake)
        // Live: no skipping, just waking.
        assertTrue(keys.press(RemoteKey.Left, ctx(vod = false, chrome = false)).single() is KeyAction.Wake)
    }

    @Test fun downFromTransportReachesTheOptionsRowAndBack() {
        val keys = PlayerKeys()
        val c = ctx()
        keys.press(RemoteKey.Down, c)
        assertEquals(Control.Picture, keys.selected)
        keys.press(RemoteKey.Right, c)
        assertEquals(Control.Speed, keys.selected)
        keys.press(RemoteKey.Right, c)
        assertEquals(Control.Speed, keys.selected)
        keys.press(RemoteKey.Up, c)
        assertEquals(Control.Play, keys.selected)
        keys.press(RemoteKey.Up, c)
        assertEquals(Control.Seek, keys.selected)
        assertEquals(-1, (keys.press(RemoteKey.Left, c).last() as KeyAction.Seek).direction)
        keys.press(RemoteKey.Up, c)
        assertEquals(Control.Exit, keys.selected)
        assertTrue(keys.press(RemoteKey.Select, c).last() is KeyAction.Exit)
    }

    @Test fun okOnPlayTogglesAndMediaKeysGoStraightThrough() {
        val keys = PlayerKeys()
        val c = ctx()
        assertTrue(keys.press(RemoteKey.Select, c).last() is KeyAction.TogglePause)
        assertTrue(keys.press(RemoteKey.PlayPause, c).single() is KeyAction.RemotePlayPause)
        assertEquals(-1, (keys.press(RemoteKey.Rewind, c).single() as KeyAction.Step).direction)
        assertEquals(1, (keys.press(RemoteKey.FastForward, c).single() as KeyAction.Step).direction)
    }

    @Test fun holdingLeftOnTheBarScrubsAndReleaseCommits() {
        val keys = PlayerKeys()
        keys.select(Control.Seek)
        val c = ctx()
        val start = keys.handle(key(RemoteKey.Left, KeyPhase.HoldStart), c)
        assertEquals(-1, (start.single() as KeyAction.StartScrub).direction)
        keys.scrubbing = true
        val end = keys.handle(key(RemoteKey.Left, KeyPhase.HoldEnd), c)
        assertTrue((end.single() as KeyAction.EndScrub).commit)
        // On the play key with the controls up a hold does not scrub, except the rewind key itself.
        keys.select(Control.Play)
        keys.scrubbing = false
        assertTrue(keys.handle(key(RemoteKey.Left, KeyPhase.HoldStart), c).isEmpty())
        assertEquals(1, (keys.handle(key(RemoteKey.FastForward, KeyPhase.HoldStart), c).single() as KeyAction.StartScrub).direction)
        // Hidden controls: any hold of left or right scrubs. Live never does.
        assertEquals(1, (keys.handle(key(RemoteKey.Right, KeyPhase.HoldStart), ctx(chrome = false)).single() as KeyAction.StartScrub).direction)
        assertTrue(keys.handle(key(RemoteKey.Right, KeyPhase.HoldStart), ctx(vod = false, chrome = false)).isEmpty())
    }

    @Test fun liveUpDownZapsWhenHiddenAndKeepsSurfingUntilAnotherKey() {
        val keys = PlayerKeys()
        val hidden = ctx(vod = false, zapping = true, chrome = false)
        val first = keys.press(RemoteKey.Down, hidden)
        assertEquals(1, (first.last() as KeyAction.Zap).direction)
        // The next channel mounts: it takes up the carried selection and surfing, with the controls now up.
        keys.begin()
        assertTrue(keys.surfing)
        val up = ctx(vod = false, zapping = true, chrome = true)
        assertEquals(-1, (keys.press(RemoteKey.Up, up).last() as KeyAction.Zap).direction)
        keys.begin()
        // Left ends surfing; Down then moves to the options row instead of changing channel.
        keys.press(RemoteKey.Left, up)
        assertFalse(keys.surfing)
        keys.press(RemoteKey.Down, up)
        assertEquals(Control.Picture, keys.selected)
    }

    @Test fun lastFlipsBackAndCarriesItsHighlight() {
        val keys = PlayerKeys()
        val c = ctx(vod = false, zapping = true, hasPrevious = true)
        keys.select(Control.Last)
        assertTrue(keys.press(RemoteKey.Select, c).last() is KeyAction.ZapToPrevious)
        keys.begin()
        assertEquals(Control.Last, keys.selected)
        keys.begin()
        assertEquals(Control.Play, keys.selected)
    }

    @Test fun nextEpisodeOffer() {
        val keys = PlayerKeys()
        // Hidden controls: OK starts it now.
        assertTrue(keys.press(RemoteKey.Select, ctx(chrome = false, cardUp = true)).single() is KeyAction.GoNext)
        // Any other key cancels the countdown (and still does what it does).
        val other = keys.press(RemoteKey.Down, ctx(chrome = false, cardUp = true))
        assertTrue(other[0] is KeyAction.CancelCountdown)
        assertTrue(other[1] is KeyAction.Wake)
    }

    @Test fun panelsTakeTheKeys() {
        val keys = PlayerKeys()
        val audio = ctx(panel = Panel.Audio)
        assertEquals(1, (keys.press(RemoteKey.Down, audio).single() as KeyAction.PanelMove).delta)
        assertTrue(keys.press(RemoteKey.Select, audio).single() is KeyAction.PanelChoose)
        assertTrue(keys.press(RemoteKey.Left, audio).single() is KeyAction.PanelClose)
        assertTrue(keys.press(RemoteKey.Right, audio).isEmpty())
        val captions = KeyContext(true, false, false, true, Panel.Captions, false, emptyList(), captionOnSetting = true)
        assertEquals(-1, (keys.press(RemoteKey.Left, captions).single() as KeyAction.StepSetting).direction)
        assertEquals(1, (keys.press(RemoteKey.Select, captions).single() as KeyAction.StepSetting).direction)
        val tracks = KeyContext(true, false, false, true, Panel.Captions, false, emptyList())
        assertTrue(keys.press(RemoteKey.Select, tracks).single() is KeyAction.PanelChoose)
        assertTrue(keys.press(RemoteKey.Left, tracks).single() is KeyAction.PanelClose)
        val loading = KeyContext(false, false, false, true, Panel.Guide, false, emptyList(), guideReady = false)
        assertTrue(keys.press(RemoteKey.Select, loading).isEmpty())
        assertTrue(keys.press(RemoteKey.Select, KeyContext(false, false, false, true, Panel.Guide, false, emptyList(), guideReady = true)).single() is KeyAction.PanelChoose)
    }

    @Test fun liveButtonDependsOnWhereYouAre() {
        val keys = PlayerKeys()
        assertTrue(keys.press(Control.Live, ctx(vod = false, timeshift = true)).single() is KeyAction.BackToLive)
        assertTrue(keys.press(Control.Live, ctx(vod = false, behindLive = true)).single() is KeyAction.GoLive)
        assertTrue(keys.press(Control.Live, ctx(vod = false)).single() is KeyAction.Wake)
    }
}
