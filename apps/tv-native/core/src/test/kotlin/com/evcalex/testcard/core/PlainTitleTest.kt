package com.evcalex.testcard.core

import com.evcalex.testcard.core.text.plainTitle
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** Programme titles on the TV carry no emoji or pictograms, as on the desktop. */
class PlainTitleTest {
    @Test fun dividerArrowsAndStarsGoAndSpacesAreTidied() {
        assertEquals("", plainTitle("⬇️ ⬇️ ⬇️"))
        assertEquals("National Networks", plainTitle("⬇️ National Networks ⬇️"))
        assertEquals("Match of the Day", plainTitle("⚽ Match of the Day 🏆"))
        assertEquals("News at Ten", plainTitle("★ News  at   Ten ★"))
    }

    @Test fun ordinaryTitlesAreUntouched() {
        assertEquals("Shrek the Third", plainTitle("Shrek the Third"))
        assertEquals("Naruto: Shippuden (S2 E4) - épisode", plainTitle("Naruto: Shippuden (S2 E4) - épisode"))
        assertEquals("NFL on 5 - London Game", plainTitle("NFL on 5 - London Game"))
    }
}
