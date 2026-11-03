package com.evcalex.testcard.core

import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.browseGuideChannels
import com.evcalex.testcard.core.db.guideListId
import com.evcalex.testcard.core.db.guideListLabel
import com.evcalex.testcard.core.db.listGuideCountries
import com.evcalex.testcard.core.db.parseGuideListId
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.run
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** The same cases as `tidyLists.test.ts`: the "TV Guide" lists of tidy sources. */
class TidyListsTest {
    private fun setup(): Db = runBlocking {
        val db = tempDb()
        db.write { c ->
            for ((id, tidy) in listOf("s" to 1, "t" to 0, "u" to 1)) {
                c.run("INSERT INTO sources (id, kind, name, base_url, created_at, epg_optimise) VALUES (?, 'xtream', ?, 'http://x', 1, ?)", id, id, tidy)
                c.run("INSERT INTO categories (id, source_id, provider_id, raw_name, tags) VALUES (?, ?, '1', 'X', '')", "$id:c", id)
            }
        }
        db
    }

    private fun Db.add(id: String, source: String, name: String, country: String?, listed: Boolean = true) = runBlocking {
        write { c ->
            c.run(
                "INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, country, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)",
                id, source, "$source:c", name, name, country,
            )
            if (listed) c.run("INSERT INTO programmes (channel_id, title, start_at, end_at) VALUES (?, 'Show', 1, 2)", id)
        }
    }

    private fun Db.countries(source: String? = null) = runBlocking { read { c -> c.listGuideCountries(source).map { it.country to it.count } } }
    private fun Db.ids(country: String, source: String? = null) = runBlocking { read { c -> c.browseGuideChannels(country, source).map { it.id } } }

    @Test fun `counts each station once per country, whatever quality or group it was listed under`() {
        val db = setup()
        db.add("bbc4k", "s", "BBC One 4K", "UK"); db.add("bbchd", "s", "BBC One HD", "UK"); db.add("bbc2", "s", "BBC One", "UK")
        db.add("itv", "s", "ITV1", "UK"); db.add("nbc", "s", "NBC Chicago", "US")
        assertEquals(listOf("UK" to 2, "US" to 1), db.countries())
    }

    @Test fun `shows the best quality of a station first and orders by name`() {
        val db = setup()
        db.add("bbc4k", "s", "BBC One 4K", "UK"); db.add("bbchd", "s", "BBC One HD", "UK"); db.add("itv", "s", "ITV1", "UK")
        assertEquals(listOf("bbchd", "itv"), db.ids("UK"))
    }

    @Test fun `leaves out channels with no listings, no country, another country, or a source that is not tidied`() {
        val db = setup()
        db.add("a", "s", "Alpha", "UK"); db.add("nolist", "s", "Nolist", "UK", listed = false); db.add("nocountry", "s", "Nocountry", null)
        db.add("us", "s", "Ustation", "US"); db.add("off", "t", "Offsource", "UK")
        assertEquals(listOf("a"), db.ids("UK"))
        assertEquals(listOf("UK", "US"), db.countries().map { it.first })
    }

    @Test fun `keeps a station of one source apart from the same station of another, and can be read for one source`() {
        val db = setup()
        db.add("s1", "s", "Dave", "UK"); db.add("u1", "u", "Dave", "UK")
        assertEquals(listOf("UK" to 2), db.countries())
        assertEquals(listOf("u1"), db.ids("UK", "u"))
        assertEquals(listOf("UK" to 1), db.countries("s"))
    }

    @Test fun `does not offer a channel the viewer has hidden`() {
        val db = setup()
        db.add("s:a", "s", "Alpha", "UK"); db.add("s:b", "s", "Beta", "UK")
        runBlocking { db.write { it.run("INSERT INTO hidden_channels (source_id, channel_key, label, hidden_at) VALUES ('s', 'b', 'Beta', 1)") } }
        assertEquals(listOf("s:a"), db.ids("UK"))
        assertEquals(listOf("UK" to 1), db.countries())
    }

    @Test fun `gives nothing when no source is tidied`() {
        val db = setup()
        db.add("off", "t", "Offsource", "UK")
        assertEquals(emptyList<Pair<String, Int>>(), db.countries())
    }

    @Test fun `names a list by flag and country`() {
        assertEquals("🇬🇧 TV Guide (UK)", guideListLabel("UK"))
        assertEquals("🇺🇸 TV Guide (USA)", guideListLabel("US"))
        assertEquals("🇨🇦 TV Guide (Canada)", guideListLabel("CA"))
        assertEquals("🇽🇽 TV Guide (XX)", guideListLabel("XX"))
        assertEquals("TV Guide (INT)", guideListLabel("INT"))
    }

    @Test fun `round-trips a list id, with or without a source`() {
        val plain = parseGuideListId(guideListId("UK"))!!
        assertEquals("UK", plain.country); assertNull(plain.sourceId)
        val own = parseGuideListId(guideListId("UK", "src-1"))!!
        assertEquals("UK", own.country); assertEquals("src-1", own.sourceId)
        assertNull(parseGuideListId("all")); assertNull(parseGuideListId("s:cat:UK"))
    }
}
