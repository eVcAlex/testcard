package com.evcalex.testcard.core.epg

import com.evcalex.testcard.core.normalise.WS
import com.evcalex.testcard.core.normalise.jsTrim
import java.io.BufferedInputStream
import java.io.InputStream
import java.util.Locale
import java.util.zip.GZIPInputStream
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserException
import org.xmlpull.v1.XmlPullParserFactory

/** One `<programme>` of an XMLTV document, for a channel the caller asked for. Times are unix ms. */
class XmltvProgramme(val channel: String, val title: String, val startMs: Long, val endMs: Long, val description: String?)

private val XMLTV_DATE = Regex("^([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})[$WS]*([+-][0-9]{4})?\\z")

private fun isLeap(year: Int) = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)

private fun daysInMonth(year: Int, month: Int) = when (month) {
    1, 3, 5, 7, 8, 10, 12 -> 31
    4, 6, 9, 11 -> 30
    else -> if (isLeap(year)) 29 else 28
}

/** Days since 1970-01-01 of a civil date (Howard Hinnant's algorithm): no java.time, which Android only has from API 26. */
private fun daysFromCivil(year: Int, month: Int, day: Int): Long {
    val y = if (month <= 2) year - 1 else year
    val era = Math.floorDiv(y, 400)
    val yoe = y - era * 400
    val doy = (153 * (month + (if (month > 2) -3 else 9)) + 2) / 5 + day - 1
    val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era.toLong() * 146097 + doe - 719468
}

/** XMLTV dates look like "20260905183000 +0000"; no offset means UTC. Null for anything else, or an impossible date. */
fun parseXmltvDate(raw: String): Long? {
    val match = XMLTV_DATE.find(raw.jsTrim()) ?: return null
    val (year, month, day, hour, minute, second) = match.groupValues.drop(1).take(6).map { it.toInt() }
    if (month !in 1..12 || day !in 1..daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return null
    var offsetMinutes = 0
    val offset = match.groupValues[7]
    if (offset.isNotEmpty()) {
        val hours = offset.substring(1, 3).toInt()
        val minutes = offset.substring(3, 5).toInt()
        if (hours > 23 || minutes > 59) return null
        offsetMinutes = (if (offset[0] == '-') -1 else 1) * (hours * 60 + minutes)
    }
    return (((daysFromCivil(year, month, day) * 24 + hour) * 60 + minute - offsetMinutes) * 60 + second) * 1000
}

private operator fun <T> List<T>.component6(): T = this[5]

/** A gzipped body is recognised by its first bytes: a `.gz` URL whose server already undid the compression arrives plain. */
fun openMaybeGzipped(input: InputStream): InputStream {
    val buffered = if (input is BufferedInputStream) input else BufferedInputStream(input, 64 * 1024)
    buffered.mark(2)
    val first = buffered.read()
    val second = buffered.read()
    buffered.reset()
    return if (first == 0x1f && second == 0x8b) GZIPInputStream(buffered, 64 * 1024) else buffered
}

private fun XmlPullParser.attribute(name: String): String? {
    for (index in 0 until attributeCount) if (getAttributeName(index).lowercase(Locale.ROOT) == name) return getAttributeValue(index)
    return null
}

/**
 * Streaming XMLTV parser (`parseXmltv.ts`): gunzip and a pull parser, so a multi-tens-of-MB guide is never buffered whole
 * or turned into a DOM. `wanted` says which guide channel ids to report. Guides are often not quite XML (a bare "&" in a
 * title), so the parser runs relaxed; a fault is carried past where it can be, and only a body that gave nothing at all
 * (an HTML error page, say) fails.
 *
 * Like the TypeScript, the text of every `<title>` and `<desc>` of a programme is joined, trimmed piece by piece.
 */
fun parseXmltv(input: InputStream, wanted: (String) -> Boolean, onProgramme: (XmltvProgramme) -> Unit) {
    val parser = XmlPullParserFactory.newInstance().newPullParser()
    runCatching { parser.setFeature("http://xmlpull.org/v1/doc/features.html#relaxed", true) }
    parser.setInput(openMaybeGzipped(input), "UTF-8")

    var channel: String? = null
    var start: Long? = null
    var stop: Long? = null
    var title = StringBuilder()
    var description = StringBuilder()
    var inTitle = false
    var inDesc = false
    var yielded = 0
    var parseError: Exception? = null
    try {
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> when (parser.name.lowercase(Locale.ROOT)) {
                    "programme" -> {
                        channel = parser.attribute("channel") ?: ""
                        start = parseXmltvDate(parser.attribute("start") ?: "")
                        stop = parseXmltvDate(parser.attribute("stop") ?: "")
                        title = StringBuilder()
                        description = StringBuilder()
                    }
                    "title" -> inTitle = true
                    "desc" -> inDesc = true
                }
                XmlPullParser.TEXT -> {
                    val text = parser.text.jsTrim()
                    if (text.isNotEmpty()) {
                        if (inTitle) title.append(text)
                        if (inDesc) description.append(text)
                    }
                }
                XmlPullParser.END_TAG -> when (parser.name.lowercase(Locale.ROOT)) {
                    "title" -> inTitle = false
                    "desc" -> inDesc = false
                    "programme" -> {
                        val id = channel
                        if (id != null && wanted(id) && start != null && stop != null && title.isNotEmpty()) {
                            yielded += 1
                            onProgramme(XmltvProgramme(id, title.toString(), start, stop, description.toString().ifEmpty { null }))
                        }
                        channel = null
                        start = null
                        stop = null
                    }
                }
            }
            event = parser.next()
        }
    } catch (error: XmlPullParserException) {
        parseError = error
    }
    if (parseError != null && yielded == 0) throw parseError
}
