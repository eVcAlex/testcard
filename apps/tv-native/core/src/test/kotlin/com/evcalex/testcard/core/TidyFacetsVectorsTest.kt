package com.evcalex.testcard.core

import com.evcalex.testcard.core.db.channelGuideCountry
import com.evcalex.testcard.core.db.guideCountryHeading
import com.evcalex.testcard.core.db.guideCountryOf
import com.evcalex.testcard.core.db.tidyCategoryLabel
import com.evcalex.testcard.core.epg.isPlaceholderChannelName
import com.evcalex.testcard.core.epg.leaguesOf
import com.evcalex.testcard.core.epg.leaguesOfChannel
import com.evcalex.testcard.core.epg.stationRank
import com.evcalex.testcard.core.normalise.qualityRank
import com.evcalex.testcard.core.epg.localNetworkOf
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** What a name says (league, local station, placeholder), country codes and category names must agree with `tidyKnowledge.ts` (`test-vectors/tidyFacets.json`). */
class TidyFacetsVectorsTest {
    private fun arg(row: Vector, index: Int): JsonElement = row.args[index]
    private fun nullable(element: JsonElement): String? = if (element is JsonNull) null else element.jsonPrimitive.content
    private fun text(value: String?): JsonElement = if (value == null) JsonNull else JsonPrimitive(value)

    private fun answer(row: Vector): JsonElement = when (row.fn) {
        "facets" -> {
            val name = row.string(0)
            JsonObject(mapOf("leagues" to JsonArray(leaguesOf(name).map { JsonPrimitive(it) }), "local" to text(localNetworkOf(name)), "placeholder" to JsonPrimitive(isPlaceholderChannelName(name))))
        }
        "leaguesOfChannel" -> JsonArray(leaguesOfChannel(row.string(0), row.string(1), nullable(arg(row, 2))).map { JsonPrimitive(it) })
        "stationRank" -> JsonPrimitive(stationRank(row.string(0), row.string(1)))
        "qualityRank" -> JsonPrimitive(qualityRank(row.string(0)))
        "guideCountryOf" -> text(guideCountryOf(row.string(0)))
        "channelGuideCountry" -> text(channelGuideCountry(nullable(arg(row, 0)), nullable(arg(row, 1)), row.string(2)))
        "guideCountryHeading" -> JsonPrimitive(guideCountryHeading(nullable(arg(row, 0))))
        "tidyCategoryLabel" -> JsonPrimitive(tidyCategoryLabel(row.string(0), arg(row, 1).jsonPrimitive.boolean))
        else -> error("unknown vector fn ${row.fn}")
    }

    @Test
    fun matchesTheTypeScript() {
        val failures = ArrayList<String>()
        var checked = 0
        for (row in vectors("tidyFacets")) {
            val got = answer(row)
            if (got != row.out) failures += "${row.fn}(${row.args.toString().take(100)}): expected ${row.out} but got $got"
            checked += 1
        }
        assertTrue(checked > 100, "only $checked tidy facet vectors were checked")
        assertEquals(emptyList<String>(), failures)
    }
}
