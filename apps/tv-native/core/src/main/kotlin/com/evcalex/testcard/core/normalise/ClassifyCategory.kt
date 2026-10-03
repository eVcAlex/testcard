package com.evcalex.testcard.core.normalise

import java.util.Locale

/**
 * Port of `classifyCategory.ts`: a provider's category name turned into advisory metadata (genre, streaming brand,
 * language, tags). Deterministic and pure. Keep `CLASSIFIER_VERSION` equal to the TypeScript constant.
 */
const val CLASSIFIER_VERSION = 4

class CategoryClassification(val genre: String?, val service: String?, val language: String?, val tags: List<String>)

/** Superscript / small-cap styling glyphs to plain ASCII, so "⁴ᴷ ³⁸⁴⁰ᴾ" is readable as "4k 3840p". */
private val STYLED_TO_ASCII: Map<Char, Char> = buildMap {
    val pairs = listOf(
        "⁰0", "¹1", "²2", "³3", "⁴4", "⁵5", "⁶6", "⁷7", "⁸8", "⁹9",
        "ᴀa", "ʙb", "ᴄc", "ᴅd", "ᴇe", "ꜰf", "ɢg", "ʜh", "ɪi", "ᴊj", "ᴋk", "ʟl", "ᴍm",
        "ɴn", "ᴏo", "ᴘp", "ʀr", "ꜱs", "ᴛt", "ᴜu", "ᴠv", "ᴡw", "ʏy", "ᴢz",
        "ᴬa", "ᴮb", "ᴰd", "ᴱe", "ᴳg", "ᴴh", "ᴵi", "ᴶj", "ᴷk", "ᴸl", "ᴹm", "ᴺn", "ᴼo",
        "ᴾp", "ᴿr", "ᵀt", "ᵁu", "ᵂw", "ⱽv", "ᵃa", "ᵇb", "ᶜc", "ᵈd", "ᵉe", "ᶠf", "ᵍg",
        "ʰh", "ⁱi", "ʲj", "ᵏk", "ˡl", "ᵐm", "ⁿn", "ᵒo", "ᵖp", "ʳr", "ˢs", "ᵗt", "ᵘu",
        "ᵛv", "ʷw", "ˣx", "ʸy", "ᶻz",
    )
    for (pair in pairs) put(pair[0], pair[1])
}

private fun unstyle(text: String): String {
    val out = StringBuilder(text.length)
    for (ch in text) out.append(STYLED_TO_ASCII[ch] ?: ch)
    return out.toString()
}

private val EMOJI_BLOCKS = Regex("[\\x{1F300}-\\x{1FAFF}\\x{2600}-\\x{27BF}\\x{2B00}-\\x{2BFF}]")
private val NOT_SEARCHABLE = Regex("[^a-z0-9+]+")

/** Lowercased, unstyled, emoji-free, punctuation-flattened: the string every rule matches against. */
private fun searchable(raw: String): String =
    unstyle(raw).lowercase(Locale.ROOT).replace(EMOJI_BLOCKS, " ").replace("&", " and ").replace(NOT_SEARCHABLE, " ").jsTrim()

// language

private val LANGUAGE_PREFIX = Regex("^[$WS]*\\|?[$WS]*([A-Za-z]{2})[$WS]*(?:\\||-|:)[$WS]+")
private val LANGUAGE_CODES = setOf("en", "fr", "de", "es", "it", "pt", "nl", "ar", "tr", "pl", "ru", "hi", "ur", "fa", "el", "sv", "no", "da", "fi")

private val LANGUAGE_WORDS: List<Pair<Regex, String>> = listOf(
    Regex("\\benglish\\b") to "en",
    Regex("\\bfrench\\b") to "fr",
    Regex("\\bgerman\\b") to "de",
    Regex("\\bspanish\\b|\\blatino\\b") to "es",
    Regex("\\bitalian\\b") to "it",
    Regex("\\bportuguese\\b") to "pt",
    Regex("\\barabic\\b") to "ar",
    Regex("\\bturkish\\b") to "tr",
    Regex("\\bhindi\\b") to "hi",
)

private val MULTI = Regex("\\bmulti( subs?| language)?\\b")

private fun detectLanguage(raw: String, text: String): String? {
    val code = LANGUAGE_PREFIX.find(unstyle(raw))?.groupValues?.get(1)?.lowercase(Locale.ROOT)
    if (code != null && code in LANGUAGE_CODES) return code
    for ((pattern, lang) in LANGUAGE_WORDS) if (pattern.containsMatchIn(text)) return lang
    if (MULTI.containsMatchIn(text)) return "multi"
    return null
}

// streaming service

private val SERVICES: List<Pair<Regex, String>> = listOf(
    Regex("\\bnetflix\\b") to "netflix",
    Regex("\\bdisney\\+?") to "disney+",
    Regex("\\bamazon\\b|\\bprime\\b") to "prime",
    Regex("\\bapple\\b") to "apple",
    Regex("\\bhbo\\b") to "hbo",
    Regex("\\bparamount\\+?") to "paramount+",
    Regex("\\bpeacock\\b") to "peacock",
    Regex("\\bhulu\\b") to "hulu",
    Regex("\\bdiscovery\\+?") to "discovery+",
    Regex("\\bviaplay\\b") to "viaplay",
    Regex("\\bosn\\+?") to "osn+",
    Regex("\\bshowtime\\b") to "showtime",
    Regex("\\bdazn\\b") to "dazn",
    Regex("\\bespn\\+?") to "espn",
    Regex("\\bnickelodeon\\b") to "nickelodeon",
    Regex("\\bsky\\b") to "sky",
    Regex("\\bbbc\\b") to "bbc",
)

// genre: the rule whose keyword appears EARLIEST in the name wins; on a tie the rule listed first wins. "adult" is
// checked separately and always wins, because mislabelling adult content is the costly mistake.

/** Whole-word match over any of the `|`-separated alternatives. */
private fun words(alternatives: String): Regex = Regex("\\b(?:$alternatives)(?![a-z0-9])")

private val ADULT = words("xxx|adult(?! swim)|18\\+|erotic|porn")
private val STANDUP = words("stand.?up|comedy specials?")

private val GENRE_RULES: List<Pair<String, Regex>> = listOf(
    "holiday" to words("christmas|xmas|halloween|thanksgiving|easter|holiday"),
    "kids" to words("kids?|children|family|cartoons?|junior|toons?|cbeebies|cbbc|nick jr|nickelodeon|disney (?:channel|junior)|baby"),
    "animation" to words("anime|animi|animation|animated|manga|pixar|crunchyroll|adult swim"),
    "scifi" to words("sci fi|scifi|science fiction|fantasy|fantastic"),
    "documentary" to words("docu|documentar(?:y|ies)|docs|nature|history|science|crime|discovery(?!\\+)"),
    "news" to words("news|weather|business|politics"),
    "music" to words("music|musicals?|concerts?|radio|mtv|broadway"),
    "reality" to words("reality|lifestyle|cooking|food|home|hgtv"),
    "comedy" to words("comedy|sitcoms?"),
    "action" to words("action|adventure|martial arts|war|westerns?|james bond|007|mafia|gangster"),
    "horror" to words("horror|thriller|scary"),
    "romance" to words("romance|romantic|rom com"),
    "drama" to words("drama|dramas|telenovelas?|soaps?"),
    "sports" to words(
        "sports?|sportsnet|eurosport|fubo|deportes|football|soccer|nfl|nba|nhl|mlb|milb|mls|wnba|ufc|wwe|boxing|golf|tennis|cricket|rugby|" +
            "racing|races?|formula 1|f1|motogp|mxgp|epl|premier league|champions league|uefa|fifa|bundesliga|la liga|serie a|ligue 1|" +
            "olympics|volley ?ball|afl|nrl|ncaa|ncaaf|ncaab|college (?:football|basketball)|league|wrestling|fight|dazn|espn|tnt sports|" +
            "sky sports|bt sport|nascar|hockey|basketball|baseball|cycling|darts|snooker|pool|gaa|gaago|ahl|cfl|whl|ohl|qmjhl|nifl|spfl|" +
            "nfhs|btn|b1g|tsn|setanta|matchroom|pdc|supercross|rally|dirtvision|masters|world cup|cup|championship|fa player|" +
            "flo college|flo rugby|florugby",
    ),
)

// A leading emoji is a strong hint when the words say nothing.
private val EMOJI_GENRE: List<Pair<Regex, String>> = listOf(
    Regex("[\\u26BD\\u26BE\\x{1F3C0}-\\x{1F3CF}\\x{1F3D0}-\\x{1F3D3}\\x{1F94A}\\x{1F3DF}\\x{1F3C6}\\x{1F3BE}\\x{1F3B1}\\x{1F3D2}]") to "sports",
    Regex("[\\x{1F9F8}\\x{1F9D2}]") to "kids",
    Regex("[\\x{1F923}\\x{1F602}]") to "comedy",
    Regex("[\\x{1F3B5}\\x{1F3A4}\\x{1F3A7}\\x{1F3B8}]") to "music",
    Regex("[\\x{1F4F0}]") to "news",
)

private fun detectGenre(raw: String, text: String): String? {
    if (ADULT.containsMatchIn(text)) return "adult"
    var best: Pair<String, Int>? = null
    for ((genre, pattern) in GENRE_RULES) {
        val at = pattern.find(text)?.range?.first ?: continue
        if (best == null || at < best.second) best = genre to at
    }
    if (best != null) return best.first
    for ((pattern, genre) in EMOJI_GENRE) if (pattern.containsMatchIn(raw)) return genre
    return null
}

private val PPV = Regex("\\bppv\\b|\\bpay per view\\b")
private val K8 = Regex("\\b8k\\b")
private val K4 = Regex("\\b4k\\b|\\b2160p?\\b|\\b3840p?\\b|\\buhd\\b")
private val VIP = Regex("\\bvip\\b")
private val RAW = Regex("\\braw\\b")

private fun detectTags(text: String): MutableList<String> {
    val tags = mutableListOf<String>()
    if (PPV.containsMatchIn(text)) tags += "ppv"
    if (K8.containsMatchIn(text)) tags += "8k" else if (K4.containsMatchIn(text)) tags += "4k"
    if (VIP.containsMatchIn(text)) tags += "vip"
    if (RAW.containsMatchIn(text)) tags += "raw"
    return tags
}

/** "UK| ", "US|": the leading country code providers prefix. Not a language, and not content. */
private val COUNTRY_PREFIX = Regex("^[$WS]*[a-z]{2,3}[$WS]*\\|[$WS]*", RegexOption.IGNORE_CASE)

/** Quality/format badges that say how a category is encoded, never what it contains. */
private val BADGE_TOKENS = Regex("\\b(4k|8k|uhd|hd|fhd|sd|hdr|raw|vip|3840p?|2160p?|1080p?|720p?|50fps|60fps|hevc|dolby(?: audio| vision| atmos)?)\\b")
private val ALNUM = Regex("[a-zA-Z0-9]")
private val SPACES_AND_PLUS = Regex("[$WS+]+")

/** A category that carries no information about its content: a divider row, or nothing but quality badges. Flagged, never hidden. */
private fun structuralFlag(unstyled: String): String? {
    if (!ALNUM.containsMatchIn(unstyled)) return "separator"
    val withoutBadges = searchable(unstyled.replaceFirst(COUNTRY_PREFIX, "")).replace(BADGE_TOKENS, "").replace(SPACES_AND_PLUS, "")
    return if (withoutBadges.isEmpty()) "junk" else null
}

fun classifyCategory(rawName: String): CategoryClassification {
    val unstyled = unstyle(rawName)
    val text = searchable(unstyled.replaceFirst(COUNTRY_PREFIX, ""))
    val tags = detectTags(searchable(unstyled))

    val structural = structuralFlag(unstyled)
    if (structural != null) return CategoryClassification(null, null, null, listOf(structural) + tags)

    val isStandup = STANDUP.containsMatchIn(text)
    if (isStandup) tags += "standup"

    val detected = detectGenre(rawName, text)
    // A stand-up special also containing the word "comedy" would otherwise win the comedy rule.
    val genre = if (isStandup && detected == "comedy") null else detected
    if (genre == "adult") tags += "adult"

    val service = SERVICES.firstOrNull { (pattern, _) -> pattern.containsMatchIn(text) }?.second
    return CategoryClassification(genre, service, detectLanguage(rawName, text), tags.distinct())
}

/** Tags are stored as a single space-separated column. */
fun encodeTags(tags: List<String>): String = tags.joinToString(" ")
