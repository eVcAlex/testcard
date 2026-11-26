package com.evcalex.testcard.core.db

import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.epg.LEAGUES
import com.evcalex.testcard.core.epg.NETWORKS
import com.evcalex.testcard.core.epg.isPlaceholderChannelName
import com.evcalex.testcard.core.epg.leagueListLabel
import com.evcalex.testcard.core.epg.leaguesOf
import com.evcalex.testcard.core.epg.localListLabel
import com.evcalex.testcard.core.epg.localNetworkOf
import com.evcalex.testcard.core.normalise.categoryDisplayName
import com.evcalex.testcard.core.normalise.fallbackRank
import com.evcalex.testcard.core.normalise.sameChannelKey
import java.util.Locale

/** A country that has "TV Guide" channels, and how many (one per station: its qualities and copies are counted once). */
class GuideCountry(val country: String, val count: Int)

private class Lead(val id: String, val sourceId: String, val country: String, val name: String)

/**
 * A list's channels with each station's copies together (`inStationOrder`): all its qualities, and the copies a provider files under other
 * groups, one after another, the best quality first (HD, unmarked, SD, then 4K; the order the provider listed them on a tie), the stations by
 * name. Nothing is left out: if one copy will not play, the next row is another way into the same channel. [keyOf] tells a station, so the
 * same name in different countries or sources stays apart.
 */
private fun <T> inStationOrder(rows: List<T>, nameOf: (T) -> String, keyOf: (T) -> String): List<T> {
    val groups = LinkedHashMap<String, MutableList<T>>()
    for (row in rows) groups.getOrPut(keyOf(row)) { mutableListOf() }.add(row)
    val collator = java.text.Collator.getInstance()
    val stations = groups.values.map { group -> group.withIndex().sortedWith(compareBy({ fallbackRank(nameOf(it.value)) }, { it.index })).map { it.value } }
    return stations.sortedWith { a, b -> collator.compare(nameOf(a[0]), nameOf(b[0])) }.flatten()
}

private class GuideRow(val id: String, val source: String, val country: String?, val categoryCountry: String?, val rawName: String, val name: String)

/**
 * The channels of tidy sources (`sources.epg_optimise`) that really have listings, with a known country (its own, its category's, or a "UK:"
 * prefix of its name; the rest are left to the provider's own groups), a station's copies together ([inStationOrder]). A station is not merged
 * across sources (`tidyLists.ts`).
 */
private fun SQLiteConnection.guideLeads(sourceId: String?): List<Lead> {
    val rows = query(
        """SELECT c.id, c.source_id AS sourceId, c.country, cat.country AS categoryCountry, c.raw_name AS rawName, c.normalised_name AS name
           FROM channels c JOIN sources s ON s.id = c.source_id AND s.epg_optimise = 1
           LEFT JOIN categories cat ON cat.id = c.category_id
           WHERE ${channelShown("c")}${if (sourceId != null) " AND c.source_id = ?" else ""}
             AND EXISTS (SELECT 1 FROM programmes p WHERE p.channel_id = c.id)
           ORDER BY c.rowid""",
        *listOfNotNull(sourceId).toTypedArray(),
    ) { GuideRow(it.getText(0), it.getText(1), it.textOrNull(2), it.textOrNull(3), it.getText(4), it.getText(5)) }
    val leads = ArrayList<Lead>()
    for (row in rows) {
        val country = channelGuideCountry(row.country, row.categoryCountry, row.rawName) ?: continue
        // A network's local stations have their own lists, and an event slot with nothing on is not a station.
        if (localNetworkOf(row.rawName) != null || isPlaceholderChannelName(row.rawName)) continue
        leads += Lead(row.id, row.source, country, row.name)
    }
    return inStationOrder(leads, { it.name }) { "${it.sourceId}\u0000${it.country}\u0000${sameChannelKey(it.name)}" }
}

/** The countries a tidy "TV Guide" list is offered for, with how many channels each lists, the biggest first. */
fun SQLiteConnection.listGuideCountries(sourceId: String? = null): List<GuideCountry> {
    val counts = LinkedHashMap<String, Int>()
    for (lead in guideLeads(sourceId)) counts[lead.country] = (counts[lead.country] ?: 0) + 1
    return counts.map { GuideCountry(it.key, it.value) }.sortedWith(compareByDescending<GuideCountry> { it.count }.thenBy { it.country })
}

/** The channels of one country's "TV Guide" list: every channel with listings, a station's qualities together, by station name. */
fun SQLiteConnection.browseGuideChannels(country: String, sourceId: String? = null, limit: Int = 5000): List<ChannelRow> {
    val ids = guideLeads(sourceId).filter { it.country == country }.take(limit).map { it.id }
    val byId = HashMap<String, ChannelRow>()
    for (part in ids.chunked(500)) {
        for (row in query("SELECT $CHANNEL_COLUMNS FROM channels c WHERE c.id IN (${part.joinToString(",") { "?" }})", *part.toTypedArray()) { it.channelRow() }) byId[row.id] = row
    }
    return ids.mapNotNull { byId[it] }
}

private val COUNTRY_NAMES = mapOf(
    "US" to "USA", "UK" to "UK", "GB" to "UK", "CA" to "Canada", "AU" to "Australia", "IE" to "Ireland", "NZ" to "New Zealand", "DE" to "Germany",
    "FR" to "France", "ES" to "Spain", "IT" to "Italy", "NL" to "Netherlands", "PT" to "Portugal", "PL" to "Poland", "SE" to "Sweden",
    "NO" to "Norway", "DK" to "Denmark", "FI" to "Finland", "BE" to "Belgium", "CH" to "Switzerland", "AT" to "Austria", "GR" to "Greece",
    "TR" to "Turkey", "BR" to "Brazil", "MX" to "Mexico", "IN" to "India", "ZA" to "South Africa",
)

private val NAME_COUNTRY = Regex("^[\\s]*([A-Za-z]{2,3})[\\s]*[:|\\-][\\s]*")

/**
 * A country code the "TV Guide" lists know, in its one spelling ("GB" is "UK"), or null for anything else: a prefix such as "NBA",
 * "PRIME" or "VIP" is a league or a service, not a country, and must not become a list of its own (`guideCountryOf`).
 */
fun guideCountryOf(code: String?): String? {
    if (code == null) return null
    val upper = code.trim().uppercase(Locale.ROOT)
    val known = if (upper == "GB") "UK" else upper
    return if (known in COUNTRY_NAMES) known else null
}

/** "UK: BBC One", "US - NBC" or "CA| CTV": the country a provider put in front of a channel's name, when it is a known one. */
fun guideCountryFromName(rawName: String): String? = NAME_COUNTRY.find(rawName)?.groupValues?.get(1)?.let(::guideCountryOf)

/**
 * The country a channel's "TV Guide" list is by: its own parsed one, else its category's ("UK| SPORT"), else a prefix of its name.
 * Providers write the country in different places, and the stored `channels.country` only knows the `XX|` form.
 */
fun channelGuideCountry(channelCountry: String?, categoryCountry: String?, rawName: String): String? =
    guideCountryOf(channelCountry) ?: guideCountryOf(categoryCountry) ?: guideCountryFromName(rawName)

/** The flag of a two-letter country code ("UK" is read as GB), or nothing for anything else. */
private fun flagOf(country: String): String {
    val upper = country.uppercase(Locale.ROOT)
    val code = if (upper == "UK") "GB" else upper
    if (code.length != 2 || code.any { it !in 'A'..'Z' }) return ""
    return code.map { String(Character.toChars(0x1f1e6 + (it - 'A'))) }.joinToString("")
}

/** The name a "TV Guide" list goes by: "🇬🇧 TV Guide (UK)". A country it has no name for shows as its own code. */
fun guideListLabel(country: String): String {
    val flag = flagOf(country)
    return "${if (flag.isEmpty()) "" else "$flag "}TV Guide (${COUNTRY_NAMES[country.uppercase(Locale.ROOT)] ?: country})"
}

private const val GUIDE_PREFIX = "guide:"

/** The id of a "TV Guide" list in the Live TV rail: `guide:UK`, or `guide:UK@<source>` inside one source's section. */
fun guideListId(country: String, sourceId: String? = null): String = "$GUIDE_PREFIX$country${if (sourceId != null) "@$sourceId" else ""}"

/** A "TV Guide" list read back from its rail id. */
class GuideListRef(val country: String, val sourceId: String?)

/** Reads a rail list id back, or null when it is not a "TV Guide" list. */
fun parseGuideListId(id: String): GuideListRef? {
    if (!id.startsWith(GUIDE_PREFIX)) return null
    val rest = id.removePrefix(GUIDE_PREFIX)
    val at = rest.indexOf('@')
    return if (at < 0) GuideListRef(rest, null) else GuideListRef(rest.substring(0, at), rest.substring(at + 1))
}

/** The heading of a country's section in the Live TV rail: "🇬🇧 UK", or "Other" for a category with no known country. */
fun guideCountryHeading(country: String?): String {
    if (country == null) return "Other"
    val flag = flagOf(country)
    return "${if (flag.isEmpty()) "" else "$flag "}${COUNTRY_NAMES[country.uppercase(Locale.ROOT)] ?: country}"
}

/**
 * A group of the provider's categories that read as one ("UK| SPORT ᴴᴰ", "UK| SPORT ᴿᴬᵂ", "UK| SPORT ʰᵉᵛᶜ"): a tidy list of the rail.
 * [id] is `tidy:` and its categories' ids; [ppv] marks an events / pay-per-view group; [count] counts every channel it shows.
 */
class TidyCategory(val id: String, val label: String, val country: String?, val ppv: Boolean, val count: Int)

private const val TIDY_PREFIX = "tidy:"
private const val TIDY_SEPARATOR = '\u001f'

/** The id of a tidy list: the ids of the provider categories it gathers. */
fun tidyCategoryId(categoryIds: List<String>): String = TIDY_PREFIX + categoryIds.joinToString(TIDY_SEPARATOR.toString())

/** Reads a tidy list's id back to its categories' ids, or null when it is not one. */
fun parseTidyCategoryId(id: String): List<String>? = if (id.startsWith(TIDY_PREFIX)) id.removePrefix(TIDY_PREFIX).split(TIDY_SEPARATOR) else null

private val CATEGORY_TAIL = Regex("(?:[\\s/|+-]+(?:HD|SD|FHD|UHD|4K|8K|HEVC|H\\.?265|RAW|VIP|\\d+\\s?FPS|\\d{3,4}P))+\\s*$", RegexOption.IGNORE_CASE)
private val PPV_TAIL = Regex("[\\s/|+-]*\\bPPV\\b[\\s/|+-]*$", RegexOption.IGNORE_CASE)

/**
 * A provider category's name as its tidy list is called (`tidyCategoryLabel`): the country prefix and styling go, and so do trailing
 * quality words, so a category's HD, RAW and HEVC copies share one name; in a PPV list a trailing "PPV" goes too. Never empty.
 */
fun tidyCategoryLabel(rawName: String, ppv: Boolean): String {
    val base = categoryDisplayName(rawName).trim()
    var label = base
    while (true) {
        val next = label.replace(CATEGORY_TAIL, "").trim()
        if (next == label || next.isEmpty()) break
        label = next
    }
    if (ppv) label = label.replace(PPV_TAIL, "").trim().ifEmpty { label }
    return label.ifEmpty { base }
}

private class TidyRow(val categoryId: String, val sourceId: String, val rawName: String, val country: String?, val tags: String, val channelId: String, val channelRaw: String, val name: String)

private fun hasHiddenTag(tags: String) = tags.split(" ").any { it == "junk" || it == "separator" || it == "adult" }

/** The channels of tidy sources' live categories, with the category each is in; separator, junk, adult and hidden categories left out. */
private fun SQLiteConnection.tidyRows(sourceId: String?, categoryIds: Set<String>?): List<TidyRow> =
    query(
        """SELECT cat.id, cat.source_id, cat.raw_name, cat.country, cat.tags, c.id, c.raw_name, c.normalised_name
           FROM categories cat
           JOIN sources s ON s.id = cat.source_id AND s.epg_optimise = 1
           JOIN channels c ON c.category_id = cat.id
           WHERE ${categoryShown("cat", CategoryKind.Live)} AND ${channelShown("c")}${if (sourceId != null) " AND cat.source_id = ?" else ""}
           ORDER BY cat.rowid, c.rowid""",
        *listOfNotNull(sourceId).toTypedArray(),
    ) { TidyRow(it.getText(0), it.getText(1), it.getText(2), it.textOrNull(3), it.textOrNull(4) ?: "", it.getText(5), it.getText(6), it.getText(7)) }
        .filter { (categoryIds == null || it.categoryId in categoryIds) && !hasHiddenTag(it.tags) && !isPlaceholderChannelName(it.channelRaw) }

/**
 * The provider's categories of tidy sources, gathered into lists that read as one (`tidyLists.ts`): the same subject in the same country,
 * whatever its quality or source tag. Events and pay-per-view groups are kept apart. Each list counts every channel it shows. By country (UK, USA,
 * Canada, Australia first, then the rest, then none), then name.
 */
fun SQLiteConnection.listTidyCategories(sourceId: String? = null): List<TidyCategory> {
    class Group(var label: String, val country: String?, val ppv: Boolean) { val categoryIds = LinkedHashSet<String>(); var count = 0 }
    val groups = LinkedHashMap<String, Group>()
    for (row in tidyRows(sourceId, null)) {
        val ppv = row.tags.split(" ").contains("ppv")
        val country = guideCountryOf(row.country)
        val label = tidyCategoryLabel(row.rawName, ppv)
        val key = "${row.sourceId}\u0000${country ?: ""}\u0000${if (ppv) 1 else 0}\u0000${label.lowercase(Locale.ROOT)}"
        val group = groups.getOrPut(key) { Group(label, country, ppv) }
        // Of the spellings of one name, the one that is not all capitals reads better.
        if (label.any { it in 'a'..'z' } && group.label.none { it in 'a'..'z' }) group.label = label
        group.categoryIds.add(row.categoryId)
        group.count += 1
    }
    fun rank(country: String?): Int {
        val at = listOf("UK", "US", "CA", "AU", "IE", "NZ").indexOf(country ?: "")
        return if (country == null) 99 else if (at < 0) 50 else at
    }
    val collator = java.text.Collator.getInstance()
    return groups.values
        .sortedWith(
            compareBy<Group> { rank(it.country) }.thenBy { it.country ?: "" }.thenBy { if (it.ppv) 1 else 0 }.thenComparator { a, b -> collator.compare(a.label, b.label) },
        )
        .map { TidyCategory(tidyCategoryId(it.categoryIds.toList()), it.label, it.country, it.ppv, it.count) }
}

/** The channels of one tidy list: every channel of its categories, a station's qualities together, the best first, by station name. */
fun SQLiteConnection.browseTidyCategory(id: String, limit: Int = 5000): List<ChannelRow> {
    val categoryIds = parseTidyCategoryId(id)?.takeIf { it.isNotEmpty() } ?: return emptyList()
    class Entry(val id: String, val sourceId: String, val name: String)
    val rows = tidyRows(null, categoryIds.toSet()).map { Entry(it.channelId, it.sourceId, it.name) }
    val ids = inStationOrder(rows, { it.name }) { "${it.sourceId}\u0000${sameChannelKey(it.name)}" }.take(limit).map { it.id }
    val byId = HashMap<String, ChannelRow>()
    for (part in ids.chunked(500)) {
        for (row in query("SELECT $CHANNEL_COLUMNS FROM channels c WHERE c.id IN (${part.joinToString(",") { "?" }})", *part.toTypedArray()) { it.channelRow() }) byId[row.id] = row
    }
    return ids.mapNotNull { byId[it] }
}

/**
 * A list the rail builds from what channel names say: the channels of one league, or one network's local stations (`FacetList`).
 * [id] is `league:<key>` or `local:<key>`, with `@<source>` inside one source's section; [count] counts every channel in it.
 */
class FacetList(val id: String, val label: String, val kind: String, val count: Int)

/** The rail sections these lists sit in. */
const val SPORTS_SECTION = "Sports"
const val LOCAL_SECTION = "Local stations"

/** The id of a league or local-stations list in the Live TV rail. */
fun facetListId(kind: String, key: String, sourceId: String? = null): String = "$kind:$key${if (sourceId != null) "@$sourceId" else ""}"

/** A league or local-stations list read back from its rail id. */
class FacetListRef(val kind: String, val key: String, val sourceId: String?)

/** Reads a league or local-stations list's id back, or null when it is not one. */
fun parseFacetListId(id: String): FacetListRef? {
    val match = Regex("^(league|local):([^@]+)(?:@(.+))?$", RegexOption.DOT_MATCHES_ALL).find(id) ?: return null
    return FacetListRef(match.groupValues[1], match.groupValues[2], match.groupValues[3].ifEmpty { null })
}

private class FacetRow(val channelId: String, val sourceId: String, val rawName: String, val name: String, val country: String?, val categoryRaw: String)

/** The channels of tidy sources' live categories that are stations (not dividers or empty event slots), for the league and local lists. */
private fun SQLiteConnection.facetRows(sourceId: String?): List<FacetRow> {
    class Raw(val channelId: String, val sourceId: String, val rawName: String, val name: String, val country: String?, val categoryCountry: String?, val categoryRaw: String, val tags: String)
    return query(
        """SELECT c.id, c.source_id, c.raw_name, c.normalised_name, c.country, cat.country, cat.raw_name, cat.tags
           FROM channels c
           JOIN sources s ON s.id = c.source_id AND s.epg_optimise = 1
           JOIN categories cat ON cat.id = c.category_id
           WHERE ${channelShown("c")} AND ${categoryShown("cat", CategoryKind.Live)}${if (sourceId != null) " AND c.source_id = ?" else ""}
           ORDER BY c.rowid""",
        *listOfNotNull(sourceId).toTypedArray(),
    ) { Raw(it.getText(0), it.getText(1), it.getText(2), it.getText(3), it.textOrNull(4), it.textOrNull(5), it.getText(6), it.textOrNull(7) ?: "") }
        .filter { !hasHiddenTag(it.tags) && !isPlaceholderChannelName(it.rawName) }
        .map { FacetRow(it.channelId, it.sourceId, it.rawName, it.name, channelGuideCountry(it.country, it.categoryCountry, it.rawName), it.categoryRaw) }
}

private fun stationKey(row: FacetRow) = "${row.sourceId}\u0000${row.country ?: ""}\u0000${sameChannelKey(row.name)}"

/** A list needs this many channels to be worth showing: a stray match is not a list. */
private const val FACET_LIST_LEAST = 3

/**
 * The league lists ("🏈 NFL") and local-station lists ("📺 NBC local stations") of tidy sources (`tidyLists.ts`), from what channel names say,
 * for any provider. A list counts every channel in it, a station's qualities and copies included. Leagues come first in the order of
 * [LEAGUES], then networks in the order of [NETWORKS]; one with fewer than three channels is left out.
 */
fun SQLiteConnection.listFacetLists(sourceId: String? = null): List<FacetList> {
    val leagues = HashMap<String, Int>()
    val locals = HashMap<String, Int>()
    for (row in facetRows(sourceId)) {
        for (league in leaguesOf("${row.rawName} ${row.categoryRaw}")) leagues[league] = (leagues[league] ?: 0) + 1
        localNetworkOf(row.rawName)?.let { locals[it] = (locals[it] ?: 0) + 1 }
    }
    val out = ArrayList<FacetList>()
    for (league in LEAGUES) {
        val count = leagues[league.key] ?: 0
        if (count >= FACET_LIST_LEAST) out += FacetList(facetListId("league", league.key, sourceId), leagueListLabel(league), "league", count)
    }
    for (network in NETWORKS) {
        val count = locals[network.key] ?: 0
        if (count >= FACET_LIST_LEAST) out += FacetList(facetListId("local", network.key, sourceId), localListLabel(network), "local", count)
    }
    return out
}

/** The channels of one league or local-stations list: every channel in it, a station's qualities together, the best first, by station name. */
fun SQLiteConnection.browseFacetList(id: String, sourceId: String? = null, limit: Int = 5000): List<ChannelRow> {
    val parsed = parseFacetListId(id) ?: return emptyList()
    val rows = facetRows(parsed.sourceId ?: sourceId).filter { row ->
        if (parsed.kind == "league") parsed.key in leaguesOf("${row.rawName} ${row.categoryRaw}") else localNetworkOf(row.rawName) == parsed.key
    }
    val ids = inStationOrder(rows, { it.name }, ::stationKey).take(limit).map { it.channelId }
    val byId = HashMap<String, ChannelRow>()
    for (part in ids.chunked(500)) {
        for (row in query("SELECT $CHANNEL_COLUMNS FROM channels c WHERE c.id IN (${part.joinToString(",") { "?" }})", *part.toTypedArray()) { it.channelRow() }) byId[row.id] = row
    }
    return ids.mapNotNull { byId[it] }
}
