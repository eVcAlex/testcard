package com.evcalex.testcard.core.db

import com.evcalex.testcard.core.nowMs
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.execSQL
import com.evcalex.testcard.core.sync.applyHeldPins
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull as jsonLongOrNull

/**
 * The people who watch, as the account knows them (`profiles.ts`, `profileIdentity.ts`, `profileSwap.ts`). `MAIN_PROFILE` is
 * the account's own: it always exists, cannot be deleted, and its rows sync under the keys they always had.
 */
const val MAIN_PROFILE = "main"

class Profile(val id: String, val name: String, val colour: Int, val avatar: String?, /** A hash of the PIN, or null. */ val pin: String?, val position: Int)

/** Every profile, Main first, then in the order they were added. Main is created (unsynced, clock 0) if missing. */
fun SQLiteConnection.listProfiles(): List<Profile> {
    run("INSERT OR IGNORE INTO profiles (id, name, colour, position, updated_at) VALUES (?, 'Main', 0, 0, 0)", MAIN_PROFILE)
    return query("SELECT id, name, colour, avatar, pin, position FROM profiles WHERE deleted_at IS NULL ORDER BY id != ?, position, rowid", MAIN_PROFILE) {
        Profile(it.getText(0), it.getText(1), it.getLong(2).toInt(), it.textOrNull(3), it.textOrNull(4), it.getLong(5).toInt())
    }
}

/** Adds or changes a profile, stamped now so the change syncs. */
fun SQLiteConnection.saveProfile(profile: Profile) = run(
    """INSERT INTO profiles (id, name, colour, avatar, pin, position, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, colour = excluded.colour, avatar = excluded.avatar, pin = excluded.pin,
         position = excluded.position, updated_at = excluded.updated_at, deleted_at = NULL""",
    profile.id, profile.name, profile.colour, profile.avatar, profile.pin, profile.position, nowMs(),
)

/** Deletes a profile everywhere (a tombstone syncs) and its rows on this device. Never Main. */
fun SQLiteConnection.deleteProfile(id: String) {
    if (id == MAIN_PROFILE) return
    val now = nowMs()
    run("UPDATE profiles SET deleted_at = ?, updated_at = ? WHERE id = ?", now, now, id)
    forgetProfile(id)
}

/** The remote-key prefix of the profile's own rows ("" for Main). */
fun keyPrefix(profileId: String) = if (profileId == MAIN_PROFILE) "" else "p.$profileId."

// -------------------------------------------------------------------------------------------------
// How a profile is presented and picked

/** The avatar colours, in the order new profiles take them. */
val PROFILE_COLOURS = listOf("#e7d2ad", "#7fb8a4", "#e28a6d", "#8fa7e0", "#d7a3d8", "#e3c85c", "#9ccf6e", "#f0a3b5")

fun profileColour(profile: Profile) = PROFILE_COLOURS[profile.colour % PROFILE_COLOURS.size]

class Avatar(val id: String, val glyph: String)

/** The avatars to choose from, drawn on the profile's colour. Ids are stored and synced, so they never change. */
val AVATARS = listOf(
    Avatar("fox", "🦊"), Avatar("panda", "🐼"), Avatar("tiger", "🐯"), Avatar("lion", "🦁"), Avatar("dog", "🐶"), Avatar("cat", "🐱"),
    Avatar("frog", "🐸"), Avatar("monkey", "🐵"), Avatar("koala", "🐨"), Avatar("penguin", "🐧"), Avatar("owl", "🦉"), Avatar("unicorn", "🦄"),
    Avatar("octopus", "🐙"), Avatar("whale", "🐳"), Avatar("dino", "🦖"), Avatar("alien", "👽"), Avatar("robot", "🤖"), Avatar("rocket", "🚀"),
    Avatar("football", "⚽"), Avatar("game", "🎮"), Avatar("guitar", "🎸"), Avatar("popcorn", "🍿"), Avatar("star", "⭐"), Avatar("rainbow", "🌈"),
)

fun avatarGlyph(profile: Profile): String? = AVATARS.firstOrNull { it.id == profile.avatar }?.glyph

/** The `schema_meta` keys that are a profile's own and move with it. */
val PROFILE_META_KEYS = listOf("ui:captions", "ui:audio")

private const val ACTIVE_KEY = "ui:profile"

/** Where builds before profiles synced kept their list, on the TV alone. */
private const val OLD_LIST_KEY = "ui:profiles"

/** The account's profiles, taking in (once) any made on this device before profiles synced. */
fun SQLiteConnection.readProfiles(): List<Profile> {
    try {
        val old = one("SELECT value FROM schema_meta WHERE key = ?", OLD_LIST_KEY) { it.getText(0) }
        if (old != null) {
            val known = listProfiles().map { it.id }.toSet()
            Json.parseToJsonElement(old).jsonArray.forEachIndexed { index, element ->
                val entry = element.jsonObject
                val id = entry["id"]!!.jsonPrimitive.content
                val name = entry["name"]!!.jsonPrimitive.content
                val colour = entry["colour"]!!.jsonPrimitive.doubleOrNull!!.toInt()
                val pin = (entry["pin"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
                if (id != MAIN_PROFILE && id !in known) saveProfile(Profile(id, name, colour, null, pin, index))
                else if (id == MAIN_PROFILE && (name != "Main" || pin != null)) saveProfile(Profile(MAIN_PROFILE, name, colour, null, pin, 0))
            }
            run("DELETE FROM schema_meta WHERE key = ?", OLD_LIST_KEY)
        }
    } catch (_: Exception) {
        // An unreadable old list is dropped; Main is always there.
    }
    return listProfiles()
}

/** The profile whose rows are in the tables now. */
fun SQLiteConnection.readActiveProfile(): String =
    try { one("SELECT value FROM schema_meta WHERE key = ?", ACTIVE_KEY) { it.getText(0) } ?: MAIN_PROFILE } catch (_: Exception) { MAIN_PROFILE }

fun SQLiteConnection.writeActiveProfile(id: String) = run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)", ACTIVE_KEY, id)

/** A new profile's id: not a name, which can change. Letters and digits only (it is part of the sync keys). */
fun newProfileId(): String = "p${nowMs().toString(36)}${(Math.random() * 1e6).toLong().toString(36)}"

/** The colour a new profile takes: the first one nobody has, else round again. */
fun nextColour(profiles: List<Profile>): Int {
    val taken = profiles.map { it.colour % PROFILE_COLOURS.size }.toSet()
    val free = PROFILE_COLOURS.indices.firstOrNull { it !in taken }
    return free ?: (profiles.size % PROFILE_COLOURS.size)
}

/** FNV-1a over the profile's id and the digits, so the same PIN on two profiles is stored differently. */
fun pinHash(profileId: String, digits: String): String {
    var hash = 0x811c9dc5.toInt()
    // `for (const char of ...)` walks code points, but only ASCII is fed (ids are letters and digits, PINs are digits).
    for (char in "$profileId:$digits".codePoints().toArray()) {
        hash = hash xor (char and 0xffff)
        hash *= 0x01000193
    }
    return "%08x".format(hash.toLong() and 0xffffffffL)
}

fun pinMatches(profile: Profile, digits: String) = profile.pin != null && profile.pin == pinHash(profile.id, digits)

// -------------------------------------------------------------------------------------------------
// Swapping a profile's personal rows in and out

/** A person's own rows: what they have starred, watched and pinned. The catalogue, sources and sync state are shared. */
val PERSONAL_TABLES = listOf(
    "favourites", "recents", "movie_favourites", "movie_recents", "series_favourites", "series_recents",
    "playback_progress", "home_pins", "sync_tombstones", "pending_channel_sync",
)

private const val STASH_SQL_TABLE = """CREATE TABLE IF NOT EXISTS profile_stash (
  profile_id  TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  row         TEXT NOT NULL
)"""
private const val STASH_SQL_INDEX = "CREATE INDEX IF NOT EXISTS idx_profile_stash_profile ON profile_stash(profile_id)"

private fun SQLiteConnection.ensureStash() {
    execSQL(STASH_SQL_TABLE)
    execSQL(STASH_SQL_INDEX)
}

private fun SQLiteConnection.columnsOf(table: String): Set<String> = query("PRAGMA table_info($table)") { it.getText(1) }.toSet()

/** One row as JSON, column name to value, as `JSON.stringify(row)` of the better-sqlite3 row. */
private fun SQLiteConnection.rowsAsJson(table: String, where: String?, args: List<String>): List<String> {
    val prepared = prepare("SELECT * FROM $table${if (where != null) " WHERE $where" else ""}")
    return prepared.use { statement ->
        statement.bindAll(args.toTypedArray())
        val names = (0 until statement.getColumnCount()).map { statement.getColumnName(it) }
        buildList {
            while (statement.step()) {
                add(
                    JsonObject(
                        names.withIndex().associate { (index, name) ->
                            name to when (statement.getColumnType(index)) {
                                1 -> JsonPrimitive(statement.getLong(index)) // SQLITE_INTEGER
                                2 -> JsonPrimitive(statement.getDouble(index)) // SQLITE_FLOAT
                                5 -> JsonNull // SQLITE_NULL
                                else -> JsonPrimitive(statement.getText(index))
                            }
                        },
                    ).toString(),
                )
            }
        }
    }
}

/**
 * Puts `from`'s rows away and brings `to`'s out. `metaKeys` are `schema_meta` keys that belong to a profile too (caption
 * and audio preferences); they move the same way. A stashed row that no longer fits is dropped rather than failing the switch.
 */
fun SQLiteConnection.swapProfile(from: String, to: String, metaKeys: List<String> = emptyList()) {
    if (from == to) return
    ensureStash()
    val metaFilter = if (metaKeys.isNotEmpty()) "key IN (${metaKeys.joinToString(", ") { "?" }})" else null
    class Part(val table: String, val where: String?, val args: List<String>)
    val parts = PERSONAL_TABLES.map { Part(it, null, emptyList()) } + (if (metaFilter != null) listOf(Part("schema_meta", metaFilter, metaKeys)) else emptyList())
    atomic {
        for (part in parts) {
            val filter = if (part.where != null) " WHERE ${part.where}" else ""
            for (row in rowsAsJson(part.table, part.where, part.args)) run("INSERT INTO profile_stash (profile_id, table_name, row) VALUES (?, ?, ?)", from, part.table, row)
            run("DELETE FROM ${part.table}$filter", *part.args.toTypedArray())
        }
        val waiting = query("SELECT table_name AS tableName, row FROM profile_stash WHERE profile_id = ?", to) { it.getText(0) to it.getText(1) }
        val known = HashMap<String, Set<String>>()
        for ((tableName, row) in waiting) {
            if (parts.none { it.table == tableName }) continue
            val have = known.getOrPut(tableName) { columnsOf(tableName) }
            // Only the columns the table still has: a stashed row outlives schema changes.
            val entries = Json.parseToJsonElement(row).jsonObject.entries.filter { it.key in have }
            if (entries.isEmpty()) continue
            try {
                run(
                    "INSERT OR REPLACE INTO $tableName (${entries.joinToString(", ") { it.key }}) VALUES (${entries.joinToString(", ") { "?" }})",
                    *entries.map { (_, value) -> jsonToBind(value) }.toTypedArray(),
                )
            } catch (_: Exception) {
                // No longer fits (its source was removed since, so a pin's foreign key fails).
            }
        }
        run("DELETE FROM profile_stash WHERE profile_id = ?", to)

        // Where each profile has pulled up to. One never seen on this device starts from the beginning.
        val cursor = one("SELECT last_pulled_at AS at FROM sync_state WHERE id = 1") { it.getLong(0) }
        if (cursor != null) {
            run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)", "sync_pulled:$from", cursor.toString())
            val saved = one("SELECT value FROM schema_meta WHERE key = ?", "sync_pulled:$to") { it.getText(0) }
            run("UPDATE sync_state SET last_pulled_at = ? WHERE id = 1", saved?.toDoubleOrNull()?.toLong() ?: 0L)
        }
        // Pins for Main that arrived while someone else watched.
        if (to == "main") applyHeldPins()
    }
}

private fun jsonToBind(value: kotlinx.serialization.json.JsonElement): Any? = when {
    value is JsonNull -> null
    value is JsonPrimitive && value.isString -> value.content
    value is JsonPrimitive -> value.jsonLongOrNull ?: value.doubleOrNull
    else -> value.toString()
}

/** Forgets a profile that is not the one in the tables now. */
fun SQLiteConnection.forgetProfile(id: String) {
    ensureStash()
    run("DELETE FROM profile_stash WHERE profile_id = ?", id)
}
