package com.evcalex.testcard.core

import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.importing.CatalogueSource
import com.evcalex.testcard.core.xtream.XtreamApi
import com.evcalex.testcard.core.sync.XtreamLogin
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

/** The fixed moment every TypeScript database vector was made at (`FIXED_NOW` in make-db-vectors.ts). */
const val FIXED_NOW = 1790942400000L
const val XTREAM_ID = "x1"
const val PLAYLIST_ID = "m1"
const val XTREAM_BASE = "http://panel.example:8080"
const val PLAYLIST_URL = "http://lists.example/main.m3u"

fun dbJson(name: String): JsonElement {
    val text = checkNotNull(Vector::class.java.classLoader.getResource("db/$name.json")) { "db/$name.json is not on the test classpath" }.readText()
    return Json.parseToJsonElement(text)
}

/** The provider world answered in-process: nothing listens on a socket, and the URLs the code sees stay the TypeScript ones. */
class ProviderWorld(private val world: JsonObject) {
    val guide: String get() = world["guide"]!!.jsonPrimitive.content

    val http: OkHttpClient = OkHttpClient.Builder().addInterceptor(Interceptor { chain ->
        val request = chain.request()
        val url = request.url
        val xtream = world["xtream"]!!.jsonObject
        val (code, body) = when {
            url.host == "lists.example" -> 200 to world["playlist"]!!.jsonPrimitive.content
            url.encodedPath.endsWith("/xmltv.php") -> 200 to guide
            else -> {
                val key = "${url.queryParameter("action") ?: ""}|${url.queryParameter("category_id") ?: url.queryParameter("series_id") ?: url.queryParameter("vod_id") ?: url.queryParameter("stream_id") ?: ""}"
                xtream[key]?.let { 200 to it.toString() } ?: (404 to "not found")
            }
        }
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message(if (code == 200) "OK" else "Not Found")
            .body(body.toResponseBody("application/json".toMediaType())).build()
    }).build()

    val api = XtreamApi(XtreamLogin(XTREAM_BASE, "u", "p"), http)
}

fun xtreamSource() = CatalogueSource(XTREAM_ID, "xtream", "Panel", XTREAM_BASE, null, null, true, true, true)
fun playlistSource() = CatalogueSource(PLAYLIST_ID, "m3u", "Playlist", null, PLAYLIST_URL, null, true, true, true)

suspend fun Db.insertGoldenSources() = write {
    it.run("INSERT INTO sources (id, kind, name, base_url, created_at, remote_key, sync_updated_at) VALUES (?, 'xtream', 'Panel', ?, ?, 'rk-x1', 10)", XTREAM_ID, XTREAM_BASE, FIXED_NOW)
    it.run("INSERT INTO sources (id, kind, name, playlist_url, created_at, remote_key, sync_updated_at) VALUES (?, 'm3u', 'Playlist', ?, ?, 'rk-m1', 20)", PLAYLIST_ID, PLAYLIST_URL, FIXED_NOW + 1)
}

fun tempDb(): Db = Db(File.createTempFile("golden", ".db").also { it.deleteOnExit() }.path)

/** Every table's rows, in insertion order, as the TypeScript `dumpDatabase` writes them. Search indexes are left out. */
fun SQLiteConnection.dumpTables(): JsonObject {
    val tables = query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' ORDER BY name") { it.getText(0) }
    return JsonObject(tables.associateWith { table ->
        val rows = ArrayList<JsonElement>()
        prepare("SELECT * FROM $table ORDER BY rowid").use { statement ->
            while (statement.step()) {
                rows += JsonObject((0 until statement.getColumnCount()).associate { column ->
                    statement.getColumnName(column) to when (statement.getColumnType(column)) {
                        1 -> JsonPrimitive(statement.getLong(column))
                        2 -> JsonPrimitive(statement.getDouble(column))
                        3 -> JsonPrimitive(statement.getText(column))
                        else -> JsonNull
                    }
                })
            }
        }
        JsonArray(rows)
    })
}

/** Ids carry U+0001 where the TypeScript ones carry NUL, and a number is a number whether it came out as 5 or 5.0. */
private fun JsonElement.canonical(): JsonElement = when (this) {
    // Keys compare without `_` and case (the TypeScript rows say source_id where its objects say sourceId), and a key
    // holding null is the same as no key (JSON.stringify drops undefined).
    is JsonObject -> JsonObject(entries.filter { it.value !is JsonNull }.associate { (k, v) -> k.replace("_", "").lowercase() to v.canonical() })
    is JsonArray -> JsonArray(map { it.canonical() })
    is JsonNull -> this
    is JsonPrimitive -> when {
        isString -> JsonPrimitive(content.replace('\u0000', '\u0001').replace("\\u0000", "\\u0001"))
        content == "true" -> JsonPrimitive(1.0)
        content == "false" -> JsonPrimitive(0.0)
        else -> JsonPrimitive(content.toDouble())
    }
}

/** The first place two JSON values differ, or null when they match. */
fun firstDiff(expected: JsonElement, actual: JsonElement, path: String = "$"): String? = diff(expected.canonical(), actual.canonical(), path)

private fun diff(expected: JsonElement, actual: JsonElement, path: String): String? {
    if (expected is JsonObject && actual is JsonObject) {
        for (key in expected.keys + actual.keys) {
            val e = expected[key]
            val a = actual[key]
            if (e == null || a == null) return "$path.$key: expected ${e ?: "(absent)"} but got ${a ?: "(absent)"}"
            diff(e, a, "$path.$key")?.let { return it }
        }
        return null
    }
    if (expected is JsonArray && actual is JsonArray) {
        for (i in 0 until maxOf(expected.size, actual.size)) {
            if (i >= expected.size) return "$path[$i]: unexpected extra ${actual[i]}"
            if (i >= actual.size) return "$path[$i]: missing ${expected[i]}"
            diff(expected[i], actual[i], "$path[$i]")?.let { return it }
        }
        return null
    }
    return if (expected == actual) null else "$path: expected $expected but got $actual"
}

/** The database the TypeScript run reached after importing, rebuilt through the Kotlin importers (the clock must already be frozen). */
suspend fun importedDb(world: ProviderWorld): Db {
    val db = tempDb()
    db.insertGoldenSources()
    com.evcalex.testcard.core.importing.importCatalogue(db, xtreamSource(), world.api, world.http)
    com.evcalex.testcard.core.importing.importCatalogue(db, playlistSource(), null, world.http)
    com.evcalex.testcard.core.importing.reclassifyCategories(db)
    com.evcalex.testcard.core.importing.importCatalogue(db, xtreamSource(), world.api, world.http)
    com.evcalex.testcard.core.epg.importEpg(db, XTREAM_ID, world.guide.byteInputStream(), 36L * 3_600_000)
    val imported = dbJson("imported").jsonObject
    for (id in imported["movieIds"]!!.jsonArray) com.evcalex.testcard.core.importing.ensureMovieDetails(db, world.api, id.jsonPrimitive.content)
    val seriesIds = db.read { c -> c.query("SELECT id FROM series WHERE source_id = ? ORDER BY rowid", XTREAM_ID) { it.getText(0) } }
    for (id in seriesIds.take(9)) com.evcalex.testcard.core.importing.ensureSeriesEpisodes(db, world.api, XTREAM_BASE, id)
    return db
}
