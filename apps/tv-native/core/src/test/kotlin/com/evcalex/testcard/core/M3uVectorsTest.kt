package com.evcalex.testcard.core

import com.evcalex.testcard.core.m3u.Classified
import com.evcalex.testcard.core.m3u.M3uItem
import com.evcalex.testcard.core.m3u.classifyEntry
import com.evcalex.testcard.core.m3u.parseM3u
import com.evcalex.testcard.core.m3u.urlExtension
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okio.Buffer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class M3uVectorsTest {
    private fun str(value: String?): JsonElement = if (value == null) JsonNull else JsonPrimitive(value)

    @Test
    fun m3uVectorsMatch() {
        var checked = 0
        for (row in vectors("m3u")) {
            when (row.fn) {
                "parseM3U" -> {
                    val items = mutableListOf<JsonElement>()
                    parseM3u(Buffer().writeUtf8(row.string(0))) { item ->
                        items += when (item) {
                            is M3uItem.Header -> JsonObject(mapOf("kind" to JsonPrimitive("header"), "header" to JsonObject(if (item.urlTvg != null) mapOf("urlTvg" to JsonPrimitive(item.urlTvg)) else emptyMap())))
                            is M3uItem.Entry -> JsonObject(
                                mapOf(
                                    "kind" to JsonPrimitive("entry"),
                                    "entry" to JsonObject(
                                        buildMap {
                                            put("rawName", JsonPrimitive(item.entry.rawName))
                                            put("url", JsonPrimitive(item.entry.url))
                                            put("attributes", JsonObject(item.entry.attributes.mapValues { JsonPrimitive(it.value) }))
                                            item.entry.groupTitle?.let { put("groupTitle", JsonPrimitive(it)) }
                                        },
                                    ),
                                ),
                            )
                        }
                    }
                    assertEquals(row.out, JsonArray(items), "parseM3U ${row.args[0]}")
                }
                "classifyEntry" -> {
                    val input = row.obj(0)
                    val got = classifyEntry(input["rawName"]!!.jsonPrimitive.content, input["url"]!!.jsonPrimitive.content)
                    val json: JsonElement = when (got) {
                        Classified.Live -> JsonObject(mapOf("kind" to JsonPrimitive("live")))
                        is Classified.Movie -> JsonObject(mapOf("kind" to JsonPrimitive("movie"), "title" to JsonPrimitive(got.title), "extension" to str(got.extension)))
                        is Classified.Episode -> JsonObject(
                            mapOf(
                                "kind" to JsonPrimitive("episode"), "series" to JsonPrimitive(got.series), "season" to JsonPrimitive(got.season),
                                "episode" to JsonPrimitive(got.episode), "title" to JsonPrimitive(got.title), "extension" to str(got.extension),
                            ),
                        )
                    }
                    assertEquals(row.out, json, "classifyEntry ${row.args}")
                }
                "urlExtension" -> assertEquals(row.out, str(urlExtension(row.string(0))), "urlExtension ${row.args}")
                else -> continue
            }
            checked += 1
        }
        assertTrue(checked > 30, "only $checked m3u vectors ran")
    }
}
