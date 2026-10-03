package com.evcalex.testcard.core

private const val RESUME_FLOOR_SECS = 30
private const val WATCHED_THRESHOLD = 0.95

/** Crossing 95% of the duration counts as watched. Port of `packages/core/src/playback/progressPolicy.ts`. */
fun isWatched(positionSecs: Double, durationSecs: Double?): Boolean {
    if (durationSecs == null || durationSecs <= 0) return false
    return positionSecs / durationSecs >= WATCHED_THRESHOLD
}

/** Whether a load should offer "Resume" rather than just starting at 0. */
fun shouldPromptResume(positionSecs: Double, durationSecs: Double?): Boolean {
    if (durationSecs == null || durationSecs <= 0) return false
    if (positionSecs < RESUME_FLOOR_SECS) return false
    return positionSecs / durationSecs < WATCHED_THRESHOLD
}
