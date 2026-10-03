package com.evcalex.testcard.core.normalise

/** Port of `packages/core/src/normalise/parseName.ts`. Channel ids key on this, so it must not drift. */
data class ParsedName(val normalised: String, val country: String?, val quality: String?, val isOffline: Boolean)

private val STYLED_GLYPH = Regex("[\\x{1D00}-\\x{1DBF}\\x{2070}-\\x{209F}\\x{2C60}-\\x{2C7F}\\x{A700}-\\x{A7FF}]")
private val DECORATIVE_BORDER = Regex("^[#*~=\\-$WS]+|[#*~=\\-$WS]+\\z")
private val COUNTRY_PREFIX = Regex("^([A-Za-z]{2,3})[$WS]*\\|[$WS]*")
private val OFFLINE_SUFFIX = Regex("\\([$WS]*offline[$WS]*\\)", RegexOption.IGNORE_CASE)
private val QUALITY_SUFFIX = Regex("\\([$WS]*((?:[0-9]{3,4}p[0-9]{0,3})|4k|uhd|fhd|hd|sd)[$WS]*\\)", RegexOption.IGNORE_CASE)
private val EMOJI_AND_SYMBOLS = Regex("[\\x{1F300}-\\x{1FAFF}\\x{2600}-\\x{27BF}\\x{2B00}-\\x{2BFF}]")
private val TWO_OR_MORE_SPACES = Regex("[$WS]{2,}")

/** The name less its "(1080p50)"-style quality suffix and "(OFFLINE)" mark: what tells one Variant of a channel from another. */
fun dropVariantMarks(raw: String): String =
    raw.replace(OFFLINE_SUFFIX, " ").replace(QUALITY_SUFFIX, " ").replace(TWO_OR_MORE_SPACES, " ").jsTrim()

fun parseName(raw: String): ParsedName {
    var working = raw.jsTrim()

    var country: String? = null
    val countryMatch = COUNTRY_PREFIX.find(working)
    if (countryMatch != null) {
        country = countryMatch.groupValues[1].uppercase(java.util.Locale.ROOT)
        working = working.substring(countryMatch.value.length)
    }

    val isOffline = OFFLINE_SUFFIX.containsMatchIn(working)
    working = working.replace(OFFLINE_SUFFIX, "")

    var quality: String? = null
    val qualityMatch = QUALITY_SUFFIX.find(working)
    if (qualityMatch != null) {
        quality = qualityMatch.groupValues[1].lowercase(java.util.Locale.ROOT)
        working = working.replace(QUALITY_SUFFIX, "")
    }

    working = working
        .replace(STYLED_GLYPH, "")
        .replace(EMOJI_AND_SYMBOLS, "")
        .replace(DECORATIVE_BORDER, "")
        .replace(TWO_OR_MORE_SPACES, " ")
        .jsTrim()

    return ParsedName(working, country, quality, isOffline)
}
