package com.evcalex.testcard.core

import com.evcalex.testcard.core.epg.GuideChannel
import com.evcalex.testcard.core.epg.MatchableChannel
import com.evcalex.testcard.core.epg.guideKey
import com.evcalex.testcard.core.epg.matchGuide
import com.evcalex.testcard.core.epg.parseXmltv
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Guide matching by name must key names and pick guide channels exactly as `matchGuide.ts` does (`test-vectors/guideMatch.json`). */
class GuideMatchVectorsTest {
    private fun nullable(value: JsonElement): String? = if (value is JsonNull) null else value.jsonPrimitive.content

    private fun answer(row: Vector): JsonElement? = when (row.fn) {
        "guideKey" -> JsonPrimitive(guideKey(row.string(0)))
        "xmltvChannels" -> {
            val channels = ArrayList<JsonElement>()
            var ended = 0
            parseXmltv(
                row.string(0).byteInputStream(),
                { false },
                onChannel = { id, names -> channels += JsonObject(mapOf("id" to JsonPrimitive(id), "names" to JsonArray(names.map { JsonPrimitive(it) }))) },
                onChannelsEnd = { ended += 1 },
            ) { }
            JsonObject(mapOf("channels" to JsonArray(channels), "endedOnce" to JsonPrimitive(ended == 1)))
        }
        "matchGuide" -> {
            val input = row.obj(0)
            val channels = input["channels"]!!.jsonArray.map {
                val o = it.jsonObject
                MatchableChannel(o["id"]!!.jsonPrimitive.content, o["rawName"]!!.jsonPrimitive.content, nullable(o["country"]!!), nullable(o["tvgId"]!!))
            }
            val guide = input["guide"]!!.jsonArray.map {
                val o = it.jsonObject
                GuideChannel(o["id"]!!.jsonPrimitive.content, o["names"]!!.jsonArray.map { name -> name.jsonPrimitive.content })
            }
            val aliases = input["aliases"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
            val result = matchGuide(channels, guide, aliases)
            JsonObject(
                mapOf(
                    "matches" to JsonObject(result.matches.mapValues { JsonObject(mapOf("guideId" to JsonPrimitive(it.value.guideId), "method" to JsonPrimitive(it.value.method))) }),
                    "stats" to JsonObject(
                        mapOf(
                            "channels" to JsonPrimitive(result.stats.channels),
                            "exact" to JsonPrimitive(result.stats.exact),
                            "matched" to JsonPrimitive(result.stats.matched),
                            "ambiguous" to JsonPrimitive(result.stats.ambiguous),
                            "unmatched" to JsonPrimitive(result.stats.unmatched),
                        ),
                    ),
                ),
            )
        }
        else -> null
    }

    @Test
    fun matchesTheTypeScript() {
        val failures = ArrayList<String>()
        var checked = 0
        for (row in vectors("guideMatch")) {
            val got = answer(row) ?: continue
            checked += 1
            // JSON object key order is not meaningful: compare as parsed values.
            if (got != row.out) failures += "${row.fn}(${row.args.toString().take(80)}) expected ${row.out.toString().take(300)} got ${got.toString().take(300)}"
        }
        assertTrue(checked > 100, "only $checked vectors checked")
        assertEquals(emptyList<String>(), failures)
    }
}
