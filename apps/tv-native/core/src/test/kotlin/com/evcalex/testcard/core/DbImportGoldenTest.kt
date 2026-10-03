package com.evcalex.testcard.core

import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.epg.importEpg
import com.evcalex.testcard.core.importing.CatalogueResult
import com.evcalex.testcard.core.importing.ensureMovieDetails
import com.evcalex.testcard.core.importing.ensureSeriesEpisodes
import com.evcalex.testcard.core.importing.importCatalogue
import com.evcalex.testcard.core.importing.reclassifyCategories
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/** The TypeScript importers' database, rebuilt from the same provider world (`db/provider.json`), table by table. */
class DbImportGoldenTest {
    @BeforeEach fun freeze() { Clock.now = { FIXED_NOW } }
    @AfterEach fun thaw() { Clock.reset() }

    private fun summary(r: CatalogueResult) = JsonObject(buildMap {
        put("categories", JsonPrimitive(r.categories)); put("channels", JsonPrimitive(r.channels)); put("variants", JsonPrimitive(r.variants))
        r.movies?.let { put("movies", JsonPrimitive(it)) }; r.series?.let { put("series", JsonPrimitive(it)) }
    })

    @Test
    fun importedDatabaseMatches() = runBlocking {
        val world = ProviderWorld(dbJson("provider").jsonObject)
        val expected = dbJson("imported").jsonObject
        val db = tempDb()
        db.insertGoldenSources()
        val result1 = importCatalogue(db, xtreamSource(), world.api, world.http)
        val result2 = importCatalogue(db, playlistSource(), null, world.http)
        reclassifyCategories(db)
        importCatalogue(db, xtreamSource(), world.api, world.http)
        importEpg(db, XTREAM_ID, world.guide.byteInputStream(), 36L * 3_600_000)
        val movieIds = db.read { c -> c.query("SELECT id FROM movies WHERE source_id = ? ORDER BY rowid LIMIT 5", XTREAM_ID) { it.getText(0) } }
        for (id in movieIds) ensureMovieDetails(db, world.api, id)
        val seriesIds = db.read { c -> c.query("SELECT id FROM series WHERE source_id = ? ORDER BY rowid", XTREAM_ID) { it.getText(0) } }
        for (id in seriesIds.take(9)) ensureSeriesEpisodes(db, world.api, XTREAM_BASE, id)

        assertNull(firstDiff(expected["results"]!!, JsonArray(listOf(summary(result1), summary(result2)))), "import results")
        val dump = db.read { it.dumpTables() }
        for ((table, rows) in expected["dump"]!!.jsonObject) assertNull(firstDiff(rows, dump[table] ?: JsonArray(emptyList())), "table $table")
        assertNull(firstDiff(expected["movieIds"]!!.jsonArray, JsonArray(movieIds.map { JsonPrimitive(it) })), "movie ids")
        db.close()
    }
}
