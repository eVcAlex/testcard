package com.evcalex.testcard.core.playback

import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.run
import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * How captions look and when they come on by themselves (`playback/captions.ts`). This device's own setting (a TV and a
 * phone are read from different distances), kept in `schema_meta` beside the source pick, not synced.
 */
data class CaptionPrefs(
    /** Films and episodes start with captions on, in `language`. Live TV never does. */
    val always: Boolean = false,
    /** A two-letter code, or "any" for whichever track comes first. */
    val language: String = "en",
    val size: String = "medium",
    val color: String = "white",
    val background: String = "none",
    val edge: String = "shadow",
)

val DEFAULT_CAPTIONS = CaptionPrefs()

private class Language(val code: String, val name: String, val also: List<String>)

/** Languages offered for "always on", by two-letter code, with the three-letter codes and names a track may use instead. */
private val LANGUAGES = listOf(
    Language("en", "English", listOf("eng")),
    Language("es", "Spanish", listOf("spa", "esl", "español", "espanol", "castellano")),
    Language("fr", "French", listOf("fre", "fra", "français", "francais")),
    Language("de", "German", listOf("ger", "deu", "deutsch")),
    Language("it", "Italian", listOf("ita", "italiano")),
    Language("pt", "Portuguese", listOf("por", "português", "portugues")),
    Language("nl", "Dutch", listOf("dut", "nld", "nederlands")),
    Language("pl", "Polish", listOf("pol", "polski")),
    Language("sv", "Swedish", listOf("swe", "svenska")),
    Language("da", "Danish", listOf("dan", "dansk")),
    Language("no", "Norwegian", listOf("nor", "nob", "nno", "nb", "nn", "norsk")),
    Language("fi", "Finnish", listOf("fin", "suomi")),
    Language("el", "Greek", listOf("gre", "ell")),
    Language("tr", "Turkish", listOf("tur", "türkçe", "turkce")),
    Language("ar", "Arabic", listOf("ara")),
    Language("hi", "Hindi", listOf("hin")),
    Language("ja", "Japanese", listOf("jpn")),
    Language("ko", "Korean", listOf("kor")),
    Language("zh", "Chinese", listOf("chi", "zho", "mandarin", "cantonese")),
)

class CaptionChoice(val id: String, val label: String)

class CaptionSetting(val key: String, val label: String, val values: List<CaptionChoice>)

/** The settings, in the order they are listed, each with its choices. Shared by the settings page and the player's captions panel. */
val CAPTION_SETTINGS = listOf(
    CaptionSetting("always", "On for films and episodes", listOf(CaptionChoice("false", "Only when I turn them on"), CaptionChoice("true", "Always"))),
    CaptionSetting("language", "Language", listOf(CaptionChoice("any", "Any")) + LANGUAGES.map { CaptionChoice(it.code, it.name) }),
    CaptionSetting("size", "Size", listOf(CaptionChoice("small", "Small"), CaptionChoice("medium", "Medium"), CaptionChoice("large", "Large"), CaptionChoice("huge", "Extra large"))),
    CaptionSetting("color", "Text colour", listOf(CaptionChoice("white", "White"), CaptionChoice("yellow", "Yellow"), CaptionChoice("cream", "Cream"))),
    CaptionSetting("background", "Background", listOf(CaptionChoice("none", "None"), CaptionChoice("shaded", "Shaded box"), CaptionChoice("solid", "Solid box"))),
    CaptionSetting("edge", "Text edge", listOf(CaptionChoice("shadow", "Drop shadow"), CaptionChoice("outline", "Outline"), CaptionChoice("none", "None"))),
)

/** The choice a setting has now, as its id. */
fun settingValue(prefs: CaptionPrefs, key: String): String = when (key) {
    "always" -> prefs.always.toString()
    "language" -> prefs.language
    "size" -> prefs.size
    "color" -> prefs.color
    "background" -> prefs.background
    "edge" -> prefs.edge
    else -> error("no caption setting $key")
}

fun settingLabel(prefs: CaptionPrefs, setting: CaptionSetting): String {
    val id = settingValue(prefs, setting.key)
    return setting.values.firstOrNull { it.id == id }?.label ?: id
}

/** The prefs with one setting changed, by its choice's id. */
fun withSetting(prefs: CaptionPrefs, key: String, id: String): CaptionPrefs = when (key) {
    "always" -> prefs.copy(always = id == "true")
    "language" -> prefs.copy(language = id)
    "size" -> prefs.copy(size = id)
    "color" -> prefs.copy(color = id)
    "background" -> prefs.copy(background = id)
    "edge" -> prefs.copy(edge = id)
    else -> error("no caption setting $key")
}

/** One step through a setting's choices, wrapping round. */
fun stepSetting(prefs: CaptionPrefs, setting: CaptionSetting, direction: Int): CaptionPrefs {
    val at = setting.values.indexOfFirst { it.id == settingValue(prefs, setting.key) }
    val next = setting.values[Math.floorMod(at + direction, setting.values.size)]
    return withSetting(prefs, setting.key, next.id)
}

private const val PREFS_KEY = "ui:captions"

fun SQLiteConnection.readCaptionPrefs(): CaptionPrefs = try {
    val stored = one("SELECT value FROM schema_meta WHERE key = ?", PREFS_KEY) { it.getText(0) }
    if (stored == null) DEFAULT_CAPTIONS else {
        val json = Json.parseToJsonElement(stored).jsonObject
        // Anything missing or no longer offered falls back to the default, one setting at a time.
        var prefs = DEFAULT_CAPTIONS
        for (setting in CAPTION_SETTINGS) {
            val id = (json[setting.key] as? JsonPrimitive)?.contentOrNull ?: continue
            if (setting.values.any { it.id == id }) prefs = withSetting(prefs, setting.key, id)
        }
        prefs
    }
} catch (_: Exception) {
    DEFAULT_CAPTIONS
}

fun SQLiteConnection.writeCaptionPrefs(prefs: CaptionPrefs) {
    try {
        val json = JsonObject(
            mapOf(
                "always" to JsonPrimitive(prefs.always), "language" to JsonPrimitive(prefs.language), "size" to JsonPrimitive(prefs.size),
                "color" to JsonPrimitive(prefs.color), "background" to JsonPrimitive(prefs.background), "edge" to JsonPrimitive(prefs.edge),
            ),
        )
        run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)", PREFS_KEY, json.toString())
    } catch (_: Exception) {
        // Only the next launch would miss it.
    }
}

/** What a subtitle or audio track says about itself. */
class TrackLabel(val language: String?, val label: String?, val name: String? = null)

/** Whether a track is in the given language, by its code or, failing that, the name in its label. */
fun speaks(track: TrackLabel, code: String): Boolean {
    val language = LANGUAGES.firstOrNull { it.code == code }
    val said = (track.language ?: "").lowercase(Locale.ROOT)
    val primary = said.split(Regex("[-_]")).first()
    if (primary == code || (language?.also?.contains(primary) == true)) return true
    val label = "${track.label ?: ""} ${track.name ?: ""}".lowercase(Locale.ROOT)
    return language != null && (listOf(language.name.lowercase(Locale.ROOT)) + language.also.filter { it.length > 3 }).any { label.contains(it) }
}

/** A track that only covers foreign-language lines, not the whole programme. */
private fun forcedOnly(track: TrackLabel) = Regex("forced", RegexOption.IGNORE_CASE).containsMatchIn("${track.label ?: ""} ${track.name ?: ""}")

/**
 * The track to turn on by itself when a film or episode starts, or null to leave captions off: none unless the viewer has
 * asked for them always, and none in another language than the one they chose. A full track is preferred over a forced-only one.
 */
fun <T> autoCaptionTrack(prefs: CaptionPrefs, tracks: List<T>, labelOf: (T) -> TrackLabel): T? {
    if (!prefs.always || tracks.isEmpty()) return null
    val matching = if (prefs.language == "any") tracks else tracks.filter { speaks(labelOf(it), prefs.language) }
    return matching.firstOrNull { !forcedOnly(labelOf(it)) } ?: matching.firstOrNull()
}

/** The two-letter code a track is in, when it is one of the languages offered, or null. */
fun trackLanguage(track: TrackLabel): String? = LANGUAGES.firstOrNull { speaks(track, it.code) }?.code

/** How captions look, in the terms both the player and the settings preview use. Colours are ARGB integers. */
class CaptionLook(val textScale: Float, val color: Int, val background: Int, val edge: String)

fun captionLook(prefs: CaptionPrefs) = CaptionLook(
    textScale = when (prefs.size) { "small" -> 0.8f; "large" -> 1.3f; "huge" -> 1.65f; else -> 1f },
    color = when (prefs.color) { "yellow" -> 0xFFFFE13C.toInt(); "cream" -> 0xFFE7D2AD.toInt(); else -> 0xFFFFFFFF.toInt() },
    background = when (prefs.background) { "shaded" -> 0x96000000.toInt(); "solid" -> 0xFF000000.toInt(); else -> 0 },
    edge = prefs.edge,
)

/** Media3 draws captions this share of the picture's height tall at scale 1 (SubtitleView.DEFAULT_TEXT_SIZE_FRACTION). */
const val CAPTION_TEXT_FRACTION = 0.0533f

