package com.evcalex.testcard.core

import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.CategoryRow
import com.evcalex.testcard.core.db.CategoryKind
import com.evcalex.testcard.core.db.HomeOptions
import com.evcalex.testcard.core.db.browseChannels
import com.evcalex.testcard.core.db.browseMovies
import com.evcalex.testcard.core.db.browseSeries
import com.evcalex.testcard.core.db.findNextEpisode
import com.evcalex.testcard.core.db.getEpisodePlaybackTarget
import com.evcalex.testcard.core.db.getMovieById
import com.evcalex.testcard.core.db.getMoviePlaybackTarget
import com.evcalex.testcard.core.db.getPlaybackProgress
import com.evcalex.testcard.core.db.getPlaybackTarget
import com.evcalex.testcard.core.db.getSeriesDetail
import com.evcalex.testcard.core.db.getSeriesSource
import com.evcalex.testcard.core.db.getSkipWindow
import com.evcalex.testcard.core.db.getUpNextEpisode
import com.evcalex.testcard.core.db.getUpNextEpisodes
import com.evcalex.testcard.core.db.listChannelCountries
import com.evcalex.testcard.core.db.listChannelFeeds
import com.evcalex.testcard.core.db.listCategories
import com.evcalex.testcard.core.db.listFavouriteChannels
import com.evcalex.testcard.core.db.listFavouriteMovies
import com.evcalex.testcard.core.db.listFavouriteSeries
import com.evcalex.testcard.core.db.listHidden
import com.evcalex.testcard.core.db.listMoviePlayOrder
import com.evcalex.testcard.core.db.listMovieCategories
import com.evcalex.testcard.core.db.listMovieVersions
import com.evcalex.testcard.core.db.listProfiles
import com.evcalex.testcard.core.db.listRecentChannels
import com.evcalex.testcard.core.db.listRecentMovies
import com.evcalex.testcard.core.db.listRecentSeries
import com.evcalex.testcard.core.db.listSeriesCategories
import com.evcalex.testcard.core.db.listSeriesVersions
import com.evcalex.testcard.core.db.listWatchedLately
import com.evcalex.testcard.core.db.movieHome
import com.evcalex.testcard.core.db.movieShelves
import com.evcalex.testcard.core.db.nowNextForChannels
import com.evcalex.testcard.core.db.programmesInWindow
import com.evcalex.testcard.core.db.searchAll
import com.evcalex.testcard.core.db.searchChannels
import com.evcalex.testcard.core.db.searchMovies
import com.evcalex.testcard.core.db.searchSeries
import com.evcalex.testcard.core.db.seriesHome
import com.evcalex.testcard.core.db.seriesShelves
import com.evcalex.testcard.core.db.unhide
import com.evcalex.testcard.core.db.withBorrowedSeasons
import com.evcalex.testcard.core.sync.listHomePins
import com.evcalex.testcard.core.sync.orderedSourceIds
import com.evcalex.testcard.core.sync.pinnedCategoryIds
import java.lang.reflect.Modifier
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/** A row object as JSON, by reflection: every property under its own name (the comparison ignores `_` and case in keys). */
private fun toJson(value: Any?, countKey: String): JsonElement = when (value) {
    null -> JsonNull
    is Boolean -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is String -> JsonPrimitive(value)
    is Map<*, *> -> JsonArray(value.map { (k, v) -> JsonArray(listOf(toJson(k, countKey), toJson(v, countKey))) })
    is Collection<*> -> JsonArray(value.map { toJson(it, countKey) })
    // The TypeScript season row carries its episodes as a property; Kotlin keeps the two together.
    is com.evcalex.testcard.core.db.SeasonWithEpisodes -> JsonObject((toJson(value.season, countKey) as JsonObject) + ("episodes" to toJson(value.episodes, countKey)))
    is Pair<*, *> -> JsonArray(listOf(toJson(value.first, countKey), toJson(value.second, countKey)))
    else -> JsonObject(
        value.javaClass.declaredFields.filter { !Modifier.isStatic(it.modifiers) && !it.isSynthetic }.associate { field ->
            field.isAccessible = true
            val name = if (value is CategoryRow && field.name == "count") countKey else field.name
            name to toJson(field.get(value), countKey)
        },
    )
}

private fun JsonObject.str(key: String) = this[key]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content?.replace('\u0000', '\u0001')
private fun JsonObject.int(key: String) = this[key]?.takeIf { it !is JsonNull }?.jsonPrimitive?.intOrNull

private fun JsonElement.strs() = jsonArray.map { it.str() }

private fun home(o: JsonObject) = HomeOptions(
    sourceId = o.str("sourceId"), perShelf = o.int("perShelf") ?: 16, genres = o.int("genres") ?: 8, minTitles = o.int("minTitles") ?: 6,
    language = o.str("language"), year = o.int("year"),
)

class DbQueriesGoldenTest {
    @BeforeEach fun freeze() { Clock.now = { FIXED_NOW } }
    @AfterEach fun thaw() { Clock.reset() }

    /** One recorded query, answered by the Kotlin port, as the JSON the TypeScript call produced. */
    private fun SQLiteConnection.answer(fn: String, args: JsonArray): Any? {
        fun s(i: Int) = args[i].str()
        fun o(i: Int) = args[i].jsonObject
        return when (fn) {
            "browseChannels" -> o(0).let { browseChannels(it.str("categoryId"), it.str("country"), it.str("sourceId"), it.str("genre"), it.int("limit") ?: 300, it.int("offset") ?: 0) }
            "listCategories" -> listCategories(args.getOrNull(0)?.str())
            "listRecentChannels" -> listRecentChannels()
            "listFavouriteChannels" -> listFavouriteChannels()
            "listChannelCountries" -> listChannelCountries(args.getOrNull(0)?.str())
            "searchChannels" -> searchChannels(s(0), args.getOrNull(1)?.jsonPrimitive?.intOrNull ?: 200, args.getOrNull(2)?.str())
            "nowNextForChannels" -> nowNextForChannels(args[0].strs().map { it!! }, args[1].jsonPrimitive.content.toLong())
            "programmesInWindow" -> programmesInWindow(args[0].strs().map { it!! }, args[1].jsonPrimitive.content.toLong(), args[2].jsonPrimitive.content.toLong())
            "getPlaybackTarget" -> getPlaybackTarget(s(0)!!, args.getOrNull(1)?.str())
            "listChannelFeeds" -> listChannelFeeds(s(0)!!)
            "browseMovies" -> o(0).let { browseMovies(it.str("categoryId"), it.str("sourceId"), it.str("genre"), it.int("limit") ?: 300, it.int("offset") ?: 0) }
            "listMovieCategories" -> listMovieCategories(args.getOrNull(0)?.str())
            "movieShelves" -> o(0).let { movieShelves(it.str("sourceId"), it.int("shelves") ?: 12, it.int("perShelf") ?: 20, it.int("minTitles") ?: 6) }
            "searchMovies" -> searchMovies(s(0)!!)
            "listFavouriteMovies" -> listFavouriteMovies()
            "listRecentMovies" -> listRecentMovies()
            "getMovieById" -> getMovieById(s(0)!!)
            "getMoviePlaybackTarget" -> getMoviePlaybackTarget(s(0)!!)
            "listMovieVersions" -> listMovieVersions(s(0)!!)
            "listMoviePlayOrder" -> listMoviePlayOrder(s(0)!!, args[1].jsonPrimitive.content == "true")
            "browseSeries" -> o(0).let { browseSeries(it.str("categoryId"), it.str("sourceId"), it.str("genre"), it.int("limit") ?: 300, it.int("offset") ?: 0) }
            "listSeriesCategories" -> listSeriesCategories(args.getOrNull(0)?.str())
            "seriesShelves" -> o(0).let { seriesShelves(it.str("sourceId"), it.int("shelves") ?: 12, it.int("perShelf") ?: 20, it.int("minTitles") ?: 6) }
            "searchSeries" -> searchSeries(s(0)!!)
            "listFavouriteSeries" -> listFavouriteSeries()
            "listRecentSeries" -> listRecentSeries()
            "getSeriesDetail" -> getSeriesDetail(s(0)!!)
            "getUpNextEpisode" -> getUpNextEpisode(s(0)!!)
            "listSeriesVersions" -> listSeriesVersions(s(0)!!)
            "getSeriesSource" -> getSeriesSource(s(0)!!)
            "getSkipWindow" -> getSkipWindow(s(0)!!)
            "withBorrowedSeasons" -> getSeriesDetail(s(0)!!)?.let { withBorrowedSeasons(it, args[1].strs().map { id -> id!! }) }
            "getUpNextEpisodes" -> getUpNextEpisodes(args[0].strs().map { it!! })
            "findNextEpisode" -> findNextEpisode(s(0)!!)
            "getEpisodePlaybackTarget" -> getEpisodePlaybackTarget(s(0)!!)
            "movieHome" -> movieHome(home(o(0)))
            "seriesHome" -> seriesHome(home(o(0)))
            "listWatchedLately" -> listWatchedLately()
            "searchAll" -> searchAll(s(0)!!, args.getOrNull(1)?.jsonObject?.str("sourceId"), args.getOrNull(1)?.jsonObject?.int("perKind") ?: 24)
            "getPlaybackProgress" -> getPlaybackProgress(s(0)!!, s(1)!!)
            "listHidden" -> listHidden()
            "listHomePins" -> listHomePins()
            "pinnedCategoryIds" -> pinnedCategoryIds(CategoryKind.of(s(0)!!)).toList()
            "orderedSourceIds" -> orderedSourceIds()
            "listProfiles" -> listProfiles()
            else -> error("no adapter for $fn")
        }
    }

    private fun countKeyOf(fn: String) = when {
        fn.contains("Movie") || fn.startsWith("movie") -> "movie_count"
        fn.contains("Series") || fn.startsWith("series") -> "series_count"
        else -> "channel_count"
    }

    @Test
    fun queriesReturnTheSameRows() = runBlocking {
        val world = ProviderWorld(dbJson("provider").jsonObject)
        val actions = dbJson("actions").jsonObject
        val db = importedDb(world)
        var clock = FIXED_NOW
        for (action in actions["actions"]!!.jsonArray) {
            clock += 1000
            Clock.now = { clock }
            db.write { it.replay(action.jsonObject["fn"].str(), action.jsonObject["args"]!!.jsonArray) }
        }
        val failures = ArrayList<String>()
        var checked = 0
        for ((index, query) in dbJson("queries").jsonArray.withIndex()) {
            val fn = query.jsonObject["fn"].str()
            val args = query.jsonObject["in"]!!.jsonArray
            if (fn == "__action") {
                val entry = args[0].jsonObject["args"]!!.jsonArray[0].jsonObject
                db.write { it.unhide(entry.str("sourceId")!!, entry.str("kind")!!, entry.str("key")!!) }
                continue
            }
            val actual = try {
                // Writes inside reads can happen (listProfiles inserts Main), so profile listing goes through the writer.
                if (fn == "listProfiles") db.write { toJson(it.answer(fn, args), countKeyOf(fn)) } else db.read { toJson(it.answer(fn, args), countKeyOf(fn)) }
            } catch (e: Throwable) {
                failures += "#$index $fn ${args.toString().take(120)}: threw $e"
                continue
            }
            checked += 1
            var expected = query.jsonObject["out"]!!
            // The TypeScript up-next result carries its season's whole episode list; the Kotlin one only names the season.
            if (fn == "getUpNextEpisode" && expected is JsonObject) expected = JsonObject(expected + ("season" to JsonObject(expected["season"]!!.jsonObject - "episodes")))
            val diff = firstDiff(expected, actual)
            if (diff != null) failures += "#$index $fn ${args.toString().take(120)}: $diff".take(700)
        }
        val after = db.read { it.dumpTables() }
        firstDiff(actions["afterUnhide"]!!, after)?.let { failures += "afterUnhide dump: $it".take(700) }
        db.close()
        assertTrue(failures.isEmpty(), "${failures.size} of $checked queries differ:\n" + failures.take(25).joinToString("\n"))
    }
}
