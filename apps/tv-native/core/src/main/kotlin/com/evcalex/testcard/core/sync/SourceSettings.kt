package com.evcalex.testcard.core.sync

import com.evcalex.testcard.core.nowMs
import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.CategoryKind
import com.evcalex.testcard.core.db.KindKeyLabel
import com.evcalex.testcard.core.db.atomic
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.db.stampSource
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** A category pinned to the Home page, with this device's id for it (null while that category is not imported here). */
class HomePin(val sourceId: String, val kind: String, val key: String, val label: String, val categoryId: String?)

/** Every pin, in the order they were pinned (`sourcePins.ts`). */
fun SQLiteConnection.listHomePins(): List<HomePin> =
    query("SELECT source_id AS sourceId, kind, category_key AS key, label FROM home_pins ORDER BY pinned_at, rowid") { arrayOf(it.getText(0), it.getText(1), it.getText(2), it.getText(3)) }
        .map { row ->
            val found = one("SELECT id FROM ${CategoryKind.of(row[1]).table} WHERE source_id = ? AND provider_id = ?", row[0], row[2]) { it.getText(0) }
            HomePin(row[0], row[1], row[2], row[3], found)
        }

/** The local ids of the categories of one kind that are pinned, for a screen that shows a Pin button. */
fun SQLiteConnection.pinnedCategoryIds(kind: CategoryKind): Set<String> =
    listHomePins().filter { it.kind == kind.wire && it.categoryId != null }.map { it.categoryId!! }.toSet()

/** Pins a category to Home. Synced. Returns false for a category this device does not have. */
fun SQLiteConnection.pinCategory(kind: CategoryKind, categoryId: String, label: String): Boolean {
    val (sourceId, key) = one("SELECT source_id, provider_id FROM ${kind.table} WHERE id = ?", categoryId) { it.getText(0) to it.getText(1) } ?: return false
    atomic {
        run(
            "INSERT INTO home_pins (source_id, kind, category_key, label, pinned_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id, kind, category_key) DO UPDATE SET label = excluded.label",
            sourceId, kind.wire, key, label, nowMs(),
        )
        stampSource(sourceId)
    }
    return true
}

/** Takes a category off Home. Synced. */
fun SQLiteConnection.unpinCategory(kind: CategoryKind, categoryId: String) {
    val (sourceId, key) = one("SELECT source_id, provider_id FROM ${kind.table} WHERE id = ?", categoryId) { it.getText(0) to it.getText(1) } ?: return
    atomic {
        run("DELETE FROM home_pins WHERE source_id = ? AND kind = ? AND category_key = ?", sourceId, kind.wire, key)
        stampSource(sourceId)
    }
}

/** A source's pins as they go into its synced record. */
fun SQLiteConnection.pinsForSource(sourceId: String): List<KindKeyLabel> =
    query("SELECT kind, category_key AS key, label FROM home_pins WHERE source_id = ? ORDER BY pinned_at, rowid", sourceId) { KindKeyLabel(it.getText(0), it.getText(1), it.getText(2)) }

/** Takes on the pins that came with a source from another device: the set replaces this device's. The sync clock is left as it came. */
fun SQLiteConnection.applySourcePins(sourceId: String, pins: List<KindKeyLabel>) {
    val existing = query("SELECT kind, category_key AS key FROM home_pins WHERE source_id = ?", sourceId) { it.getText(0) to it.getText(1) }
    val wanted = pins.map { "${it.kind}|${it.key}" }.toSet()
    atomic {
        for ((kind, key) in existing) if ("$kind|$key" !in wanted) run("DELETE FROM home_pins WHERE source_id = ? AND kind = ? AND category_key = ?", sourceId, kind, key)
        val now = nowMs()
        pins.forEachIndexed { index, pin ->
            // Keeps their order: pinned_at follows the position in the list.
            run(
                "INSERT INTO home_pins (source_id, kind, category_key, label, pinned_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id, kind, category_key) DO UPDATE SET label = excluded.label, pinned_at = excluded.pinned_at",
                sourceId, pin.kind, pin.key, pin.label, now + index,
            )
        }
    }
}

class SourceSkip(val key: String, val from: Int, val to: Int)

/** A source's skip-intro windows as they go into its synced record: by series remote key, never by this device's ids. */
fun SQLiteConnection.skipsForSource(sourceId: String): List<SourceSkip> = query(
    """SELECT s.remote_key AS key, k.from_secs AS "from", k.to_secs AS "to"
       FROM series_skip k JOIN series s ON s.id = k.series_id
       WHERE s.source_id = ? AND s.remote_key IS NOT NULL""",
    sourceId,
) { SourceSkip(it.getText(0), it.getLong(1).toInt(), it.getLong(2).toInt()) }

/** Takes on skip-intro windows that came with a source from another device. Ones for series not imported here yet are left for later. */
fun SQLiteConnection.applySourceSkips(sourceId: String, skips: List<SourceSkip>) {
    atomic {
        for (skip in skips) {
            val seriesId = one("SELECT id FROM series WHERE source_id = ? AND remote_key = ?", sourceId, skip.key) { it.getText(0) } ?: continue
            run(
                """INSERT INTO series_skip (series_id, from_secs, to_secs, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(series_id) DO UPDATE SET from_secs = excluded.from_secs, to_secs = excluded.to_secs, updated_at = excluded.updated_at""",
                seriesId, skip.from, skip.to, nowMs(),
            )
        }
    }
}

private const val HELD_PINS = "pins_for_main:"

/** Pins that arrived for a source while another profile was watching: they are Main's, so they wait here until Main is back. */
fun SQLiteConnection.holdPinsForMain(sourceId: String, pins: List<KindKeyLabel>) {
    val json = buildJsonArray { pins.forEach { add(buildJsonObject { put("kind", it.kind); put("key", it.key); put("label", it.label) }) } }
    run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)", "$HELD_PINS$sourceId", json.toString())
}

fun SQLiteConnection.applyHeldPins() {
    val held = query("SELECT key, value FROM schema_meta WHERE key LIKE ?", "$HELD_PINS%") { it.getText(0) to it.getText(1) }
    for ((key, value) in held) {
        val sourceId = key.substring(HELD_PINS.length)
        if (one("SELECT 1 FROM sources WHERE id = ?", sourceId) { it.getLong(0) } != null) {
            applySourcePins(sourceId, Json.parseToJsonElement(value).jsonArray.map { e -> e.jsonObject.let { KindKeyLabel(it["kind"]!!.jsonPrimitive.content, it["key"]!!.jsonPrimitive.content, it["label"]!!.jsonPrimitive.content) } })
        }
        run("DELETE FROM schema_meta WHERE key = ?", key)
    }
}

// -------------------------------------------------------------------------------------------------
// order, content and removal

/** Source ids in the order the user keeps them. Ones never placed come after the placed ones, oldest first. */
fun SQLiteConnection.orderedSourceIds(): List<String> = query("SELECT id FROM sources ORDER BY sort_order IS NULL, sort_order, created_at") { it.getText(0) }

/** Records a position that arrived from another device. The sync clock is left as it came. */
fun SQLiteConnection.applySourcePosition(sourceId: String, position: Int) = run("UPDATE sources SET sort_order = ? WHERE id = ?", position, sourceId)

/** Numbers the list in its current order and stamps each source as edited, so the order is pushed to the account. */
fun SQLiteConnection.stampSourceOrder() = writeOrder(orderedSourceIds(), true)

/** Moves a source one place up (-1) or down (1). Returns false at either end or for an unknown source. */
fun SQLiteConnection.moveSource(sourceId: String, delta: Int): Boolean {
    val ids = orderedSourceIds().toMutableList()
    val from = ids.indexOf(sourceId)
    val to = from + delta
    if (from < 0 || to < 0 || to >= ids.size) return false
    ids[from] = ids[to].also { ids[to] = ids[from] }
    writeOrder(ids, false)
    return true
}

private fun SQLiteConnection.writeOrder(ids: List<String>, all: Boolean) {
    val now = nowMs()
    atomic {
        ids.forEachIndexed { index, id ->
            val (position, updatedAt) = one("SELECT sort_order, sync_updated_at FROM sources WHERE id = ?", id) { (if (it.isNull(0)) null else it.getLong(0)) to (if (it.isNull(1)) 0L else it.getLong(1)) } ?: return@forEachIndexed
            if (!all && position == index.toLong()) return@forEachIndexed
            // Later than what this source last synced under, so the newer order wins on the other devices.
            run("UPDATE sources SET sort_order = ?, sync_updated_at = ? WHERE id = ?", index, maxOf(now, updatedAt + 1), id)
        }
    }
}

class SourceContent(val live: Boolean, val movies: Boolean, val series: Boolean)

/**
 * Saves which content types a source loads. Turning one off removes it from this device (its favourites and progress
 * rows are left alone). Returns true when something was turned on, so the caller knows the source needs importing again.
 */
fun SQLiteConnection.applySourceContent(sourceId: String, next: SourceContent): Boolean {
    val prev = one("SELECT include_live AS live, include_movies AS movies, include_series AS series FROM sources WHERE id = ?", sourceId) { Triple(it.getLong(0), it.getLong(1), it.getLong(2)) } ?: return false
    atomic {
        run("UPDATE sources SET include_live = ?, include_movies = ?, include_series = ? WHERE id = ?", if (next.live) 1 else 0, if (next.movies) 1 else 0, if (next.series) 1 else 0, sourceId)
        if (prev.first == 1L && !next.live) {
            run("DELETE FROM channels WHERE source_id = ?", sourceId)
            run("DELETE FROM categories WHERE source_id = ?", sourceId)
        }
        if (prev.second == 1L && !next.movies) {
            run("DELETE FROM movies WHERE source_id = ?", sourceId)
            run("DELETE FROM movie_categories WHERE source_id = ?", sourceId)
        }
        if (prev.third == 1L && !next.series) {
            run("DELETE FROM series WHERE source_id = ?", sourceId)
            run("DELETE FROM series_categories WHERE source_id = ?", sourceId)
        }
    }
    return (prev.first == 0L && next.live) || (prev.second == 0L && next.movies) || (prev.third == 0L && next.series)
}

/**
 * Removes a source and what only existed because of it. The cascade takes its categories, channels, films, series and
 * episodes; the rest is pruned here. A removal the user makes is recorded as a tombstone so it reaches their other
 * devices; one that arrived from another device is not (`recordTombstone = false`).
 */
fun SQLiteConnection.removeSourceRows(sourceId: String, recordTombstone: Boolean) {
    val remoteKey = one("SELECT remote_key FROM sources WHERE id = ?", sourceId) { it.textOrNullAt(0) } ?: return
    atomic {
        if (recordTombstone && remoteKey.value != null) run("INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) VALUES ('sources', ?, ?)", remoteKey.value, nowMs())
        run("DELETE FROM sources WHERE id = ?", sourceId)
        // The synced favourites and recents pruned below need tombstones too.
        if (recordTombstone) {
            val now = nowMs()
            for ((table, column, parent) in listOf(
                Triple("movie_favourites", "movie_id", "movies"),
                Triple("movie_recents", "movie_id", "movies"),
                Triple("series_favourites", "series_id", "series"),
                Triple("series_recents", "series_id", "series"),
            )) {
                run("INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) SELECT '$table', remote_key, ? FROM $table WHERE remote_key IS NOT NULL AND $column NOT IN (SELECT id FROM $parent)", now)
            }
        }
        run("DELETE FROM favourites WHERE channel_id NOT IN (SELECT id FROM channels)")
        run("DELETE FROM recents WHERE channel_id NOT IN (SELECT id FROM channels)")
        run("DELETE FROM movie_favourites WHERE movie_id NOT IN (SELECT id FROM movies)")
        run("DELETE FROM movie_recents WHERE movie_id NOT IN (SELECT id FROM movies)")
        run("DELETE FROM series_favourites WHERE series_id NOT IN (SELECT id FROM series)")
        run("DELETE FROM series_recents WHERE series_id NOT IN (SELECT id FROM series)")
        // Polymorphic (item_type + item_id, no foreign key): the cascade cannot reach it.
        val orphaned = "((item_type = 'movie' AND item_id NOT IN (SELECT id FROM movies)) OR (item_type = 'episode' AND item_id NOT IN (SELECT id FROM episodes)))"
        if (recordTombstone) {
            val now = nowMs()
            run("UPDATE playback_progress SET position_secs = 0, watched = 0, updated_at = ?, deleted_at = ? WHERE $orphaned AND remote_key IS NOT NULL AND deleted_at IS NULL", now, now)
        }
        run("DELETE FROM playback_progress WHERE $orphaned AND (remote_key IS NULL OR ?)", if (recordTombstone) 0 else 1)
    }
}

/** A nullable text column read as a row: lets `one` tell "no row" from "a row with null". */
internal class Nullable(val value: String?)

internal fun androidx.sqlite.SQLiteStatement.textOrNullAt(column: Int) = Nullable(if (isNull(column)) null else getText(column))
