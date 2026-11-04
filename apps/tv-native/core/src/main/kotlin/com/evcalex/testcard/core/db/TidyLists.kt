package com.evcalex.testcard.core.db

import androidx.sqlite.SQLiteConnection
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
