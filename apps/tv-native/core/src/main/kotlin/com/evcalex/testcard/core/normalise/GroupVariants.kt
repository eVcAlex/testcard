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

private class Group(val entry: RawChannelEntry, val parsed: ParsedName, val variants: MutableList<ChannelVariant>, var tvgId: String?)

/**
 * Port of `groupVariants`: raw entries that are really one channel at different qualities become one Channel with
 * several Variants. The key is (source, category, normalised name, country) joined with NUL, as in TypeScript.
 */
fun groupVariants(entries: List<RawChannelEntry>, makeId: (String) -> String = { it }): List<Channel> {
    val groups = LinkedHashMap<String, Group>()
    for (entry in entries) {
        val parsed = parseName(entry.rawName)
        val key = listOf(entry.sourceId, entry.categoryId, parsed.normalised, parsed.country ?: "").joinToString("\u0000")
        val variant = ChannelVariant(makeId("variant:$key:${entry.providerStreamId}"), entry.sourceId, entry.providerStreamId, parsed.quality, parsed.isOffline)
        val existing = groups[key]
        if (existing != null) {
            if (existing.variants.none { it.id == variant.id }) existing.variants.add(variant)
            if ((existing.tvgId ?: "") == "" && !entry.tvgId.isNullOrEmpty()) existing.tvgId = entry.tvgId
        } else {
            groups[key] = Group(entry, parsed, mutableListOf(variant), entry.tvgId?.takeIf { it.isNotEmpty() })
        }
    }
    return groups.map { (key, group) ->
        val entry = group.entry
        Channel(
            id = makeId("channel:$key"),
            sourceId = entry.sourceId,
            categoryId = entry.categoryId,
            normalisedName = channelDisplayName(entry.rawName),
            rawName = entry.rawName,
            country = group.parsed.country,
            logoUrl = entry.logoUrl,
            channelNumber = entry.channelNumber,
            tvgId = group.tvgId,
            variants = group.variants.sortedByDescending { qualityRank(it.quality) },
            catchup = entry.catchup,
        )
    }
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
