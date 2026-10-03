package com.evcalex.testcard.core

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.run
import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

/** Databases an older release left (the schema of v7, v10, v13 with rows in), migrated the way the TypeScript does (`migrations.json`). */
class MigrationVectorsTest {
    private fun resource(path: String) = checkNotNull(Vector::class.java.classLoader.getResource(path)) { "$path is missing" }.readText()

    /** The database an old release would have left: its schema, a version, and the vectors' seed rows. */
    private fun oldDatabase(file: File, from: Int, seed: String) {
        val db = BundledSQLiteDriver().open(file.path)
        db.execSQL("PRAGMA foreign_keys = ON")
        for (statement in com.evcalex.testcard.core.db.splitStatementsForTest(resource("db/old/schema-v$from.sql"))) db.execSQL(statement)
        db.run("INSERT INTO schema_meta (key, value) VALUES ('version', ?)", from.toString())
        for (statement in com.evcalex.testcard.core.db.splitStatementsForTest(seed)) db.execSQL(statement)
        db.close()
    }

    private fun rows(db: SQLiteConnection, sql: String): JsonArray = JsonArray(
        db.query(sql) { s -> JsonObject((0 until s.getColumnCount()).associate { i -> s.getColumnName(i) to (if (s.isNull(i)) JsonNull else if (s.getColumnType(i) == 1) JsonPrimitive(s.getLong(i)) else JsonPrimitive(s.getText(i))) }) },
    )

    @Test fun `old databases migrate to what the TypeScript migrations give`(@TempDir dir: File) {
        val vectors = kotlinx.serialization.json.Json.parseToJsonElement(resource("db/migrations.json")).jsonObject
        val seed = vectors["seed"]!!.jsonPrimitive.content
        Clock.now = { FIXED_NOW }
        try {
            for (case in vectors["cases"]!!.jsonArray.map { it.jsonObject }) {
                val from = case["from"]!!.jsonPrimitive.content.toInt()
                val file = File(dir, "old-$from.db")
                oldDatabase(file, from, seed)
                val db = Db(file.path)
                try {
                    runBlocking {
                        db.read { c ->
                            val objects = c.query("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name") { JsonObject(mapOf("type" to JsonPrimitive(it.getText(0)), "name" to JsonPrimitive(it.getText(1)))) }
                            assertEquals(case["objects"], JsonArray(objects), "objects from v$from")
                            for ((table, expected) in case["columns"]!!.jsonObject) {
                                val columns = c.query("SELECT name FROM pragma_table_info('$table')") { JsonPrimitive(it.getText(0)) }
                                assertEquals(expected, JsonArray(columns), "$table columns from v$from")
                            }
                            val data = case["data"]!!.jsonObject
                            val queries = mapOf(
                                "schema_meta" to "SELECT key, value FROM schema_meta WHERE key = 'version'",
                                "sources" to "SELECT id, include_live, include_movies, include_series, sort_order, backup_urls FROM sources ORDER BY id",
                                "movies" to "SELECT id FROM movies ORDER BY id",
                                "series" to "SELECT id, episodes_fetched_at FROM series ORDER BY id",
                                "favourites" to "SELECT channel_id, added_at, position, updated_at FROM favourites",
                                "recents" to "SELECT channel_id, played_at, updated_at FROM recents",
                            )
                            for ((name, sql) in queries) assertEquals(data[name], rows(c, sql), "$name from v$from")
                        }
                    }
                } finally { db.close() }
            }
        } finally { Clock.reset() }
    }
}
