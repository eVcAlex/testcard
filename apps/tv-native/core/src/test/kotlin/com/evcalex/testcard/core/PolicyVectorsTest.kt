package com.evcalex.testcard.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Proves the vector files are wired in (packages/core/test-vectors) and that the first port matches them. */
class PolicyVectorsTest {
    private fun vectors(name: String): JsonArray {
        val text = checkNotNull(javaClass.classLoader.getResource("$name.json")) { "$name.json is not on the test classpath" }.readText()
        return Json.parseToJsonElement(text).jsonArray
    }

    private fun JsonObject.arg(index: Int): Double? = this["in"]!!.jsonArray[index].let { if (it is JsonNull) null else it.jsonPrimitive.double }

    @Test
    fun policyVectorsMatch() {
        val rows = vectors("policy")
        assertTrue(rows.isNotEmpty())
        for (row in rows.map { it.jsonObject }) {
            val position = row.arg(0)!!
            val duration = row.arg(1)
            val expected = row["out"]!!.jsonPrimitive.boolean
            val actual = when (val fn = row["fn"]!!.jsonPrimitive.content) {
                "isWatched" -> isWatched(position, duration)
                "shouldPromptResume" -> shouldPromptResume(position, duration)
                else -> error("unknown fn $fn")
            }
            assertEquals(expected, actual, "${row["fn"]} $position $duration")
        }
    }
}
