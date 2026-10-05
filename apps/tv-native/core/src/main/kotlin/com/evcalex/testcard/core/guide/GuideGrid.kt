package com.evcalex.testcard.core.guide

import com.evcalex.testcard.core.db.ProgrammeRow

/** One stretch of a guide row: a programme, or time the listings do not cover. `loading`: the row has no listings yet. */
class GuideSegment(val start: Long, val end: Long, val airing: Airing?, val loading: Boolean = false)

/**
 * A row's programmes cut to [from, to), with the gaps filled so every part of the row can be reached. Null airings (not
 * loaded) give one loading segment. Airings must be in start order; overlaps are trimmed to start where the last ended.
 */
fun segmentsFor(airings: List<Airing>?, from: Long, to: Long): List<GuideSegment> {
    if (airings == null) return listOf(GuideSegment(from, to, null, loading = true))
    val out = ArrayList<GuideSegment>()
    var cursor = from
    for (airing in airings) {
        if (airing.end <= cursor || airing.start >= to) continue
        if (airing.start > cursor) out += GuideSegment(cursor, airing.start, null)
        val start = maxOf(airing.start, cursor)
        val end = minOf(airing.end, to)
        out += GuideSegment(start, end, airing)
        cursor = end
    }
    if (cursor < to) out += GuideSegment(cursor, to, null)
    return out
}

/** What is on at `at` and the first programme starting after it, or null when the list has neither. */
fun nowAndNext(airings: List<Airing>, at: Long): ChannelGuide? {
    val now = airings.firstOrNull { it.start <= at && at < it.end }
    val next = airings.firstOrNull { it.start > at }
    return if (now == null && next == null) null else ChannelGuide(now, next)
}

/** Programme rows (ordered by channel then start) as each channel's airings; zero-length or inverted rows dropped. */
fun listingsByChannel(rows: List<ProgrammeRow>): Map<String, List<Airing>> =
    rows.filter { it.endAt > it.startAt }.groupBy({ it.channelId }) { Airing(it.title, it.startAt, it.endAt) }
