package com.evcalex.testcard.core

import com.evcalex.testcard.core.guide.guideAddress
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull

class GuideAddressTest {
    @Test fun `an address set for the source wins and is not looked up`() = runBlocking {
        assertEquals("https://g.example/epg.xml", guideAddress("  https://g.example/epg.xml ") { error("not asked") })
    }

    @Test fun `a blank address uses the provider's own guide`() = runBlocking {
        assertEquals("https://own.example/g.xml.gz", guideAddress("  ") { "https://own.example/g.xml.gz" })
        assertEquals("https://own.example/g.xml.gz", guideAddress(null) { "https://own.example/g.xml.gz" })
    }

    @Test fun `no address and no own guide is none`() = runBlocking { assertNull(guideAddress(null) { null }) }
}
