package com.evcalex.testcard.core.playback

import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.run

/**
 * The player's options row (`playback/viewing.ts`): how the picture fills the screen, how fast it plays, and which
 * soundtrack. Picture size is kept per channel on this device (a badly flagged feed stays fixed); speed is never kept, as
 * on the streaming apps; the soundtrack's language is kept, like the captions language, and chosen again on the next film.
 */
enum class PictureFit(val id: String, val label: String) {
    Fit("contain", "Fit"),
    Fill("cover", "Fill"),
    Stretch("fill", "Stretch");

    fun next() = entries[(ordinal + 1) % entries.size]

    companion object {
        fun of(id: String?) = entries.firstOrNull { it.id == id } ?: Fit
    }
}

val SPEEDS = listOf(1f, 1.25f, 1.5f, 2f, 0.75f)

/** "1×", "1.25×": a whole number is written without a decimal point, as JS does. */
fun speedLabel(rate: Float) = "${if (rate == Math.floor(rate.toDouble()).toFloat()) rate.toInt().toString() else rate.toString()}×"

fun nextSpeed(rate: Float) = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.size]

private fun fitKey(channelId: String) = "ui:fit:$channelId"

fun SQLiteConnection.readPictureFit(channelId: String): PictureFit = try {
    PictureFit.of(one("SELECT value FROM schema_meta WHERE key = ?", fitKey(channelId)) { it.getText(0) })
} catch (_: Exception) {
    PictureFit.Fit
}

fun SQLiteConnection.writePictureFit(channelId: String, fit: PictureFit) {
    try {
        // Fit is the default, so choosing it again takes the channel's row away rather than keeping one per channel.
        if (fit == PictureFit.Fit) run("DELETE FROM schema_meta WHERE key = ?", fitKey(channelId))
        else run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)", fitKey(channelId), fit.id)
    } catch (_: Exception) {
        // Only the next visit to this channel would miss it.
    }
}

/** A soundtrack as the list shows it. */
fun audioName(language: String?, label: String?, name: String? = null): String {
    val said = if (!label.isNullOrEmpty()) label else if (!name.isNullOrEmpty()) name else language ?: ""
    return if (said != "") said else "Soundtrack"
}

/** The soundtrack in the viewer's language, or null to leave the stream's own default playing. */
fun <T> autoAudioTrack(language: String?, tracks: List<T>, current: T?, labelOf: (T) -> TrackLabel): T? {
    if (language == null || tracks.size < 2) return null
    if (current != null && speaks(labelOf(current), language)) return null
    return tracks.firstOrNull { speaks(labelOf(it), language) }
}

private const val AUDIO_KEY = "ui:audio"

fun SQLiteConnection.readAudioLanguage(): String? = try {
    one("SELECT value FROM schema_meta WHERE key = ?", AUDIO_KEY) { it.getText(0) }
} catch (_: Exception) {
    null
}

fun SQLiteConnection.writeAudioLanguage(language: String?) {
    try {
        if (language == null) run("DELETE FROM schema_meta WHERE key = ?", AUDIO_KEY)
        else run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)", AUDIO_KEY, language)
    } catch (_: Exception) {
        // Only the next film would miss it.
    }
}
