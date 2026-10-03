package com.evcalex.testcard.core

/**
 * The wall clock every database write and freshness rule reads, so a test can hold it still. Production leaves it on the
 * system clock.
 */
object Clock {
    @Volatile var now: () -> Long = System::currentTimeMillis

    /** Back to the system clock (what a test does after freezing it). */
    fun reset() { now = System::currentTimeMillis }
}

fun nowMs(): Long = Clock.now()
