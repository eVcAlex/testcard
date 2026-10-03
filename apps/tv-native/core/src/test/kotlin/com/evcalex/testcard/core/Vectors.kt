package com.evcalex.testcard.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** One row of a file in `packages/core/test-vectors`: `{ fn, in, out }`. */
class Vector(val fn: String, val args: JsonArray, val out: JsonElement) {
    fun string(index: Int): String = args[index].jsonPrimitive.content
    fun obj(index: Int): JsonObject = args[index].jsonObject
}

fun vectors(name: String): List<Vector> {
    val text = checkNotNull(Vector::class.java.classLoader.getResource("$name.json")) { "$name.json is not on the test classpath" }.readText()
    return Json.parseToJsonElement(text).jsonArray.map { row ->
        val o = row.jsonObject
        Vector(o["fn"]!!.jsonPrimitive.content, o["in"]!!.jsonArray, o["out"]!!)
    }
}
