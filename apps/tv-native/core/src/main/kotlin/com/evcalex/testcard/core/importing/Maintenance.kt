package com.evcalex.testcard.core.importing

import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.atomic
import com.evcalex.testcard.core.db.exec
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.normalise.CLASSIFIER_VERSION
import com.evcalex.testcard.core.normalise.DISPLAY_NAME_VERSION
import com.evcalex.testcard.core.normalise.channelDisplayName

private const val SET_META = "INSERT INTO schema_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"

/**
 * Redoes every stored channel name from its `raw_name` when the tidying rules have changed, so an improvement reaches
 * existing installs without waiting for a refresh (`channelNames.ts`). Ids are untouched. Only names that actually change
 * are written, to spare the search index. Idempotent: a no-op once `schema_meta.display_name_version` matches. Run when the
 * database is opened, like `migrateDatabase` does.
 */
internal fun SQLiteConnection.renameChannels() {
    val stored = one("SELECT value FROM schema_meta WHERE key = 'display_name_version'") { it.getText(0) }
    if (stored != null && stored.toDoubleOrNull() == DISPLAY_NAME_VERSION.toDouble()) return
    atomic {
        for ((id, raw, name) in query("SELECT id, raw_name, normalised_name FROM channels") { Triple(it.getText(0), it.getText(1), it.getText(2)) }) {
            val renamed = channelDisplayName(raw)
            if (renamed != name) run("UPDATE channels SET normalised_name = ? WHERE id = ?", renamed, id)
        }
        run(SET_META, "display_name_version", DISPLAY_NAME_VERSION.toString())
    }
}

private val CATEGORY_TABLES = listOf("categories", "movie_categories", "series_categories")

/**
 * Recomputes every stored classification when the rules have changed (`categoryClassification.ts`), in slices. Idempotent:
 * a no-op once `schema_meta.classifier_version` matches.
 */
suspend fun reclassifyCategories(db: Db) {
    val stored = db.read { it.one("SELECT value FROM schema_meta WHERE key = 'classifier_version'") { r -> r.getText(0) } }
    if (stored != null && stored.toDoubleOrNull() == CLASSIFIER_VERSION.toDouble()) return
    for (table in CATEGORY_TABLES) {
        val rows = db.read { it.query("SELECT id, raw_name FROM $table") { r -> r.getText(0) to r.getText(1) } }
        db.applyInSlices(rows) { connection, (id, rawName) ->
            val columns = categoryColumns(rawName)
            // `country` is parseName's, written by the importers; this pass sets the classification only.
            connection.prepare("UPDATE $table SET genre = ?, language = ?, service = ?, tags = ? WHERE id = ?").use { it.exec(columns[1], columns[2], columns[3], columns[4], id) }
        }
    }
    db.write { it.run(SET_META, "classifier_version", CLASSIFIER_VERSION.toString()) }
}
