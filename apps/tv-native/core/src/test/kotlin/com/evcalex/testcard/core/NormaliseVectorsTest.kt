package com.evcalex.testcard.core

import com.evcalex.testcard.core.normalise.Catchup
import com.evcalex.testcard.core.normalise.RawChannelEntry
import com.evcalex.testcard.core.normalise.channelDisplayName
import com.evcalex.testcard.core.normalise.displayName
import com.evcalex.testcard.core.normalise.dropVariantMarks
import com.evcalex.testcard.core.normalise.fallbackRank
import com.evcalex.testcard.core.normalise.groupVariants
import com.evcalex.testcard.core.normalise.parseName
import com.evcalex.testcard.core.normalise.sameChannelKey
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class NormaliseVectorsTest {
    private fun str(value: String?): JsonElement = if (value == null) JsonNull else JsonPrimitive(value)

    private fun entryFrom(json: JsonObject): RawChannelEntry = RawChannelEntry(
        sourceId = json["sourceId"]!!.jsonPrimitive.content,
        categoryId = json["categoryId"]!!.jsonPrimitive.content,
        providerStreamId = json["providerStreamId"]!!.jsonPrimitive.content,
        rawName = json["rawName"]!!.jsonPrimitive.content,
        logoUrl = json["logoUrl"]?.jsonPrimitive?.content,
        channelNumber = json["channelNumber"]?.jsonPrimitive?.int,
        tvgId = json["tvgId"]?.jsonPrimitive?.content,
        catchup = json["catchup"]?.jsonObject?.let { Catchup(it["type"]!!.jsonPrimitive.content, it["days"]!!.jsonPrimitive.int) },
    )

    @Test
    fun namesMatch() {
        val failures = mutableListOf<String>()
        var checked = 0
        for (row in vectors("normalise")) {
            fun check(actual: Any?, expected: JsonElement = row.out) {
                checked += 1
                val got: JsonElement = when (actual) {
                    null -> JsonNull
                    is String -> JsonPrimitive(actual)
                    is Int -> JsonPrimitive(actual)
                    is Boolean -> JsonPrimitive(actual)
                    is JsonElement -> actual
                    else -> error("unexpected $actual")
                }
                if (got != expected) failures += "${row.fn}(${row.args}) expected $expected got $got"
            }
            when (row.fn) {
                "parseName" -> {
                    val parsed = parseName(row.string(0))
                    // The TS object leaves out country and quality when absent.
                    check(
                        JsonObject(
                            buildMap {
                                put("normalised", JsonPrimitive(parsed.normalised))
                                parsed.country?.let { put("country", JsonPrimitive(it)) }
                                parsed.quality?.let { put("quality", JsonPrimitive(it)) }
                                put("isOffline", JsonPrimitive(parsed.isOffline))
                            },
                        ),
                    )
                }
                "dropVariantMarks" -> check(dropVariantMarks(row.string(0)))
                "displayName" -> check(displayName(row.string(0)))
                "channelDisplayName" -> check(channelDisplayName(row.string(0)))
                "sameChannelKey" -> check(sameChannelKey(row.string(0)))
                "fallbackRank" -> check(fallbackRank(row.string(0)))
                "groupVariants" -> {
                    val channels = groupVariants(row.args[0].jsonArray.map { entryFrom(it.jsonObject) })
                    check(
                        JsonArray(
                            channels.map { channel ->
                                JsonObject(
                                    buildMap {
                                        put("id", JsonPrimitive(channel.id))
                                        put("sourceId", JsonPrimitive(channel.sourceId))
                                        put("categoryId", JsonPrimitive(channel.categoryId))
                                        put("normalisedName", JsonPrimitive(channel.normalisedName))
                                        put("rawName", JsonPrimitive(channel.rawName))
                                        channel.country?.let { put("country", JsonPrimitive(it)) }
                                        channel.logoUrl?.let { put("logoUrl", JsonPrimitive(it)) }
                                        channel.channelNumber?.let { put("channelNumber", JsonPrimitive(it)) }
                                        channel.tvgId?.let { put("tvgId", JsonPrimitive(it)) }
                                        put(
                                            "variants",
                                            JsonArray(
                                                channel.variants.map { variant ->
                                                    JsonObject(
                                                        buildMap {
                                                            put("id", JsonPrimitive(variant.id))
                                                            put("sourceId", JsonPrimitive(variant.sourceId))
                                                            put("providerStreamId", JsonPrimitive(variant.providerStreamId))
                                                            variant.quality?.let { put("quality", JsonPrimitive(it)) }
                                                            put("isOffline", JsonPrimitive(variant.isOffline))
                                                        },
                                                    )
                                                },
                                            ),
                                        )
                                        channel.catchup?.let { put("catchup", JsonObject(mapOf("type" to JsonPrimitive(it.type), "days" to JsonPrimitive(it.days)))) }
                                    },
                                )
                            },
                        ),
                    )
                }
                else -> continue
            }
        }
        assertEquals(emptyList<String>(), failures.take(25), "${failures.size} mismatches")
        org.junit.jupiter.api.Assertions.assertTrue(checked > 500, "only $checked vectors ran")
    }
}
