package com.evcalex.testcard.core

import com.evcalex.testcard.core.guide.Airing
import com.evcalex.testcard.core.guide.segmentsFor
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The guide row layout the desktop app computes in TypeScript (packages/core guideGrid.ts), from the same vectors. */
class GuideGridVectorsTest {
    @Test
    fun segmentsMatchTheSharedVectors() {
        val rows = vectors("guideGrid").filter { it.fn == "segmentsFor" }
        assertTrue(rows.isNotEmpty())
        for (row in rows) {
            val airings = row.args[0].let { if (it is JsonNull) null else it.jsonArray.map { a -> a.jsonObject.let { o -> Airing(o["title"]!!.jsonPrimitive.content, o["start"]!!.jsonPrimitive.long, o["end"]!!.jsonPrimitive.long) } } }
            val from = row.args[1].jsonPrimitive.long
            val to = row.args[2].jsonPrimitive.long
            val actual = segmentsFor(airings, from, to).map { Triple(it.start to it.end, it.airing?.title, it.loading) }
            val expected = row.out.jsonArray.map {
                val o = it.jsonObject
                Triple(o["start"]!!.jsonPrimitive.long to o["end"]!!.jsonPrimitive.long, o["airing"]!!.let { a -> if (a is JsonNull) null else a.jsonObject["title"]!!.jsonPrimitive.content }, o["loading"]!!.jsonPrimitive.content.toBoolean())
            }
            assertEquals(expected, actual)
        }
    }
}
