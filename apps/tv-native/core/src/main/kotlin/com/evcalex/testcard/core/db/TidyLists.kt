package com.evcalex.testcard.core.db

import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.normalise.categoryDisplayName
import com.evcalex.testcard.core.normalise.fallbackRank
import com.evcalex.testcard.core.normalise.sameChannelKey
import java.util.Locale

/** A country that has "TV Guide" channels, and how many (one per station: its qualities and copies are counted once). */
class GuideCountry(val country: String, val count: Int)

private class Lead(val id: String, val country: String, val name: String)

private class GuideRow(val id: String, val source: String, val country: String?, val categoryCountry: String?, val rawName: String, val name: String)

/**
 * The channels of tidy sources (`sources.epg_optimise`) that really have listings, one per station and country (`tidyLists.ts`):
 * of a station's qualities and of the copies a provider files under other groups, the one to show (HD before an unmarked one, SD,
 * then 4K; the first listed on a tie). The others stay reachable as that channel's feeds. A station is not merged across
 * sources, and a channel with no known country (its own, its category's, or a "UK:" prefix of its name) is left to the provider's
 * own groups.
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
    class Held(val lead: Lead, val rank: Int)
    val best = LinkedHashMap<String, Held>()
    for (row in rows) {
        val country = channelGuideCountry(row.country, row.categoryCountry, row.rawName) ?: continue
        val key = "${row.source}\u0000$country\u0000${sameChannelKey(row.name)}"
        val rank = fallbackRank(row.name)
        val held = best[key]
        if (held == null || rank < held.rank) best[key] = Held(Lead(row.id, country, row.name), rank)
    }
    val collator = java.text.Collator.getInstance()
    return best.values.map { it.lead }.sortedWith { a, b -> collator.compare(a.name, b.name) }
}

/** The countries a tidy "TV Guide" list is offered for, the biggest first. */
fun SQLiteConnection.listGuideCountries(sourceId: String? = null): List<GuideCountry> {
    val counts = LinkedHashMap<String, Int>()
    for (lead in guideLeads(sourceId)) counts[lead.country] = (counts[lead.country] ?: 0) + 1
    return counts.map { GuideCountry(it.key, it.value) }.sortedWith(compareByDescending<GuideCountry> { it.count }.thenBy { it.country })
}

/** The channels of one country's "TV Guide" list, by name. */
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
 * [id] is `tidy:` and its categories' ids; [ppv] marks an events / pay-per-view group; [count] counts a station once.
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

private class TidyRow(val categoryId: String, val sourceId: String, val rawName: String, val country: String?, val tags: String, val channelId: String, val name: String)

private fun hasHiddenTag(tags: String) = tags.split(" ").any { it == "junk" || it == "separator" || it == "adult" }

/** The channels of tidy sources' live categories, with the category each is in; separator, junk, adult and hidden categories left out. */
private fun SQLiteConnection.tidyRows(sourceId: String?, categoryIds: Set<String>?): List<TidyRow> =
    query(
        """SELECT cat.id, cat.source_id, cat.raw_name, cat.country, cat.tags, c.id, c.normalised_name
           FROM categories cat
           JOIN sources s ON s.id = cat.source_id AND s.epg_optimise = 1
           JOIN channels c ON c.category_id = cat.id
           WHERE ${categoryShown("cat", CategoryKind.Live)} AND ${channelShown("c")}${if (sourceId != null) " AND cat.source_id = ?" else ""}
           ORDER BY cat.rowid, c.rowid""",
        *listOfNotNull(sourceId).toTypedArray(),
    ) { TidyRow(it.getText(0), it.getText(1), it.getText(2), it.textOrNull(3), it.textOrNull(4) ?: "", it.getText(5), it.getText(6)) }
        .filter { (categoryIds == null || it.categoryId in categoryIds) && !hasHiddenTag(it.tags) }

/**
 * The provider's categories of tidy sources, gathered into lists that read as one (`tidyLists.ts`): the same subject in the same country,
 * whatever its quality or source tag. Events and pay-per-view groups are kept apart. Each list counts a station once. By country (UK, USA,
 * Canada, Australia first, then the rest, then none), then name.
 */
fun SQLiteConnection.listTidyCategories(sourceId: String? = null): List<TidyCategory> {
    class Group(var label: String, val country: String?, val ppv: Boolean) { val categoryIds = LinkedHashSet<String>(); val stations = HashSet<String>() }
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
        group.stations.add(sameChannelKey(row.name))
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
        .map { TidyCategory(tidyCategoryId(it.categoryIds.toList()), it.label, it.country, it.ppv, it.stations.size) }
}

/** The channels of one tidy list: each station once (the best quality of it), by name. */
fun SQLiteConnection.browseTidyCategory(id: String, limit: Int = 5000): List<ChannelRow> {
    val categoryIds = parseTidyCategoryId(id)?.takeIf { it.isNotEmpty() } ?: return emptyList()
    class Best(val id: String, val name: String, val rank: Int)
    val best = LinkedHashMap<String, Best>()
    for (row in tidyRows(null, categoryIds.toSet())) {
        val key = "${row.sourceId}\u0000${sameChannelKey(row.name)}"
        val rank = fallbackRank(row.name)
        val held = best[key]
        if (held == null || rank < held.rank) best[key] = Best(row.channelId, row.name, rank)
    }
    val collator = java.text.Collator.getInstance()
    val ids = best.values.sortedWith { a, b -> collator.compare(a.name, b.name) }.take(limit).map { it.id }
    val byId = HashMap<String, ChannelRow>()
    for (part in ids.chunked(500)) {
        for (row in query("SELECT $CHANNEL_COLUMNS FROM channels c WHERE c.id IN (${part.joinToString(",") { "?" }})", *part.toTypedArray()) { it.channelRow() }) byId[row.id] = row
    }
    return ids.mapNotNull { byId[it] }
}
