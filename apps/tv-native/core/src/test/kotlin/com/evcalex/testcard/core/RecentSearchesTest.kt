package com.evcalex.testcard.core

import com.evcalex.testcard.core.playback.MAX_RECENT_SEARCHES
import com.evcalex.testcard.core.playback.withRecentSearch
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class RecentSearchesTest {
    @Test fun newestFirst() = assertEquals(listOf("sky", "bbc"), withRecentSearch(listOf("bbc"), "sky"))

    @Test fun repeatMovesUpInsteadOfDuplicating() = assertEquals(listOf("BBC", "sky"), withRecentSearch(listOf("sky", "bbc"), " BBC "))

    @Test fun tooShortIsIgnored() = assertEquals(listOf("bbc"), withRecentSearch(listOf("bbc"), "b"))

    @Test fun cappedAtTheLimit() {
        val full = (1..MAX_RECENT_SEARCHES).map { "term$it" }
        val next = withRecentSearch(full, "fresh")
        assertEquals(MAX_RECENT_SEARCHES, next.size)
        assertEquals("fresh", next.first())
    }
}
