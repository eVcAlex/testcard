package com.evcalex.testcard.core

import com.evcalex.testcard.core.playback.CHUNK_BYTES
import com.evcalex.testcard.core.playback.LiveBufferIndex
import com.evcalex.testcard.core.playback.TS_PACKET_BYTES
import com.evcalex.testcard.core.playback.capacityChunks
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class LiveBufferTest {
    /** A stream of [seconds] seconds at one packet block per second-ish, [bytesPerSecond] each. */
    private fun fill(index: LiveBufferIndex, seconds: Int, bytesPerSecond: Int) {
        for (s in 0 until seconds) index.append(bytesPerSecond, s * 1000L)
    }

    @Test fun nothingWrittenReadsFromTheStart() = assertEquals(0L, LiveBufferIndex(4).offsetFor(30, 100_000))

    @Test fun rewindingFindsTheByteWrittenThatManySecondsAgo() {
        val index = LiveBufferIndex(1000)
        fill(index, 100, TS_PACKET_BYTES * 100)
        // Now is second 100; thirty seconds back is the start of second 70.
        assertEquals(70L * TS_PACKET_BYTES * 100, index.offsetFor(30, 100_000))
    }

    @Test fun offsetsLandOnAPacketEdge() {
        val index = LiveBufferIndex(1000)
        fill(index, 10, 1000) // 1000 is not a multiple of 188
        assertEquals(0L, index.offsetFor(5, 10_000) % TS_PACKET_BYTES)
    }

    @Test fun neverReadsBeforeTheOldestHeldByte() {
        val index = LiveBufferIndex(2)
        fill(index, 60, CHUNK_BYTES / 4)
        val offset = index.offsetFor(3600, 60_000)
        assertEquals(index.oldest, offset)
        assertTrue(index.oldest > 0)
    }

    @Test fun holdsOnlyTheLastChunks() {
        val index = LiveBufferIndex(3)
        index.append(CHUNK_BYTES * 5, 0)
        assertEquals(CHUNK_BYTES * 3L, index.oldest)
    }

    @Test fun secondsBehindIsTheReverse() {
        val index = LiveBufferIndex(1000)
        fill(index, 100, TS_PACKET_BYTES * 100)
        assertEquals(30, index.secondsBehind(index.offsetFor(30, 100_000), 100_000))
    }

    @Test fun capacityIsCutToHalfTheFreeSpace() {
        val bytesPerSecond = 1_000_000L
        assertEquals((1800 * bytesPerSecond / CHUNK_BYTES).toInt(), capacityChunks(1800, bytesPerSecond, 10_000_000_000))
        assertEquals((500_000_000L / CHUNK_BYTES).toInt(), capacityChunks(1800, bytesPerSecond, 1_000_000_000))
        assertEquals(0, capacityChunks(1800, 0, 10_000_000_000))
    }
}
