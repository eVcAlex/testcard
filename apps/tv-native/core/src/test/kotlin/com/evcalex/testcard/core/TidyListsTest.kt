package com.evcalex.testcard.core

import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.browseGuideChannels
import com.evcalex.testcard.core.db.channelGuideCountry
import com.evcalex.testcard.core.db.guideCountryFromName
import com.evcalex.testcard.core.db.guideCountryOf
import com.evcalex.testcard.core.db.browseFacetList
import com.evcalex.testcard.core.db.browseTidyCategory
import com.evcalex.testcard.core.db.facetListId
import com.evcalex.testcard.core.db.listFacetLists
import com.evcalex.testcard.core.db.parseFacetListId
import com.evcalex.testcard.core.db.guideCountryHeading
import com.evcalex.testcard.core.db.guideListId
import com.evcalex.testcard.core.db.guideListLabel
import com.evcalex.testcard.core.db.listGuideCountries
import com.evcalex.testcard.core.db.listTidyCategories
import com.evcalex.testcard.core.db.parseTidyCategoryId
import com.evcalex.testcard.core.db.tidyCategoryId
import com.evcalex.testcard.core.db.tidyCategoryLabel
import com.evcalex.testcard.core.normalise.channelDisplayName
import com.evcalex.testcard.core.normalise.classifyCategory
import com.evcalex.testcard.core.normalise.encodeTags
import com.evcalex.testcard.core.normalise.parseName
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

    @Test fun `reads the country from the channel's category when the channel has none`() {
        val db = setup()
        runBlocking { db.write { it.run("UPDATE categories SET country = 'UK' WHERE id = 's:c'") } }
        db.add("a", "s", "Alpha", null)
        assertEquals(listOf("UK" to 1), db.countries())
    }

    @Test fun `reads a UK colon prefix of the name, which the stored country does not know`() {
        val db = setup()
        db.add("a", "s", "UK: Alpha", null); db.add("b", "s", "US - Beta", null); db.add("c", "s", "CA| Gamma", null)
        assertEquals(listOf("CA", "UK", "US"), db.countries().map { it.first }.sorted())
    }

    @Test fun `does not make a list of a league or service prefix, and reads GB as UK`() {
        val db = setup()
        db.add("a", "s", "NBA: Lakers", null); db.add("b", "s", "PRIME: Movie Channel", "PRIME"); db.add("c", "s", "Gamma", "GB"); db.add("d", "s", "Delta", "UK")
        assertEquals(listOf("UK" to 2), db.countries())
    }

    @Test fun `knows what a country code is, and takes the channel's own before its category's before its name`() {
        assertEquals("UK", guideCountryOf("gb")); assertNull(guideCountryOf("NHL")); assertNull(guideCountryOf(null))
        assertEquals("US", guideCountryFromName("US: NBC 5")); assertNull(guideCountryFromName("4K: Sky Primafila")); assertNull(guideCountryFromName("TV: Funniest Videos"))
        assertEquals("CA", channelGuideCountry("CA", "UK", "US: X")); assertEquals("UK", channelGuideCountry(null, "UK", "US: X")); assertEquals("US", channelGuideCountry("NHL", null, "US: X"))
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

    // ---- tidy categories (the same cases as `tidyLists.test.ts`)

    private var categoryCount = 0

    private fun Db.addCategory(source: String, raw: String, names: List<String>): String {
        val id = "$source:cat${++categoryCount}"
        runBlocking {
            write { c ->
                c.run("INSERT INTO categories (id, source_id, provider_id, raw_name, country, tags) VALUES (?, ?, ?, ?, ?, ?)", id, source, categoryCount.toString(), raw, parseName(raw).country, encodeTags(classifyCategory(raw).tags))
                names.forEachIndexed { at, name ->
                    c.run("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, country, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, NULL, 1, 1)", "$id:c$at", source, id, name, name)
                }
            }
        }
        return id
    }

    private fun Db.tidy() = runBlocking { read { c -> c.listTidyCategories() } }

    @Test fun `gathers the quality and source copies of a category into one list, counting a station once`() {
        val db = setup()
        val hd = db.addCategory("s", "UK| SPORT ᴴᴰ", listOf("Sky Sports Main Event HD", "TNT Sports 1 HD"))
        val raw = db.addCategory("s", "UK| SPORT ᴿᴬᵂ ⁶⁰ᶠᵖˢ", listOf("Sky Sports Main Event", "Eurosport 1"))
        val hevc = db.addCategory("s", "UK| SPORT ʰᵉᵛᶜ", listOf("Sky Sports Main Event 4K"))
        val lists = db.tidy()
        assertEquals(1, lists.size)
        assertEquals(listOf("Sport", "UK", false, 3), listOf(lists[0].label, lists[0].country, lists[0].ppv, lists[0].count))
        assertEquals(listOf(hd, raw, hevc).sorted(), parseTidyCategoryId(lists[0].id)!!.sorted())
    }

    @Test fun `keeps events apart, drops the PPV word from their name, and leaves out junk, separators and tidying-off sources`() {
        val db = setup()
        db.addCategory("s", "UK| DAZN PPV", listOf("DAZN 1")); db.addCategory("s", "UK| GENERAL ᴴᴰ/ᴿᴬᵂ", listOf("BBC One HD"))
        db.addCategory("s", "4K| ᵁᴴᴰ ³⁸⁴⁰ᴾ", listOf("Junk row")); db.addCategory("t", "UK| NEWS", listOf("Not tidied"))
        assertEquals(listOf(listOf("General", "UK", false), listOf("DAZN", "UK", true)), db.tidy().map { listOf(it.label, it.country, it.ppv) })
    }

    @Test fun `orders by country, then events last, then name`() {
        val db = setup()
        for (raw in listOf("BEE| DAZN PPV", "DE| NEWS", "US| NEWS", "UK| NEWS", "UK| KIDS", "UK| ESPN PPV")) db.addCategory("s", raw, listOf("X"))
        assertEquals(
            listOf("UK Kids", "UK News", "UK ESPN (ppv)", "US News", "DE News", "- BEE| DAZN (ppv)"),
            db.tidy().map { "${it.country ?: "-"} ${it.label}${if (it.ppv) " (ppv)" else ""}" },
        )
    }

    @Test fun `reads a lists channels once each per station, the best quality first, by name`() {
        val db = setup()
        db.addCategory("s", "UK| NEWS ᴴᴰ", listOf("BBC News 4K", "Sky News HD")); db.addCategory("s", "UK| NEWS ᴿᴬᵂ", listOf("BBC News HD", "GB News"))
        val list = db.tidy().single()
        assertEquals(listOf("BBC News HD", "GB News", "Sky News HD"), runBlocking { db.read { c -> c.browseTidyCategory(list.id).map { it.normalisedName } } })
        assertEquals(3, list.count)
    }

    @Test fun `reads nothing from an id that is not a tidy list`() {
        val db = setup()
        assertEquals(0, runBlocking { db.read { c -> c.browseTidyCategory("all").size } })
    }

    @Test fun `does not offer a hidden category or channel`() {
        val db = setup()
        val news = db.addCategory("s", "UK| NEWS", listOf("A", "B")); db.addCategory("s", "UK| KIDS", listOf("C"))
        runBlocking { db.write { it.run("INSERT INTO hidden_channels (source_id, channel_key, label, hidden_at) VALUES ('s', ?, 'A', 1)", "${news.substring(2)}:c0") } }
        assertEquals(listOf(listOf("Kids", 1), listOf("News", 1)), db.tidy().map { listOf(it.label, it.count) })
        runBlocking { db.write { it.run("INSERT INTO hidden_categories (source_id, kind, category_key, label, hidden_at) VALUES ('s', 'live', '2', 'Kids', 1)") } }
        assertEquals(listOf("News"), db.tidy().map { it.label })
    }

    @Test fun `drops the quality and source words a provider hangs on a category, and the PPV word in an events list`() {
        assertEquals("Sport", tidyCategoryLabel("UK| SPORT ᴴᴰ", false)); assertEquals("Sport", tidyCategoryLabel("UK| SPORT ᴿᴬᵂ ⁶⁰ᶠᵖˢ", false))
        assertEquals("sport", tidyCategoryLabel("UK| SPORT ʰᵉᵛᶜ", false).lowercase())
        assertEquals("EPL Premier League", tidyCategoryLabel("UK| EPL PREMIER LEAGUE PPV ⱽᴵᴾ", true)); assertEquals("DAZN PPV", tidyCategoryLabel("UK| DAZN PPV", false))
        assertEquals(false, tidyCategoryLabel("UK| 4K", false).isEmpty())
    }

    @Test fun `names a countrys section, and round-trips a tidy lists id`() {
        assertEquals("\uD83C\uDDEC\uD83C\uDDE7 UK", guideCountryHeading("UK")); assertEquals("\uD83C\uDDFA\uD83C\uDDF8 USA", guideCountryHeading("US")); assertEquals("Other", guideCountryHeading(null))
        assertEquals(listOf("s:1", "s:2"), parseTidyCategoryId(tidyCategoryId(listOf("s:1", "s:2")))); assertNull(parseTidyCategoryId("guide:UK"))
    }

    // ---- league and local-station lists (the same cases as `tidyLists.test.ts`)

    private fun Db.addRaw(source: String, categoryRaw: String, raws: List<String>): String {
        val id = "$source:cat${++categoryCount}"
        runBlocking {
            write { c ->
                c.run("INSERT INTO categories (id, source_id, provider_id, raw_name, country, tags) VALUES (?, ?, ?, ?, ?, ?)", id, source, categoryCount.toString(), categoryRaw, parseName(categoryRaw).country, encodeTags(classifyCategory(categoryRaw).tags))
                raws.forEachIndexed { at, raw ->
                    c.run("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, country, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, NULL, 1, 1)", "$id:c$at", source, id, channelDisplayName(raw), raw)
                }
            }
        }
        return id
    }

    private fun Db.facets() = runBlocking { read { c -> c.listFacetLists().map { Triple(it.id, it.label, it.count) } } }
    private fun Db.facet(id: String) = runBlocking { read { c -> c.browseFacetList(id).map { it.rawName } } }

    @Test fun `gathers a leagues channels from any category, each station once, and leaves out lists of fewer than three`() {
        val db = setup()
        db.addRaw("s", "US| SPORT", listOf("US: NFL GAME PASS ᴿᴬᵂ", "US: NFL REDZONE", "US: NFL GAME PASS HD", "US: ESPN"))
        db.addRaw("s", "US| FOX", listOf("Sunday Night Football [NBC]")); db.addRaw("s", "US| NBA PPV", listOf("US: NBA TV"))
        assertEquals(listOf(Triple("league:nfl", "🏈 NFL", 3)), db.facets())
        assertEquals(listOf("US: NFL GAME PASS HD", "US: NFL REDZONE", "Sunday Night Football [NBC]"), db.facet("league:nfl"))
    }

    @Test fun `takes a league from its categorys name when the channels own does not say`() {
        val db = setup()
        db.addRaw("s", "US| NHL TEAM PPV", listOf("Boston Bruins", "Toronto Maple Leafs", "Montreal Canadiens"))
        assertEquals(listOf("league:nhl" to 3), db.facets().map { it.first to it.third })
    }

    @Test fun `gathers a networks local stations from any category, and not its national services`() {
        val db = setup()
        db.addRaw("s", "US| NBC", listOf("US: NBC 5 (WMAQ) CHICAGO", "US: NBC 4 (WCMH) COLUMBUS OH", "US: NBC SPORTS NETWORK"))
        db.addRaw("s", "US| NEWS", listOf("NBC [Boston] 1080p", "US: FOX NEWS CHANNEL"))
        assertEquals(listOf(Triple("local:nbc", "📺 NBC local stations", 3)), db.facets())
        assertEquals(listOf("NBC [Boston] 1080p", "US: NBC 4 (WCMH) COLUMBUS OH", "US: NBC 5 (WMAQ) CHICAGO"), db.facet("local:nbc"))
    }

    @Test fun `leaves out placeholders, dividers, and a source that is not tidied, and keeps a station of another country apart`() {
        val db = setup()
        db.addRaw("s", "US| NHL PPV", listOf("NHL 01: No Game Today", "##### NHL #####", "US: NHL NETWORK", "US: NHL CENTER ICE"))
        db.addRaw("s", "UK| NHL PPV", listOf("UK: NHL NETWORK"))
        db.addRaw("t", "US| NHL PPV", listOf("US: NHL ALTERNATE 1", "US: NHL ALTERNATE 2", "US: NHL ALTERNATE 3"))
        assertEquals(listOf("league:nhl" to 3), db.facets().map { it.first to it.third })
    }

    @Test fun `keeps local stations out of the TV Guide list, which is for national channels`() {
        val db = setup()
        runBlocking { db.write { it.run("INSERT INTO categories (id, source_id, provider_id, raw_name, country) VALUES ('s:x', 's', 'x', 'US| NEWS', 'US')") } }
        for ((id, raw) in listOf("cnn" to "US: CNN", "nbc5" to "US: NBC 5 (WMAQ) CHICAGO", "nhl" to "NHL 01: No Game Today")) {
            runBlocking {
                db.write { c ->
                    c.run("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, country, first_seen_at, last_seen_at) VALUES (?, 's', 's:x', ?, ?, 'US', 1, 1)", id, channelDisplayName(raw), raw)
                    c.run("INSERT INTO programmes (channel_id, title, start_at, end_at) VALUES (?, 'Show', 1, 2)", id)
                }
            }
        }
        assertEquals(listOf("cnn"), db.ids("US"))
    }

    @Test fun `does not list an empty event slot in a countrys tidy list`() {
        val db = setup()
        db.addRaw("s", "US| NHL PPV", listOf("NHL 01: No Game Today", "US: NHL NETWORK"))
        assertEquals(listOf(listOf("NHL", 1)), db.tidy().map { listOf(it.label, it.count) })
    }

    @Test fun `reads nothing from an id that is not a league or local list, and round-trips the ids`() {
        val db = setup()
        assertEquals(emptyList<String>(), db.facet("guide:UK"))
        val plain = parseFacetListId(facetListId("league", "nfl"))!!
        assertEquals(listOf("league", "nfl"), listOf(plain.kind, plain.key)); assertNull(plain.sourceId)
        val own = parseFacetListId(facetListId("local", "nbc", "src-1"))!!
        assertEquals(listOf("local", "nbc", "src-1"), listOf(own.kind, own.key, own.sourceId)); assertNull(parseFacetListId("tidy:a"))
    }
}
