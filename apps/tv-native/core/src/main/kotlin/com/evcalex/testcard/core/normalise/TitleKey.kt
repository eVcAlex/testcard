package com.evcalex.testcard.core.normalise

import java.util.Locale

/** `splitTitle.ts`, `titleKey.ts` and `genres.ts`: film and series titles told apart, and the genre labels. */
class TitleParts(val title: String, val year: String?, val is4k: Boolean)

private val PREFIX = Regex("^([A-Z0-9][A-Z0-9+&]*(?:-[A-Z0-9+&]+)*)[$WS]+-[$WS]+")
private val YEAR = Regex("[$WS]*\\(([0-9]{4})\\)[$WS]*\\z")
private val COUNTRY = Regex("[$WS]*\\([A-Z]{2,3}\\)[$WS]*\\z")
private val RANK = Regex("^[0-9]{1,3}\\.[$WS]+")
/** JS's /[^a-z0-9À-￿]+/g works on UTF-16 units, so an astral character (a surrogate pair) is kept; Java's regex would see one code point above ￿ and drop it. */
private fun keyWords(text: String): String {
    val out = StringBuilder()
    var gap = false
    for (c in text) {
        if (c in 'a'..'z' || c in '0'..'9' || c >= 'À') {
            if (gap) out.append(' ')
            gap = false
            out.append(c)
        } else gap = true
    }
    return if (gap) out.append(' ').toString() else out.toString()
}

fun splitTitle(name: String): TitleParts {
    var rest = name.jsTrim()
    var is4k = false
    val prefix = PREFIX.find(rest)
    if (prefix != null && prefix.groupValues[1].length <= 12) {
        is4k = "4K" in prefix.groupValues[1]
        rest = rest.substring(prefix.value.length)
    }
    rest = rest.replaceFirst(COUNTRY, "")
    var year: String? = null
    val yearMatch = YEAR.find(rest)
    if (yearMatch != null) {
        year = yearMatch.groupValues[1]
        rest = rest.substring(0, yearMatch.range.first)
    }
    return TitleParts(rest.jsTrim().ifEmpty { name.jsTrim() }, year, is4k)
}

/** The leading chart rank ("42. Dune") removed, as the key and the version search both do. */
fun withoutRank(title: String): String = title.replaceFirst(RANK, "")

fun titleKey(name: String): String {
    val parts = splitTitle(name)
    val bare = withoutRank(parts.title)
    return "${keyWords(bare.lowercase(Locale.ROOT)).jsTrim()}|${parts.year ?: ""}"
}

fun isDatedTitle(name: String): Boolean = splitTitle(name).year != null

/**
 * The list with later copies of a title dropped: the first met is kept, but a 4K copy takes the place of one that is
 * not. Undated names are all kept unless [undated] is set, which is for series (a series' name is the show itself).
 */
fun <T> dedupeTitles(rows: List<T>, nameOf: (T) -> String, limit: Int = Int.MAX_VALUE, undated: Boolean = false): List<T> {
    val kept = HashMap<String, Int>() // key -> where its copy sits in `out`
    val out = ArrayList<T>()
    for (row in rows) {
        if (undated || isDatedTitle(nameOf(row))) {
            val key = titleKey(nameOf(row))
            val at = kept[key]
            if (at != null) {
                if (splitTitle(nameOf(row)).is4k && !splitTitle(nameOf(out[at])).is4k) out[at] = row
                continue
            }
            kept[key] = out.size
        }
        out += row
        if (out.size >= limit) break
    }
    return out
}

val GENRE_LABELS: Map<String, String> = mapOf(
    "sports" to "Sports",
    "kids" to "Kids & family",
    "news" to "News",
    "documentary" to "Documentary",
    "music" to "Music",
    "reality" to "Reality & lifestyle",
    "comedy" to "Comedy",
    "drama" to "Drama",
    "action" to "Action & adventure",
    "horror" to "Horror & thriller",
    "scifi" to "Sci-fi & fantasy",
    "romance" to "Romance",
    "animation" to "Animation & anime",
    "holiday" to "Holiday",
)

class GenreOption(val genre: String, val label: String, val count: Int)

/** The genres present in a list of categories, biggest first; empty unless there are at least two. */
fun genreOptions(categories: List<Pair<String?, Int>>): List<GenreOption> {
    val totals = LinkedHashMap<String, Int>()
    for ((genre, count) in categories) {
        if (genre == null || genre !in GENRE_LABELS) continue
        totals[genre] = (totals[genre] ?: 0) + count
    }
    val options = totals.map { (genre, count) -> GenreOption(genre, GENRE_LABELS.getValue(genre), count) }
        .sortedWith(compareByDescending<GenreOption> { it.count }.thenBy(java.text.Collator.getInstance(Locale.ENGLISH)) { it.label })
    return if (options.size >= 2) options else emptyList()
}
