package com.evcalex.testcard.core.playback

import com.evcalex.testcard.core.nowMs as clockNowMs
import com.evcalex.testcard.core.xtream.CatchupProgramme
import com.evcalex.testcard.core.xtream.CatchupSplit
import java.util.Calendar
import java.util.TimeZone

fun two(n: Int) = n.toString().padStart(2, '0')

/** "1:02:03" / "2:03" from seconds. */
fun clock(seconds: Double): String {
    val total = Math.max(0, Math.floor(if (seconds.isFinite()) seconds else 0.0).toLong())
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "$h:${two(m.toInt())}:${two(s.toInt())}" else "$m:${two(s.toInt())}"
}

/** "13:00" from epoch ms, in the given zone (the device's by default). */
fun clock24(ms: Long, zone: TimeZone = TimeZone.getDefault()): String {
    val c = Calendar.getInstance(zone).apply { timeInMillis = ms }
    return "${two(c.get(Calendar.HOUR_OF_DAY))}:${two(c.get(Calendar.MINUTE))}"
}

/** One line of the Catch up list: what to call the day, the start time and the programme. */
class CatchupEntry(val programme: CatchupProgramme, val day: String, val time: String)

private val DAYS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

private fun dayStart(c: Calendar): Long = (c.clone() as Calendar).apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis

private fun dayLabel(date: Calendar, now: Calendar): String {
    val days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000.0).toInt()
    return if (days == 0) "Today" else if (days == 1) "Yesterday" else DAYS[date.get(Calendar.DAY_OF_WEEK) - 1]
}

/** What is on now (to start over) comes first, then the past programmes, newest first. */
fun catchupEntries(guide: CatchupSplit, nowMs: Long = clockNowMs(), zone: TimeZone = TimeZone.getDefault()): List<CatchupEntry> {
    val now = Calendar.getInstance(zone).apply { timeInMillis = nowMs }
    fun entry(programme: CatchupProgramme, label: String? = null): CatchupEntry {
        val start = Calendar.getInstance(zone).apply { timeInMillis = programme.startMs }
        return CatchupEntry(programme, label ?: dayLabel(start, now), clock24(programme.startMs, zone))
    }
    val past = guide.past.map { entry(it) }
    val current = guide.current
    return if (current == null) past else listOf(entry(current, "Start over")) + past
}
