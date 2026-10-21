package com.evcalex.testcard.core.playback

/*
 * The bookkeeping of live rewind's disk buffer (docs/superpowers/specs/2026-10-21-live-rewind-design.md): which bytes of the
 * stream are still held, and where in them "30 seconds ago" is. The recorder writes the files; this only counts.
 */

/** A transport stream is made of 188-byte packets; a reader must start on one. */
const val TS_PACKET_BYTES = 188

/** A buffer chunk's size: a whole number of packets, so a chunk edge is always a packet edge. */
const val CHUNK_BYTES = TS_PACKET_BYTES * 8192

private const val MARK_EVERY_MS = 1_000L

/** How many chunks the buffer may hold for [seconds] at [bytesPerSecond], cut to what [freeBytes] allows (keeping half of it free). Zero means do not buffer. */
fun capacityChunks(seconds: Int, bytesPerSecond: Long, freeBytes: Long): Int {
    if (bytesPerSecond <= 0) return 0
    val wanted = seconds * bytesPerSecond
    val allowed = Math.min(wanted, freeBytes / 2)
    return (allowed / CHUNK_BYTES).toInt()
}

class LiveBufferIndex(private val maxChunks: Int) {
    private class Mark(val atMs: Long, val offset: Long)

    private val marks = ArrayDeque<Mark>()

    /** Bytes written since the stream began; the offset the next byte will have. */
    var written = 0L
        private set

    /** The first offset still held: the buffer is the last [maxChunks] chunks, cut on a chunk edge. */
    val oldest get() = Math.max(0L, written / CHUNK_BYTES - maxChunks + 1) * CHUNK_BYTES

    fun append(bytes: Int, nowMs: Long) {
        if (marks.isEmpty() || nowMs - marks.last().atMs >= MARK_EVERY_MS) marks.addLast(Mark(nowMs, written))
        written += bytes
        val floor = oldest
        while (marks.size > 1 && marks[1].offset <= floor) marks.removeFirst()
    }

    /** Where to start reading to be [secondsBack] behind [nowMs]: on a packet edge, and never before the oldest held byte. */
    fun offsetFor(secondsBack: Int, nowMs: Long): Long {
        val target = nowMs - secondsBack * 1000L
        val mark = marks.lastOrNull { it.atMs <= target } ?: marks.firstOrNull() ?: return 0L
        val aligned = mark.offset / TS_PACKET_BYTES * TS_PACKET_BYTES
        return Math.max(aligned, oldest)
    }

    /** How far behind live a reader at [offset] is, in seconds, for the pill. */
    fun secondsBehind(offset: Long, nowMs: Long): Int {
        val mark = marks.lastOrNull { it.offset <= offset } ?: marks.firstOrNull() ?: return 0
        return Math.max(0L, (nowMs - mark.atMs) / 1000).toInt()
    }
}
