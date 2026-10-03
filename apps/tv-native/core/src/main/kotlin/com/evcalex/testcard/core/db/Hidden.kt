package com.evcalex.testcard.core.db

import com.evcalex.testcard.core.nowMs
import androidx.sqlite.SQLiteConnection

/**
 * Categories and channels the viewer hid (`sync/hidden.ts`): left out of every list, row, search and the channels the
 * player steps through. The set is the account's and rides in each source's synced record, like its pins.
 */
enum class CategoryKind(val wire: String, val table: String) {
    Live("live", "categories"),
    Movies("movies", "movie_categories"),
    Series("series", "series_categories");

    companion object {
        fun of(wire: String): CategoryKind = entries.first { it.wire == wire }
    }
}

private fun quoted(ids: List<String>) = ids.joinToString(", ") { "'${it.replace("'", "''")}'" }

private fun notIn(column: String, ids: List<String>) = if (ids.isEmpty()) "1" else "$column NOT IN (${quoted(ids)})"

/** This device's ids for the hidden categories of one kind: nearly always none, so the filters below cost nothing. */
private fun SQLiteConnection.hiddenCategoryIds(kind: CategoryKind): List<String> = query(
    "SELECT cat.id FROM hidden_categories hc JOIN ${kind.table} cat ON cat.source_id = hc.source_id AND cat.provider_id = hc.category_key WHERE hc.kind = ?",
    kind.wire,
) { it.getText(0) }

/** SQL: true when the category row `alias` (of `kind`) is not hidden. */
fun SQLiteConnection.categoryShown(alias: String, kind: CategoryKind): String = notIn("$alias.id", hiddenCategoryIds(kind))

/** SQL: true when the channel row `alias` is not hidden, itself or through its category. */
fun SQLiteConnection.channelShown(alias: String): String {
    val channels = query("SELECT source_id || ':' || channel_key AS id FROM hidden_channels") { it.getText(0) }
    return "${notIn("$alias.id", channels)} AND ${notIn("$alias.category_id", hiddenCategoryIds(CategoryKind.Live))}"
}

/** SQL: true when the film or series row `alias` is not in a hidden category. */
fun SQLiteConnection.titleShown(alias: String, kind: CategoryKind): String = notIn("$alias.category_id", hiddenCategoryIds(kind))

/** Marks the source as edited so the change is pushed, later than anything it last synced under. */
internal fun SQLiteConnection.stampSource(sourceId: String) {
    run("UPDATE sources SET sync_updated_at = MAX(?, COALESCE(sync_updated_at, 0) + 1) WHERE id = ?", nowMs(), sourceId)
}

/** Hides a category. Synced. False for one this device does not have. */
fun SQLiteConnection.hideCategory(kind: CategoryKind, categoryId: String, label: String): Boolean {
    val (sourceId, key) = one("SELECT source_id, provider_id FROM ${kind.table} WHERE id = ?", categoryId) { it.getText(0) to it.getText(1) } ?: return false
    atomic {
        run(
            "INSERT INTO hidden_categories (source_id, kind, category_key, label, hidden_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET label = excluded.label",
            sourceId, kind.wire, key, label, nowMs(),
        )
        stampSource(sourceId)
    }
    return true
}

/** Hides a channel. Synced. False for one this device does not have. */
fun SQLiteConnection.hideChannel(channelId: String, label: String): Boolean {
    val sourceId = one("SELECT source_id FROM channels WHERE id = ?", channelId) { it.getText(0) } ?: return false
    if (!channelId.startsWith("$sourceId:")) return false
    atomic {
        run(
            "INSERT INTO hidden_channels (source_id, channel_key, label, hidden_at) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET label = excluded.label",
            sourceId, channelId.substring(sourceId.length + 1), label, nowMs(),
        )
        stampSource(sourceId)
    }
    return true
}

/** One hidden thing, for the list the viewer brings them back from. `kind` is "live", "movies", "series" or "channel". */
class HiddenEntry(val sourceId: String, val sourceName: String, val kind: String, val key: String, val label: String)

fun SQLiteConnection.listHidden(): List<HiddenEntry> = query(
    """SELECT h.source_id AS sourceId, s.name AS sourceName, h.kind, h.category_key AS key, h.label, h.hidden_at AS at FROM hidden_categories h JOIN sources s ON s.id = h.source_id
       UNION ALL
       SELECT h.source_id, s.name, 'channel', h.channel_key, h.label, h.hidden_at FROM hidden_channels h JOIN sources s ON s.id = h.source_id
       ORDER BY at DESC""",
) { HiddenEntry(it.getText(0), it.getText(1), it.getText(2), it.getText(3), it.getText(4)) }

/** Brings a hidden category or channel back. Synced. */
fun SQLiteConnection.unhide(sourceId: String, kind: String, key: String) = atomic {
    if (kind == "channel") run("DELETE FROM hidden_channels WHERE source_id = ? AND channel_key = ?", sourceId, key)
    else run("DELETE FROM hidden_categories WHERE source_id = ? AND kind = ? AND category_key = ?", sourceId, kind, key)
    stampSource(sourceId)
}

/** A source's hidden or pinned thing as it goes into its synced record. */
class KindKeyLabel(val kind: String, val key: String, val label: String)

fun SQLiteConnection.hiddenForSource(sourceId: String): List<KindKeyLabel> =
    query("SELECT kind, category_key AS key, label FROM hidden_categories WHERE source_id = ? ORDER BY hidden_at, rowid", sourceId) { KindKeyLabel(it.getText(0), it.getText(1), it.getText(2)) } +
        query("SELECT 'channel' AS kind, channel_key AS key, label FROM hidden_channels WHERE source_id = ? ORDER BY hidden_at, rowid", sourceId) { KindKeyLabel(it.getText(0), it.getText(1), it.getText(2)) }

/** Takes on the hidden set that came with a source from another device: it replaces this device's. */
fun SQLiteConnection.applySourceHidden(sourceId: String, hidden: List<KindKeyLabel>) {
    val now = nowMs()
    atomic {
        run("DELETE FROM hidden_categories WHERE source_id = ?", sourceId)
        run("DELETE FROM hidden_channels WHERE source_id = ?", sourceId)
        hidden.forEachIndexed { index, entry ->
            if (entry.kind == "channel") run("INSERT OR REPLACE INTO hidden_channels (source_id, channel_key, label, hidden_at) VALUES (?, ?, ?, ?)", sourceId, entry.key, entry.label, now + index)
            else run("INSERT OR REPLACE INTO hidden_categories (source_id, kind, category_key, label, hidden_at) VALUES (?, ?, ?, ?, ?)", sourceId, entry.kind, entry.key, entry.label, now + index)
        }
    }
}
