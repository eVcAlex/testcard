package com.evcalex.testcard.core.epg

import com.evcalex.testcard.core.normalise.WS
import com.evcalex.testcard.core.normalise.channelDisplayName
import com.evcalex.testcard.core.normalise.sameChannelKey
import java.text.Normalizer
import java.util.Locale

/** One channel the guide describes: XMLTV's `<channel id>` and its `<display-name>`s. */
class GuideChannel(val id: String, val names: List<String>)

/** The part of a channel the matcher needs. [country] is the parsed `XX|` prefix; [tvgId] the playlist's own, possibly empty or unknown to the guide. */
class MatchableChannel(val id: String, val rawName: String, val country: String?, val tvgId: String?)

class GuideMatch(val guideId: String, val method: String)

class GuideMatchStats(
    val channels: Int,
    /** Already linked by their own `tvg-id`: left alone. */
    val exact: Int,
    /** Linked by the matcher. */
    val matched: Int,
    /** More than one guide channel fits and nothing tells them apart: left unlinked rather than guessed. */
    val ambiguous: Int,
    /** No guide channel fits. */
    val unmatched: Int,
)

class GuideMatchResult(val matches: Map<String, GuideMatch>, val stats: GuideMatchStats)

private val COMBINING_MARKS = Regex("[\\u0300-\\u036f]")
private val PLUS_NUMBER = Regex("\\+[$WS]*([0-9])")
private val NOT_ALNUM = Regex("[^a-z0-9]+")

/**
 * A name reduced to what two spellings of one channel share (`guideKey` in `matchGuide.ts`): quality words and styling gone
 * by the same cleaning channel variants use, then lower case letters and digits only, "&" read as "and", "+1" kept apart from "1".
 */
fun guideKey(name: String): String {
    val base = sameChannelKey(channelDisplayName(name))
    return Normalizer.normalize(base, Normalizer.Form.NFKD)
        .replace(COMBINING_MARKS, "")
        .replace("&", " and ")
        .replace(PLUS_NUMBER) { " plus${it.groupValues[1]} " }
        .lowercase(Locale.ROOT)
        .replace(NOT_ALNUM, "")
}

private val MARKET_SUFFIX = Regex("[.\\-_]([a-z]{2})\\z", RegexOption.IGNORE_CASE)

/** Guide ids often end in the market: "BBCOne.uk", "CNN.us". `gb` is read as `uk`. */
private fun marketOf(guideId: String): String? {
    val suffix = MARKET_SUFFIX.find(guideId)?.groupValues?.get(1)?.lowercase(Locale.ROOT) ?: return null
    return if (suffix == "gb") "uk" else suffix
}

private fun countryOf(country: String?): String? {
    val lower = country?.lowercase(Locale.ROOT) ?: return null
    return if (lower == "gb") "uk" else lower
}

/**
 * Finds a guide channel for every playlist channel whose own `tvg-id` does not link to the guide (`matchGuide.ts`; the two
 * must agree on `test-vectors/guideMatch.json`). Conservative on purpose, because a wrong guide is worse than none: a channel
 * with a working `tvg-id` is never touched; otherwise only a curated alias, or a name that matches exactly once cleaned.
 * Several fits are told apart by the channel's country against the guide id's market; if that cannot, the channel is counted
 * as ambiguous and left unlinked. Nothing here changes a channel: the result says which guide id to read its listings from.
 */
fun matchGuide(channels: List<MatchableChannel>, guide: List<GuideChannel>, aliases: Map<String, String> = emptyMap()): GuideMatchResult {
    val guideIds = guide.mapTo(HashSet()) { it.id }
    val byKey = HashMap<String, LinkedHashSet<String>>()
    for (entry in guide) for (name in entry.names) {
        val key = guideKey(name)
        if (key.isEmpty()) continue
        byKey.getOrPut(key) { LinkedHashSet() }.add(entry.id)
    }

    val matches = LinkedHashMap<String, GuideMatch>()
    var exact = 0
    var ambiguous = 0
    var unmatched = 0

    for (channel in channels) {
        val own = channel.tvgId
        if (own != null && own.isNotEmpty() && own in guideIds) {
            exact += 1
            continue
        }
        val key = guideKey(channel.rawName)
        if (key.isEmpty()) {
            unmatched += 1
            continue
        }
        val alias = aliases[key]
        if (alias != null && alias in guideIds) {
            matches[channel.id] = GuideMatch(alias, "alias")
            continue
        }
        val found = byKey[key]
        if (found == null) {
            unmatched += 1
            continue
        }
        var candidates = found.toList()
        if (candidates.size > 1) {
            val country = countryOf(channel.country)
            if (country != null) {
                val sameMarket = candidates.filter { marketOf(it) == country }
                // A guide id with no market suffix is not ruled out; one for another market is.
                candidates = if (sameMarket.isNotEmpty()) sameMarket else candidates.filter { marketOf(it) == null }
            }
        }
        // Every fit was for another market: as good as no fit.
        if (candidates.isEmpty()) {
            unmatched += 1
            continue
        }
        if (candidates.size > 1) {
            ambiguous += 1
            continue
        }
        matches[channel.id] = GuideMatch(candidates[0], "name")
    }
    return GuideMatchResult(matches, GuideMatchStats(channels.size, exact, matches.size, ambiguous, unmatched))
}

/**
 * The matcher's part of an import: collects the guide's channel list as the parser reads it, and when the first programme is
 * reached (XMLTV lists its channels first) links the playlist's unlinked channels into [byGuideId], the same map the programmes
 * are fanned out through. A guide that names no channels gives nothing to match against and no verdict ([stats] stays null);
 * a failure leaves the map as it was, so the guide is read as if matching were off (`importEpg.ts`).
 */
class GuideMatching(private val channels: List<MatchableChannel>, private val byGuideId: MutableMap<String, MutableList<String>>) {
    private val declared = ArrayList<GuideChannel>()

    /** How the channels fared; set when the channel list ends, null if the guide named none. */
    var stats: GuideMatchStats? = null
        private set

    fun onChannel(guideId: String, names: List<String>) {
        declared.add(GuideChannel(guideId, names))
    }

    fun onChannelsEnd() {
        if (declared.isEmpty()) return
        runCatching {
            val result = matchGuide(channels, declared)
            for ((channelId, match) in result.matches) byGuideId.getOrPut(match.guideId) { mutableListOf() }.add(channelId)
            stats = result.stats
        }
    }
}
