package com.evcalex.testcard.core

import com.evcalex.testcard.core.db.ChannelFeed
import com.evcalex.testcard.core.playback.MAX_TILES
import com.evcalex.testcard.core.playback.MultiLayout
import com.evcalex.testcard.core.playback.TileAction
import com.evcalex.testcard.core.playback.TileGovernor
import com.evcalex.testcard.core.playback.TileWish
import com.evcalex.testcard.core.playback.deviceTileCap
import com.evcalex.testcard.core.playback.freeStreams
import com.evcalex.testcard.core.playback.layoutsFor
import com.evcalex.testcard.core.playback.pickFeed
import com.evcalex.testcard.core.playback.planTiles
import com.evcalex.testcard.core.playback.qualityHeight
import com.evcalex.testcard.core.playback.softerFeed
import com.evcalex.testcard.core.playback.startLayout
import com.evcalex.testcard.core.playback.targetHeight
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** MV-01..: what multi view shows, at what quality, and what it gives up when the line or the account cannot carry it. */
class MultiViewTest {
    private var clock = 1_000L

    @Test fun everyLayoutFitsTheScreenAndNoTilesOverlap() {
        for (layout in MultiLayout.entries) {
            for ((i, a) in layout.slots.withIndex()) {
                assertTrue(a.x >= 0f && a.y >= 0f && a.x + a.w <= 1.0001f && a.y + a.h <= 1.0001f, "${layout.id} slot $i leaves the screen")
                // 16:9 tile on a 16:9 screen: equal fractions, so the picture fills it.
                assertEquals(a.w, a.h, 0.0001f, "${layout.id} slot $i is not 16:9")
                for ((j, b) in layout.slots.withIndex()) {
                    if (j <= i || layout == MultiLayout.Inset) continue
                    val apart = a.x + a.w <= b.x + 0.0001f || b.x + b.w <= a.x + 0.0001f || a.y + a.h <= b.y + 0.0001f || b.y + b.h <= a.y + 0.0001f
                    assertTrue(apart, "${layout.id} slots $i and $j overlap")
                }
            }
        }
    }

    @Test fun layoutsOfferedNeverNeedMoreThanTheDeviceCarries() {
        assertEquals(listOf(MultiLayout.SideBySide, MultiLayout.Inset), layoutsFor(2))
        assertTrue(layoutsFor(4).all { it.slots.size <= 4 })
        assertTrue(MultiLayout.Quad in layoutsFor(4))
        assertTrue(MultiLayout.Spotlight4 !in layoutsFor(3))
        assertTrue(MultiLayout.Spotlight3 in layoutsFor(3))
        assertEquals(MultiLayout.entries.toSet(), layoutsFor(MAX_TILES).toSet())
        assertTrue(MultiLayout.entries.all { it.slots.size <= MAX_TILES })
    }

    @Test fun startsInTheSmallestLayoutThatHoldsEveryChannel() {
        assertEquals(MultiLayout.SideBySide, startLayout(2, 4, null))
        assertEquals(MultiLayout.Spotlight3, startLayout(3, 4, null))
        assertEquals(MultiLayout.Quad, startLayout(4, 4, null))
        assertEquals(MultiLayout.Quad, startLayout(4, 4, MultiLayout.Quad))
        // A remembered layout is used only when it holds them all and is allowed.
        assertEquals(MultiLayout.Quad, startLayout(2, 4, MultiLayout.Quad))
        assertEquals(MultiLayout.SideBySide, startLayout(2, 2, MultiLayout.Quad))
        assertEquals(MultiLayout.Quad, startLayout(5, 4, null))
    }

    @Test fun deviceCapFollowsMemoryAndTheDecoder() {
        assertEquals(2, deviceTileCap(800, 16))
        assertEquals(3, deviceTileCap(1000, 16))
        assertEquals(4, deviceTileCap(2048, 16))
        assertEquals(4, deviceTileCap(4096, 16))
        assertEquals(2, deviceTileCap(4096, 2))
        assertEquals(1, deviceTileCap(4096, 0))
        assertEquals(4, deviceTileCap(2048, null))
    }

    @Test fun accountsCapTheirOwnStreamsAndOnlyTheirs() {
        val wished = listOf(TileWish("a", "s1"), TileWish("b", "s1"), TileWish("c", "s1"), TileWish("d", "s2"), TileWish("e", "m3u"))
        val plan = planTiles(wished, 6) { if (it == "s1") 2 else if (it == "s2") 1 else null }
        assertEquals(listOf("a", "b", "d", "e"), plan.kept.map { it.channelId })
        assertEquals(listOf("c"), plan.left.map { it.channelId })
        assertTrue(plan.note!!.startsWith("Your provider only allows"))
    }

    @Test fun theMainChannelAlwaysKeepsItsPlace() {
        val plan = planTiles(listOf(TileWish("a", "s"), TileWish("b", "s"), TileWish("c", "s")), 2) { null }
        assertEquals(listOf("a", "b"), plan.kept.map { it.channelId })
        assertTrue(plan.note!!.startsWith("This device carries 2"))
    }

    @Test fun theSameChannelTwiceIsOnePicture() {
        val plan = planTiles(listOf(TileWish("a", "s"), TileWish("a", "s")), 4) { null }
        assertEquals(1, plan.kept.size)
        assertNull(plan.note)
    }

    @Test fun anAccountWithNothingFreeShowsNothingFromIt() {
        val plan = planTiles(listOf(TileWish("a", "s")), 4) { 0 }
        assertTrue(plan.kept.isEmpty())
        assertNotNull(plan.note)
    }

    @Test fun freeStreamsCountOtherDevices() {
        assertEquals(1, freeStreams(2, 1))
        assertEquals(0, freeStreams(1, 3))
        assertEquals(3, freeStreams(3, null))
        assertNull(freeStreams(null, 1))
    }

    @Test fun qualityLabelsReadAsHeights() {
        assertEquals(1080, qualityHeight("1080p50"))
        assertEquals(720, qualityHeight("720p25"))
        assertEquals(2160, qualityHeight("4K"))
        assertEquals(2160, qualityHeight("UHD"))
        assertEquals(1080, qualityHeight("FHD"))
        assertEquals(720, qualityHeight("HD"))
        assertEquals(480, qualityHeight("SD"))
        assertNull(qualityHeight("RAW"))
        assertNull(qualityHeight(null))
    }

    @Test fun tilesAskForWhatTheirSizeCanShow() {
        assertEquals(1080, targetHeight(1f))
        assertEquals(810, targetHeight(.5f))
        assertEquals(607, targetHeight(.375f))
        assertEquals(480, targetHeight(.25f))
    }

    private fun feeds(vararg q: String?) = q.mapIndexed { i, quality -> ChannelFeed("ch", "v$i", "Channel", quality) } + ChannelFeed("other", "o", "Other", "480p")

    @Test fun smallTilesTakeTheSoftVariantAndBigOnesTheSharpOne() {
        val f = feeds("4K", "1080p50", "720p25", "576p")
        assertEquals("1080p50", pickFeed(f, "ch", 1080)?.quality)
        assertEquals("720p25", pickFeed(f, "ch", 810)?.quality)
        assertEquals("576p", pickFeed(f, "ch", 600)?.quality)
        // Nothing small enough: the softest there is, not the sharpest.
        assertEquals("576p", pickFeed(feeds("4K", "1080p50", "576p"), "ch", 480)?.quality)
        assertEquals("1080p50", pickFeed(feeds("4K", "1080p50"), "ch", 480)?.quality)
    }

    @Test fun anotherChannelsFeedIsNeverPickedForThisOne() {
        assertEquals("ch", pickFeed(feeds("720p25"), "ch", 1080)?.channelId)
        assertNull(pickFeed(feeds(null, null), "ch", 1080))
    }

    @Test fun softerFeedStepsDownOnce() {
        val f = feeds("1080p50", "720p25", "576p")
        assertEquals("720p25", softerFeed(f, "ch", f[0])?.quality)
        assertEquals("576p", softerFeed(f, "ch", f[1])?.quality)
        assertNull(softerFeed(f, "ch", f[2]))
        // From the default (no feed picked yet), the sharpest is assumed.
        assertEquals("720p25", softerFeed(f, "ch", null)?.quality)
    }

    private fun governor() = TileGovernor { clock }
    private val priority = mapOf(0 to 0, 1 to 1, 2 to 2, 3 to 3)

    @Test fun oneStallIsForgivenAndTwoLowerTheQuality() {
        val g = governor()
        assertNull(g.onStall(1, priority, hasSofter = true, audioSlot = 0))
        clock += 5_000
        val action = g.onStall(1, priority, hasSofter = true, audioSlot = 0)
        assertTrue(action is TileAction.Downshift && action.slot == 1)
    }

    @Test fun stallsFarApartAreForgotten() {
        val g = governor()
        g.onStall(1, priority, true, 0)
        clock += 31_000
        assertNull(g.onStall(1, priority, true, 0))
    }

    @Test fun aLoneStallingTileWithNothingSofterIsAskedForAgain() {
        val g = governor()
        g.onStall(2, priority, false, 0)
        clock += 1_000
        val action = g.onStall(2, priority, false, 0)
        assertTrue(action is TileAction.Reload && action.slot == 2)
    }

    @Test fun whenSeveralTilesStallTheLeastImportantOneIsPausedNotTheOneWithSound() {
        val g = governor()
        g.onStall(0, priority, false, 0)
        g.onStall(3, priority, false, 0)
        clock += 1_000
        g.onStall(1, priority, false, 0)
        clock += 1_000
        val action = g.onStall(0, priority, false, 0)
        assertTrue(action is TileAction.Pause && action.slot == 3, "paused $action")
    }
}
