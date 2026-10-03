package com.evcalex.testcard.core.normalise

import java.util.Locale

/**
 * Port of `packages/core/src/normalise/displayName.ts`: a provider's channel name made readable. Display only; ids key
 * on `parseName`. Keep `DISPLAY_NAME_VERSION` equal to the TypeScript constant.
 */
const val DISPLAY_NAME_VERSION = 1

private val LETTER_OR_DIGIT = Regex("[\\p{L}\\p{N}]")
private val LEADING_NON_ALNUM = Regex("^[^\\p{L}\\p{N}(]+")
private val TRAILING_NON_ALNUM = Regex("[^\\p{L}\\p{N})\\]!?+'\"%]+\\z")
private val SPACES = Regex("[$WS]+")

fun displayName(rawName: String): String {
    var text = nfkc(unstyleOrDropTags(rawName))
    text = trimDecoration(text)
    var qualityPrefix = ""
    for (round in 0 until 3) {
        val prefix = leadingPrefix(text) ?: break
        if (QUALITY.matches(prefix.token)) qualityPrefix = prefix.token.uppercase(Locale.ROOT)
        text = trimDecoration(text.substring(prefix.length))
    }
    if (qualityPrefix != "" && !Regex("$WORD_START$qualityPrefix$WORD_END", RegexOption.IGNORE_CASE).containsMatchIn(text)) {
        text = "$text $qualityPrefix"
    }
    text = text.replace(SPACES, " ").jsTrim()
    if (!LETTER_OR_DIGIT.containsMatchIn(text)) text = unstyle(rawName).replace(SPACES, " ").jsTrim()
    return calmShouting(text)
}

/** A channel's name, less the quality or "(OFFLINE)" mark that makes it one Variant of the channel rather than another. */
fun channelDisplayName(rawName: String): String = displayName(dropVariantMarks(rawName))

// ---------------------------------------------------------------------------------------------
// styled lettering

private const val SMALL_CAP_GLYPHS = "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡʏᴢ"
private const val SMALL_CAP_LETTERS = "ABCDEFGHIJKLMNOPRSTUVWYZ"
private val SMALL_CAPS: Map<Int, Char> = SMALL_CAP_GLYPHS.withIndex().associate { (at, glyph) -> glyph.code to SMALL_CAP_LETTERS[at] }
private const val STYLED = "\\u1D00-\\u1DBF\\u2070-\\u209F\\u2C7D\\u0299\\u0262\\u029C\\u026A\\u029F\\u0274\\u0280\\u028F\\uA730\\uA731\\u02B0-\\u02B8\\u02E1-\\u02E3"
private val STYLED_RUN = Regex("[$STYLED]+(?:[$WS]+[$STYLED]+)*")

private fun unstyle(text: String): String {
    val out = StringBuilder()
    var at = 0
    while (at < text.length) {
        val codePoint = text.codePointAt(at)
        val mapped = SMALL_CAPS[codePoint]
        if (mapped != null) out.append(mapped) else out.appendCodePoint(codePoint)
        at += Character.charCount(codePoint)
    }
    return nfkc(out.toString())
}

/**
 * A name written entirely in styled letters is the name, so it is read as plain letters. In a name that also has plain
 * letters, a styled run is a tag: kept when it says something about quality, else dropped.
 */
private fun unstyleOrDropTags(rawName: String): String {
    val plain = nfkc(rawName.replace(STYLED_RUN, " ")).replace(LEADING_NON_ALNUM, "")
    val prefix = PREFIX.find(plain)
    val body = if (prefix != null && (prefix.groupValues[3] != "" || prefix.groupValues[4] != "")) plain.substring(prefix.value.length) else plain
    if (!LETTER_OR_DIGIT.containsMatchIn(body)) return unstyle(rawName)
    return rawName.replace(STYLED_RUN) { run ->
        val text = unstyle(run.value).jsTrim()
        if (QUALITY.matches(text)) " $text " else " "
    }
}

// ---------------------------------------------------------------------------------------------
// prefixes and decoration

private const val QUALITY_WORD = "(?:[0-9]*K|UHD|FHD|HDR[0-9]*|HD|SD|[0-9]{3,4}P[0-9]{0,3}|[0-9]{2,3}FPS|HEVC|H\\.?265)"
private val QUALITY = Regex("^$QUALITY_WORD(?:[$WS/+]+$QUALITY_WORD)*\\z", RegexOption.IGNORE_CASE)

private val THREE_LETTER_CODES = ("USA UAE KSA CAN AUS GER DEU ESP SPA FRA ITA POR NED NLD BEL SWE NOR DEN FIN POL TUR IND PAK ARA LAT MEX BRA " +
    "ARG IRL SCO ENG GBR EUR AFR RUS CHN JPN KOR ALB GRE").split(" ").toSet()
private val NOT_A_CODE = setOf("TV")

/** "UK: ", "[UK] ", "(UK) ", "|UK| ", "UK ● ", "USA - ", "4K| ": a code set off from the rest by a bracket or a separator. */
private val PREFIX = Regex("^([\\[(|]?)[$WS]*([A-Za-z0-9]{2,4})[$WS]*([\\])|]?)[$WS]*([|:\\-\\u2013\\u2014\\u25CF\\u2022\\u00B7\\u2605\\u2606\\u00BB\\u203A>\\u2503\\u2502~/]*)[$WS]*")

private class LeadingPrefix(val token: String, val length: Int)

private fun leadingPrefix(text: String): LeadingPrefix? {
    val match = PREFIX.find(text) ?: return null
    val open = match.groupValues[1]
    val token = match.groupValues[2]
    val close = match.groupValues[3]
    val separator = match.groupValues[4]
    if (close == "" && separator == "") return null
    if (open == "(" && close != ")") return null
    val code = token.uppercase(Locale.ROOT)
    val isCode = code.all { it in 'A'..'Z' } && (if (code.length == 2) code !in NOT_A_CODE else code in THREE_LETTER_CODES)
    if (!isCode && !QUALITY.matches(token) && code != "VIP") return null
    // Nothing after it: the "prefix" is the whole name.
    if (!LETTER_OR_DIGIT.containsMatchIn(text.substring(match.value.length))) return null
    return LeadingPrefix(token, match.value.length)
}

/** Borders, bullets, stars and emoji around a name. */
private fun trimDecoration(text: String): String = text.replace(LEADING_NON_ALNUM, "").replace(TRAILING_NON_ALNUM, "")

// ---------------------------------------------------------------------------------------------
// case

private val SHORT_WORDS = ("A AN THE AND OR OF IN ON AT TO BY FOR ONE TWO SIX TEN NEW OLD TOP ALL BIG HOT FUN BOX MAX NOW GOD LAW WAR SKY ART CAR " +
    "PET DOG CAT KID MEN WAY OUT OFF DAY RED ZEE GO MY ME WE HIS HER YES NO").split(" ").toSet()
private val ACRONYMS = "ESPN UEFA FIFA DAZN CNBC MSNBC HGTV NBCSN HEVC NASA WWE PPV UFC MUTV LFCTV BBC ITV STV RTE CNN".split(" ").toSet()
private val ASCII_WORD = Regex("[A-Za-z]+")
private val NOT_ASCII_LETTER = Regex("[^A-Za-z]")

/** A name in all capitals turned into Title Case, keeping acronyms and codes ("BBC", "4K", "TF1", "HD"). */
private fun calmShouting(text: String): String {
    val letters = text.replace(NOT_ASCII_LETTER, "")
    if (letters.length < 4 || letters != letters.uppercase(Locale.ROOT)) return text
    return text.replace(ASCII_WORD) { match ->
        val word = match.value
        val at = match.range.first
        val touchesDigit = text.getOrNull(at - 1)?.isAsciiDigit() == true || text.getOrNull(at + word.length)?.isAsciiDigit() == true
        if (touchesDigit || word in ACRONYMS || (word.length <= 3 && word !in SHORT_WORDS)) word
        else word[0] + word.substring(1).lowercase(Locale.ROOT)
    }
}

private fun Char.isAsciiDigit() = this in '0'..'9'

// ---------------------------------------------------------------------------------------------
// the same channel in another quality

private val TRAILING_QUALITY = Regex("(?:[$WS\\-|/+]*[\\[(]?$QUALITY_WORD[)\\]]?)+\\z", RegexOption.IGNORE_CASE)
private val QUALITY_4K = Regex("${WORD_START}(?:[0-9]*K|UHD|2160P?[0-9]*)$WORD_END")
private val QUALITY_SD = Regex("${WORD_START}SD$WORD_END|${WORD_START}(?:480|576)P")
private val QUALITY_HD = Regex("${WORD_START}(?:FHD|HD|1080P?[0-9]*|720P?[0-9]*)$WORD_END")

/** What a channel's display name has in common with its other qualities: "BBC One HD", "BBC One 4K" and "BBC One" all give "bbc one". */
fun sameChannelKey(displayed: String): String {
    val base = displayed.replace(TRAILING_QUALITY, "").replace(SPACES, " ").jsTrim().lowercase(Locale.ROOT)
    return if (base == "") displayed.jsTrim().lowercase(Locale.ROOT) else base
}

/** Which of a channel's qualities to try first when another has failed: HD, then unmarked, then SD, then 4K. */
fun fallbackRank(displayed: String): Int {
    val tail = TRAILING_QUALITY.find(displayed)?.value?.uppercase(Locale.ROOT) ?: ""
    if (QUALITY_4K.containsMatchIn(tail)) return 3
    if (QUALITY_SD.containsMatchIn(tail)) return 2
    if (QUALITY_HD.containsMatchIn(tail)) return 0
    return 1
}
