package com.evcalex.testcard.core

import com.evcalex.testcard.core.db.ProgrammeRow
import com.evcalex.testcard.core.guide.Airing
import com.evcalex.testcard.core.guide.listingsByChannel
import com.evcalex.testcard.core.guide.nowAndNext
import com.evcalex.testcard.core.guide.segmentsFor
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class GuideGridTest {
    private fun a(title: String, start: Long, end: Long) = Airing(title, start, end)

    @Test
    fun nullAiringsGiveOneLoadingSegment() {
        val s = segmentsFor(null, 0, 100)
        assertEquals(1, s.size)
        assertEquals(0L, s[0].start)
        assertEquals(100L, s[0].end)
        assertTrue(s[0].loading)
    }

    @Test
    fun gapsAreFilledAndEdgesClipped() {
        val s = segmentsFor(listOf(a("A", -50, 20), a("B", 40, 70), a("C", 90, 200)), 0, 100)
        assertEquals(listOf(0L to 20L, 20L to 40L, 40L to 70L, 70L to 90L, 90L to 100L), s.map { it.start to it.end })
        assertEquals(listOf("A", null, "B", null, "C"), s.map { it.airing?.title })
        assertTrue(s.none { it.loading })
    }

    @Test
    fun overlapsAreTrimmed() {
        val s = segmentsFor(listOf(a("A", 0, 60), a("B", 30, 90)), 0, 100)
        assertEquals(listOf(0L to 60L, 60L to 90L, 90L to 100L), s.map { it.start to it.end })
        assertEquals(listOf("A", "B", null), s.map { it.airing?.title })
    }

    @Test
    fun emptyListingsGiveOneGap() {
        val s = segmentsFor(emptyList(), 0, 100)
        assertEquals(1, s.size)
        assertNull(s[0].airing)
        assertFalse(s[0].loading)
    }

    @Test
    fun nowAndNextPicksCoveringAndFollowing() {
        val list = listOf(a("X", 0, 40), a("Y", 40, 60), a("Z", 60, 80))
        val mid = nowAndNext(list, 50)!!
        assertEquals("Y", mid.now!!.title)
        assertEquals("Z", mid.next!!.title)
        assertNull(nowAndNext(list, 100))
        val before = nowAndNext(list, -10)!!
        assertNull(before.now)
        assertEquals("X", before.next!!.title)
    }

    @Test
    fun listingsByChannelGroupsAndDrops() {
        val rows = listOf(
            ProgrammeRow("a", "One", null, 0, 10),
            ProgrammeRow("a", "Two", null, 10, 20),
            ProgrammeRow("b", "Zero", null, 5, 5),
        )
        val out = listingsByChannel(rows)
        assertEquals(setOf("a"), out.keys)
        assertEquals(listOf("One", "Two"), out.getValue("a").map { it.title })
    }
}
