package com.evcalex.testcard.core

import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.CategoryKind
import com.evcalex.testcard.core.db.PROFILE_META_KEYS
import com.evcalex.testcard.core.db.Profile
import com.evcalex.testcard.core.db.clearPlaybackProgress
import com.evcalex.testcard.core.db.moveFavourite
import com.evcalex.testcard.core.db.recordMovieRecent
import com.evcalex.testcard.core.db.recordRecent
import com.evcalex.testcard.core.db.recordSeriesRecent
import com.evcalex.testcard.core.db.removeChannelFromRecents
import com.evcalex.testcard.core.db.saveProfile
import com.evcalex.testcard.core.db.saveSkipWindow
import com.evcalex.testcard.core.db.setPlaybackProgress
import com.evcalex.testcard.core.db.setWatched
import com.evcalex.testcard.core.db.swapProfile
import com.evcalex.testcard.core.db.toggleFavourite
import com.evcalex.testcard.core.db.toggleMovieFavourite
import com.evcalex.testcard.core.db.toggleSeriesFavourite
import com.evcalex.testcard.core.db.hideCategory
import com.evcalex.testcard.core.sync.pinCategory
import com.evcalex.testcard.core.sync.unpinCategory
import com.evcalex.testcard.core.sync.moveSource
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

private fun JsonElement.strings() = jsonArray.map { it.str() }

/** Replays one recorded user action (the same call, the same arguments). Shared with the query test. */
fun SQLiteConnection.replay(fn: String, args: JsonArray) {
    fun a(i: Int) = args[i]
    when (fn) {
        "toggleFavourite" -> toggleFavourite(a(0).str())
        "moveFavourite" -> moveFavourite(a(0).str(), a(1).jsonPrimitive.intOrNull!!)
        "recordRecent" -> recordRecent(a(0).str())
        "removeChannelFromRecents" -> removeChannelFromRecents(a(0).str())
        "toggleMovieFavourite" -> toggleMovieFavourite(a(0).str())
        "recordMovieRecent" -> recordMovieRecent(a(0).str())
        "toggleSeriesFavourite" -> toggleSeriesFavourite(a(0).str())
        "recordSeriesRecent" -> recordSeriesRecent(a(0).str())
        "setPlaybackProgress" -> setPlaybackProgress(a(0).str(), a(1).str(), a(2).jsonPrimitive.doubleOrNull!!, a(3).jsonPrimitive.doubleOrNull)
        "setWatched" -> setWatched(a(0).str(), a(1).strings(), a(2).str() == "true")
        "clearPlaybackProgress" -> clearPlaybackProgress(a(0).str(), a(1).strings())
        "hideCategory" -> hideCategory(CategoryKind.of(a(0).str()), a(1).str(), a(2).str())
        "pinCategory" -> pinCategory(CategoryKind.of(a(0).str()), a(1).str(), a(2).str())
        "unpinCategory" -> unpinCategory(CategoryKind.of(a(0).str()), a(1).str())
        "saveSkipWindow" -> saveSkipWindow(a(0).str(), a(1).jsonPrimitive.doubleOrNull!!, a(2).jsonPrimitive.doubleOrNull!!)
        "moveSource" -> moveSource(a(0).str(), a(1).jsonPrimitive.intOrNull!!)
        "saveProfile" -> a(0).jsonObject.let { p ->
            saveProfile(Profile(p["id"].str(), p["name"].str(), p["colour"]!!.jsonPrimitive.intOrNull!!, p["avatar"]?.takeIf { it !is JsonNull }?.str(), p["pin"]?.takeIf { it !is JsonNull }?.str(), p["position"]!!.jsonPrimitive.intOrNull!!))
        }
        "swapProfile" -> swapProfile(a(0).str(), a(1).str(), a(2).strings())
        else -> error("unknown action $fn")
    }
}

/** Arguments recorded from TypeScript carry NUL in ids; the device (and so Kotlin) stores U+0001. */
fun JsonElement?.str(): String = this!!.jsonPrimitive.content.replace('\u0000', '\u0001')

class DbActionsGoldenTest {
    @BeforeEach fun freeze() { Clock.now = { FIXED_NOW } }
    @AfterEach fun thaw() { Clock.reset() }

    @Test
    fun actionsLeaveTheSameTables() = runBlocking {
        val world = ProviderWorld(dbJson("provider").jsonObject)
        val expected = dbJson("actions").jsonObject
        val db = importedDb(world)
        var clock = FIXED_NOW
        val dumps = ArrayList<JsonObject>()
        var swaps = 0
        for (action in expected["actions"]!!.jsonArray) {
            clock += 1000
            Clock.now = { clock }
            val fn = action.jsonObject["fn"].str()
            db.write { it.replay(fn, action.jsonObject["args"]!!.jsonArray) }
            if (fn == "swapProfile") dumps += db.read { it.dumpTables() }.also { swaps += 1 }
        }
        assertNull(firstDiff(expected["midSwap"]!!, dumps[0]), "after the swap to the second profile")
        assertNull(firstDiff(expected["afterActions"]!!, dumps[1]), "after the swap back")
        db.close()
    }
}
