package com.evcalex.testcard.core.text

import com.evcalex.testcard.core.normalise.WS
import com.evcalex.testcard.core.normalise.WORD_END
import com.evcalex.testcard.core.normalise.WORD_START
import com.evcalex.testcard.core.normalise.jsTrim
import com.evcalex.testcard.core.normalise.splitTitle

/** The provider's server name no longer resolves: usually a provider that moved to a new address, not a network fault. */
fun serverGone(message: String) = Regex("UnknownHost|resolve host|ENOTFOUND|No address associated", RegexOption.IGNORE_CASE).containsMatchIn(message)

/** The server name a lookup failed for, from the error. */
fun goneHost(message: String): String? =
    Regex("host[$WS]+\"([^\"]+)\"", RegexOption.IGNORE_CASE).find(message)?.groupValues?.get(1) ?: Regex("ENOTFOUND[$WS]+([^$WS]+)").find(message)?.groupValues?.get(1)

private fun capitalised(text: String) = if (text.isEmpty()) text else text[0].uppercase() + text.substring(1)

private val NETWORK = Regex("Network request failed|unreachable|ECONNREFUSED|ConnectException", RegexOption.IGNORE_CASE)
private val NO_ANSWER = Regex("did not respond|timed? ?out|ETIMEDOUT|SocketTimeout", RegexOption.IGNORE_CASE)
private val REFUSED = Regex("${WORD_START}(401|403)${WORD_END}|unauthori[sz]ed|forbidden|credentials|login|password", RegexOption.IGNORE_CASE)
private val SERVER_ERROR = Regex("${WORD_START}5[0-9][0-9]${WORD_END}")
private val FETCH_FAILED = Regex("^fetch failed:[$WS]*", RegexOption.IGNORE_CASE)
private val CLASS_NAME = Regex("${WORD_START}(?:[a-z]+\\.)+[A-Z][A-Za-z0-9_]*(?:Exception|Error):[$WS]*")
private val TRY_AGAIN = Regex("[$WS]*Try again[^.]*\\.?\\z", RegexOption.IGNORE_CASE)

/**
 * A failure in words for a person on a sofa: what the provider's or the network's error means, not a Java class name.
 * What is not recognised is passed through, tidied (`ui/plainReason.ts`).
 */
fun plainReason(message: String, who: String = "the provider"): String {
    if (serverGone(message)) {
        val host = goneHost(message)
        return "${capitalised(who)}'s server address${if (host != null) " ($host)" else ""} no longer exists. Providers sometimes move to a new one: check the address they gave you, then change it with Edit source."
    }
    if (NETWORK.containsMatchIn(message)) return "Couldn't reach $who. Its server may be down, or check the TV's internet connection."
    if (NO_ANSWER.containsMatchIn(message)) return "${capitalised(who)} didn't respond."
    if (REFUSED.containsMatchIn(message)) return "The provider turned down the login. Press Edit to check it."
    if (SERVER_ERROR.containsMatchIn(message)) return "The provider's server had a problem."
    val tidy = message.replace(FETCH_FAILED, "").replace(CLASS_NAME, "").replace(TRY_AGAIN, "").jsTrim()
    if (tidy == "") return ""
    val sentence = capitalised(tidy)
    return if (Regex("[.!?]\\z").containsMatchIn(sentence)) sentence else "$sentence."
}

private val EPISODE_SUFFIX = Regex("${WORD_START}S[0-9]{1,3}E[0-9]{1,3}[$WS]*-[$WS]*(.+)\\z", RegexOption.IGNORE_CASE)

/** "4K-OSN+ - Show (2021) (US) - S01E02 - Little Black Dress" -> "Little Black Dress". Names without the pattern are left alone. */
fun episodeTitle(name: String): String {
    val match = EPISODE_SUFFIX.find(name)?.groupValues?.get(1)
    return if (match != null && match.jsTrim() != "") match.jsTrim() else name
}

private val TRAILING_YEAR_OR_COUNTRY = Regex("([$WS]*\\((?:[0-9]{4}|[A-Z]{2,3})\\))+\\z")

/** A series' name without the provider's catalogue tag or year. */
fun seriesTitle(name: String): String = splitTitle(name).title.replace(TRAILING_YEAR_OR_COUNTRY, "").jsTrim()

private val PLAYER_EPISODE = Regex("^(.*?)[$WS]*-[$WS]*S[0-9]{1,3}E[0-9]{1,3}[$WS]*-[$WS]*(.+)\\z", RegexOption.IGNORE_CASE)

/** What the player shows for a film or episode: "Show · Episode title" for an episode, the plain title for a film. */
fun playerTitle(name: String): String {
    val match = PLAYER_EPISODE.find(name)
    if (match != null) return "${seriesTitle(match.groupValues[1])} · ${match.groupValues[2].jsTrim()}"
    return splitTitle(name).title
}

private val TMDB = Regex("^(https?://image\\.tmdb\\.org/t/p/)[^/]+(/.+)\\z")

/**
 * An artwork URL asked for at the size it is drawn at, where the host lets us choose (`ui/imageSize.ts`). `card` is a
 * poster on a row, `large` the hero and detail pages. Other hosts are left as they are.
 */
fun sized(url: String, large: Boolean): String {
    val match = TMDB.find(url) ?: return url
    return "${match.groupValues[1]}${if (large) "w780" else "w342"}${match.groupValues[2]}"
}
