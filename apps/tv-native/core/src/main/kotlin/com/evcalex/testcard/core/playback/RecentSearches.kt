package com.evcalex.testcard.core.playback

import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.MIN_SEARCH_LENGTH
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.run

/** The searches that found something, newest first, so Search can offer them again when the box is empty. */
const val MAX_RECENT_SEARCHES = 8

private const val RECENT_KEY = "ui:search:recent"

/** [term] put first; an earlier copy (any case) moves up rather than repeating, and the list is cut to [MAX_RECENT_SEARCHES]. */
fun withRecentSearch(recent: List<String>, term: String): List<String> {
    val text = term.trim()
    if (text.length < MIN_SEARCH_LENGTH) return recent
    return (listOf(text) + recent.filterNot { it.equals(text, ignoreCase = true) }).take(MAX_RECENT_SEARCHES)
}

// ponytail: one line per search, so a search containing a newline cannot be stored; the box is single-line, so none can be typed.
fun SQLiteConnection.readRecentSearches(): List<String> = try {
    one("SELECT value FROM schema_meta WHERE key = ?", RECENT_KEY) { it.getText(0) }?.lines()?.filter { it.isNotBlank() } ?: emptyList()
} catch (_: Exception) {
    emptyList()
}

fun SQLiteConnection.writeRecentSearches(recent: List<String>) {
    try {
        run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)", RECENT_KEY, recent.joinToString("\n"))
    } catch (_: Exception) {
        // The list is simply not kept this time.
    }
}
