package com.evcalex.testcard.core.importing

import com.evcalex.testcard.core.nowMs
import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.Db
import kotlinx.coroutines.delay
import kotlinx.coroutines.yield

/**
 * How long to hold off before the next slice. The app sets it so a slice waits while the remote is being used; by
 * default there is no wait (`setSlicePause` in `applyInSlices.ts`).
 */
object SlicePacing {
    @Volatile var pauseBeforeSliceMs: () -> Long = { 0 }
}

/** The most one slice holds the writer for: a few frames, so a screen's own writes (progress, favourites) are not kept waiting. */
private const val SLICE_MS = 40

/** Lets other work in between slices. */
suspend fun yieldBetweenSlices() {
    val wait = SlicePacing.pauseBeforeSliceMs()
    if (wait > 0) delay(wait) else yield()
}

/**
 * Applies `apply` to each item in transactions of about `budget` rows, or `SLICE_MS` of work if that comes first (a slow
 * device), letting other work in between, so a large import does not hold the writer for seconds at a time. Imports only
 * ever upsert, so a crash between slices leaves valid rows and the next refresh finishes the job.
 */
suspend fun <T> Db.applyInSlices(items: List<T>, rowsIn: (T) -> Int = { 1 }, budget: Int = 1500, apply: (SQLiteConnection, T) -> Unit) {
    suspend fun run(slice: List<T>) = transaction { connection -> for (item in slice) apply(connection, item) }
    // The rows a slice can take within its time, learned from the slices so far.
    var fits = budget
    var slice = ArrayList<T>()
    var rows = 0
    for (item in items) {
        slice.add(item)
        rows += rowsIn(item) + 1
        if (rows >= fits) {
            val started = nowMs()
            run(slice)
            val took = nowMs() - started
            if (took > 0) fits = maxOf(100L, minOf(budget.toLong(), Math.round(rows.toDouble() * SLICE_MS / took))).toInt()
            slice = ArrayList()
            rows = 0
            yieldBetweenSlices()
        }
    }
    if (slice.isNotEmpty()) run(slice)
}
