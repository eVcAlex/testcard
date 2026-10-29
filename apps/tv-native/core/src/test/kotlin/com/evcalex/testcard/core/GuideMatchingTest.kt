package com.evcalex.testcard.core

import com.evcalex.testcard.core.epg.GuideMatching
import com.evcalex.testcard.core.epg.MatchableChannel
import com.evcalex.testcard.core.epg.parseXmltv
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** The matcher's part of an import, driven by the real XMLTV parser the way `importEpg` drives it (the same cases as `matchGuide.test.ts`). */
class GuideMatchingTest {
    private val channels = listOf(
        MatchableChannel("ch-good", "Dave", "UK", "Dave.uk"), // links by its own tvg-id
        MatchableChannel("ch-bbc", "UK| BBC One HD", "UK", null), // no tvg-id: needs the name
        MatchableChannel("ch-none", "Mystery", null, null), // nothing in the guide
    )

    private val xml = """<?xml version="1.0"?><tv>
<channel id="Dave.uk"><display-name>Dave</display-name></channel>
<channel id="BBCOne.uk"><display-name>BBC One</display-name><display-name>BBC 1</display-name></channel>
<programme start="20990101120000 +0000" stop="20990101130000 +0000" channel="Dave.uk"><title>Quiz</title></programme>
<programme start="20990101120000 +0000" stop="20990101130000 +0000" channel="BBCOne.uk"><title>News</title></programme>
</tv>"""

    /** The fan-out `importEpg` builds from the playlist's own tvg-ids. */
    private fun fanOut(): MutableMap<String, MutableList<String>> {
        val map = LinkedHashMap<String, MutableList<String>>()
        for (c in channels) c.tvgId?.takeIf { it.isNotEmpty() }?.let { map.getOrPut(it) { mutableListOf() }.add(c.id) }
        return map
    }

    private fun titlesByChannel(text: String, byGuideId: MutableMap<String, MutableList<String>>, matching: GuideMatching?): Map<String, List<String>> {
        val out = HashMap<String, MutableList<String>>()
        parseXmltv(text.byteInputStream(), { it in byGuideId }, matching?.let { m -> m::onChannel }, matching?.let { m -> m::onChannelsEnd }) { p ->
            for (id in byGuideId.getValue(p.channel)) out.getOrPut(id) { mutableListOf() }.add(p.title)
        }
        return out
    }

    @Test
    fun offLeavesTheImportAsItWas() {
        val got = titlesByChannel(xml, fanOut(), null)
        assertEquals(mapOf("ch-good" to listOf("Quiz")), got)
    }

    @Test
    fun onFillsTheChannelTheTvgIdMissedAndSaysHowTheChannelsFared() {
        val byGuideId = fanOut()
        val matching = GuideMatching(channels, byGuideId)
        val got = titlesByChannel(xml, byGuideId, matching)
        assertEquals(mapOf("ch-good" to listOf("Quiz"), "ch-bbc" to listOf("News")), got)
        val stats = matching.stats!!
        assertEquals(listOf(3, 1, 1, 0, 1), listOf(stats.channels, stats.exact, stats.matched, stats.ambiguous, stats.unmatched))
    }

    @Test
    fun aGuideWithNoChannelListGivesNoVerdictAndStillImports() {
        val bare = """<tv><programme start="20990101120000 +0000" stop="20990101130000 +0000" channel="Dave.uk"><title>Quiz</title></programme></tv>"""
        val byGuideId = fanOut()
        val matching = GuideMatching(channels, byGuideId)
        assertEquals(mapOf("ch-good" to listOf("Quiz")), titlesByChannel(bare, byGuideId, matching))
        assertNull(matching.stats)
    }
}
