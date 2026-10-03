package com.evcalex.testcard.tv.platform

import android.os.Build
import android.os.Debug
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import android.view.Choreographer
import android.view.FrameMetrics
import android.view.KeyEvent
import android.view.Window
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

private const val TAG = "TC_PERF"

/**
 * Spike measurements (S3, S4, S5, S8). Key-to-frame latency is the time from a key event to the start of the next frame
 * the Choreographer draws: input delay plus the wait for a frame, a proxy for "focus visible" that is the same
 * on every build. Frame times come from `FrameMetrics` (TOTAL_DURATION). Every figure is logged with the `TC_PERF` tag
 * so `scripts/tv-perf.mjs` collects them next to the React Native app's `[perf]` lines.
 */
object Perf {
    private val keyLatencies = ArrayList<Long>()
    private var frames = 0
    private var janky = 0
    private var worstFrameMs = 0L
    private var frameSum = 0L

    /** The text of the on-screen overlay (S3/S5/S8 at a glance). */
    var overlay by mutableStateOf("")
        private set

    fun mark(name: String, extra: String = "") {
        Log.i(TAG, "$name t=${SystemClock.uptimeMillis()} $extra".trim())
    }

    fun onKey(event: KeyEvent) {
        if (event.action != KeyEvent.ACTION_DOWN || event.repeatCount != 0) return
        val sentAt = event.eventTime
        Choreographer.getInstance().postFrameCallback {
            val latency = SystemClock.uptimeMillis() - sentAt
            synchronized(keyLatencies) {
                keyLatencies += latency
                if (keyLatencies.size % 25 == 0) log()
            }
        }
    }

    /** Registers the frame listener on its own thread so measuring never costs the UI thread. */
    fun watchFrames(window: Window) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        val thread = HandlerThread("tc-frames").apply { start() }
        window.addOnFrameMetricsAvailableListener({ _, metrics, _ ->
            val ms = metrics.getMetric(FrameMetrics.TOTAL_DURATION) / 1_000_000
            synchronized(keyLatencies) {
                frames += 1
                frameSum += ms
                if (ms > 16) janky += 1
                if (ms > worstFrameMs) worstFrameMs = ms
            }
        }, Handler(thread.looper))
    }

    private fun percentile(sorted: List<Long>, p: Double): Long = if (sorted.isEmpty()) 0 else sorted[((sorted.size - 1) * p).toInt()]

    /** Called about once a second: updates the overlay and logs a summary. */
    fun refreshOverlay() {
        val (keys, frameCount, jankCount, worst) = synchronized(keyLatencies) {
            val sorted = keyLatencies.takeLast(100).sorted()
            Summary(
                "keys n=${keyLatencies.size} p50=${percentile(sorted, 0.5)}ms p95=${percentile(sorted, 0.95)}ms max=${sorted.lastOrNull() ?: 0}ms",
                frames, janky, worstFrameMs,
            )
        }
        val rt = Runtime.getRuntime()
        val heapMb = (rt.totalMemory() - rt.freeMemory()) / 1_048_576
        val nativeMb = Debug.getNativeHeapAllocatedSize() / 1_048_576
        overlay = "$keys\nframes $frameCount, over 16ms $jankCount, worst ${worst}ms\nheap ${heapMb}MB native ${nativeMb}MB"
    }

    private data class Summary(val keys: String, val frames: Int, val janky: Int, val worst: Long)

    private fun log() {
        val sorted = keyLatencies.takeLast(100).sorted()
        Log.i(TAG, "keys n=${keyLatencies.size} p50=${percentile(sorted, 0.5)} p95=${percentile(sorted, 0.95)} p99=${percentile(sorted, 0.99)} max=${sorted.last()}")
        Log.i(TAG, "frames n=$frames janky=$janky worst=${worstFrameMs}ms avg=${if (frames == 0) 0 else frameSum / frames}ms")
    }

    /** Resets the counters, so a script can measure one stretch (idle, then during an import). */
    fun reset() = synchronized(keyLatencies) {
        keyLatencies.clear()
        frames = 0
        janky = 0
        worstFrameMs = 0
        frameSum = 0
    }
}
