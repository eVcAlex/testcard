package com.evcalex.testcard.core

import com.evcalex.testcard.core.db.pinHash
import com.evcalex.testcard.core.epg.parseXmltv
import com.evcalex.testcard.core.m3u.movieKey
import com.evcalex.testcard.core.m3u.seriesKey
import com.evcalex.testcard.core.normalise.classifyCategory
import com.evcalex.testcard.core.normalise.isDatedTitle
import com.evcalex.testcard.core.normalise.splitTitle
import com.evcalex.testcard.core.normalise.titleKey
import com.evcalex.testcard.core.xtream.extractXtreamCredentials
import com.evcalex.testcard.core.xtream.programmeMinutes
import com.evcalex.testcard.core.xtream.timeshiftStamp
import java.time.Instant
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The remaining pure functions the TypeScript vectors cover: titles, classifier, keys, credentials, catch-up and the guide parser. */
class MoreVectorsTest {
    private fun s(value: String?): JsonElement = if (value == null) JsonNull else JsonPrimitive(value)

    private fun answer(file: String, fn: String, args: JsonArray): JsonElement? = when (file to fn) {
        "normalise" to "splitTitle" -> splitTitle(args[0].str()).let { JsonObject(mapOf("title" to s(it.title), "year" to s(it.year), "is4k" to JsonPrimitive(it.is4k))) }
        "normalise" to "titleKey" -> s(titleKey(args[0].str()))
        "normalise" to "isDatedTitle" -> JsonPrimitive(isDatedTitle(args[0].str()))
        "normalise" to "classifyCategory" -> classifyCategory(args[0].str()).let {
            JsonObject(mapOf("genre" to s(it.genre), "service" to s(it.service), "language" to s(it.language), "tags" to JsonArray(it.tags.map(::s))))
        }
        "keys" to "pinHash" -> s(pinHash(args[0].str(), args[1].str()))
        "m3u" to "seriesKey" -> s(seriesKey(args[0].str()))
        "m3u" to "movieKey" -> s(movieKey(args[0].str()))
        "xtream" to "extractXtreamCredentials" -> extractXtreamCredentials(args[0].str())?.let { JsonObject(mapOf("baseUrl" to s(it.baseUrl), "username" to s(it.username), "password" to s(it.password))) } ?: JsonNull
        "catchup" to "timeshiftStamp" -> s(timeshiftStamp(args[0].str()))
        "catchup" to "programmeMinutes" -> JsonPrimitive(programmeMinutes(Instant.parse(args[0].str()).toEpochMilli(), Instant.parse(args[1].str()).toEpochMilli()))
        "xmltv" to "parseXmltv" -> {
            val map = args[1].jsonObject
            val out = ArrayList<JsonElement>()
            parseXmltv(args[0].str().byteInputStream(), { it in map }) { p ->
                out += JsonObject(
                    buildMap {
                        put("channelId", s(map[p.channel]!!.str()))
                        put("title", s(p.title))
                        put("start", s(Instant.ofEpochMilli(p.startMs).toString().let(::withMillis)))
                        put("end", s(Instant.ofEpochMilli(p.endMs).toString().let(::withMillis)))
                        p.description?.let { put("description", s(it)) }
                    },
                )
            }
            JsonArray(out)
        }
        else -> null
    }

    /** JS prints milliseconds always; `Instant.toString` leaves them off on a whole second. */
    private fun withMillis(iso: String) = if (Regex("""\d{2}:\d{2}:\d{2}Z""").containsMatchIn(iso)) iso.replace("Z", ".000Z") else iso

    private fun JsonElement.str() = (this as JsonPrimitive).content

    @Test
    fun theRestMatch() {
        val failures = ArrayList<String>()
        var checked = 0
        for (file in listOf("normalise", "keys", "m3u", "xtream", "catchup", "xmltv")) {
            for (row in vectors(file)) {
                val got = answer(file, row.fn, row.args) ?: continue
                checked += 1
                if (got != row.out) failures += "$file/${row.fn}(${row.args.toString().take(100)}) expected ${row.out.toString().take(200)} got ${got.toString().take(200)}"
            }
        }
        assertTrue(checked > 650, "only $checked vectors checked")
        assertTrue(failures.isEmpty(), "${failures.size} of $checked differ:\n" + failures.take(25).joinToString("\n"))
    }
}
