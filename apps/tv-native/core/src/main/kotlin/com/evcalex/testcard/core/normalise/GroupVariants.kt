package com.evcalex.testcard.core.normalise

data class Catchup(val type: String, val days: Int)

/** What a source adapter hands in before quality-variant grouping. */
data class RawChannelEntry(
    val sourceId: String,
    val categoryId: String,
    val providerStreamId: String,
    val rawName: String,
    val logoUrl: String? = null,
    val channelNumber: Int? = null,
    val tvgId: String? = null,
    val catchup: Catchup? = null,
)

data class ChannelVariant(val id: String, val sourceId: String, val providerStreamId: String, val quality: String?, val isOffline: Boolean)

data class Channel(
    val id: String,
    val sourceId: String,
    val categoryId: String,
    val normalisedName: String,
    val rawName: String,
    val country: String?,
    val logoUrl: String?,
    val channelNumber: Int?,
    val tvgId: String?,
    val variants: List<ChannelVariant>,
    val catchup: Catchup?,
)

private class Listed(val entry: RawChannelEntry, val parsed: ParsedName)

private class Offline(val familyKey: String, val name: String, val listed: Listed)

/**
 * Port of `groupVariants`: one Channel per name the provider lists, so each quality ("TNT Sports 1 (1080p50)",
 * "TNT Sports 1 (720p25)") is its own Channel; entries with the very same name are Variants of one Channel. The family
 * key is (source, category, normalised name, country) joined with NUL; the family's lead (its best stream) keeps it as
 * its key, the others add NUL and their name. Must match the TypeScript exactly: ids and synced keys depend on it.
 */
fun groupVariants(entries: List<RawChannelEntry>, makeId: (String) -> String = { it }): List<Channel> {
    val families = LinkedHashMap<String, LinkedHashMap<String, MutableList<Listed>>>()
    val offline = mutableListOf<Offline>()
    for (entry in entries) {
        val parsed = parseName(entry.rawName)
        val familyKey = listOf(entry.sourceId, entry.categoryId, parsed.normalised, parsed.country ?: "").joinToString("\u0000")
        val name = dropOfflineMark(entry.rawName)
        val family = families.getOrPut(familyKey) { LinkedHashMap() }
        if (parsed.isOffline) {
            offline.add(Offline(familyKey, name, Listed(entry, parsed)))
            continue
        }
        family.getOrPut(name) { mutableListOf() }.add(Listed(entry, parsed))
    }

    // The lead of each family: the name holding its best stream, the first listed on a tie.
    val leads = HashMap<String, String>()
    for ((familyKey, family) in families) {
        var lead: String? = null
        var leadRank = Long.MIN_VALUE
        for ((name, listed) in family) {
            val rank = listed.maxOf { qualityRank(it.parsed.quality) }.toLong()
            if (rank > leadRank) {
                lead = name
                leadRank = rank
            }
        }
        if (lead != null) leads[familyKey] = lead
    }

    // An offline entry goes with the live entries of its own name, else with its family's lead, else stands alone.
    for (item in offline) {
        val family = families.getValue(item.familyKey)
        val target = if (family.containsKey(item.name)) item.name else leads[item.familyKey] ?: item.name
        val listed = family[target]
        if (listed != null) {
            listed.add(item.listed)
        } else {
            family[target] = mutableListOf(item.listed)
            if (!leads.containsKey(item.familyKey)) leads[item.familyKey] = target
        }
    }

    val channels = mutableListOf<Channel>()
    for ((familyKey, family) in families) {
        val familyTvgId = family.values.flatten().firstOrNull { !it.entry.tvgId.isNullOrEmpty() }?.entry?.tvgId
        for ((name, listed) in family) {
            val key = if (name == leads[familyKey]) familyKey else "$familyKey\u0000$name"
            val variants = mutableListOf<ChannelVariant>()
            for ((entry, parsed) in listed.map { it.entry to it.parsed }) {
                val variant = ChannelVariant(makeId("variant:$key:${entry.providerStreamId}"), entry.sourceId, entry.providerStreamId, parsed.quality, parsed.isOffline)
                if (variants.none { it.id == variant.id }) variants.add(variant)
            }
            val tvgId = listed.firstOrNull { !it.entry.tvgId.isNullOrEmpty() }?.entry?.tvgId ?: familyTvgId
            val entry = listed[0].entry
            channels.add(
                Channel(
                    id = makeId("channel:$key"),
                    sourceId = entry.sourceId,
                    categoryId = entry.categoryId,
                    normalisedName = channelDisplayName(entry.rawName),
                    rawName = entry.rawName,
                    country = listed[0].parsed.country,
                    logoUrl = entry.logoUrl,
                    channelNumber = entry.channelNumber,
                    tvgId = tvgId,
                    variants = variants.sortedByDescending { qualityRank(it.quality) },
                    catchup = entry.catchup,
                ),
            )
        }
    }
    return channels
}

private val RESOLUTION = Regex("([0-9]{3,4})p([0-9]{0,3})")
private val NAMED_QUALITY = mapOf("4k" to 2160000, "uhd" to 2160000, "fhd" to 1080000, "hd" to 720000, "sd" to 480000)

private fun qualityRank(quality: String?): Int {
    if (quality == null) return -1
    val match = RESOLUTION.find(quality)
    if (match != null) {
        val height = match.groupValues[1].toInt()
        val fps = match.groupValues[2].ifEmpty { "0" }.toInt()
        return height * 1000 + fps
    }
    return NAMED_QUALITY[quality] ?: 0
}
