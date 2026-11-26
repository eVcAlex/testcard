package com.evcalex.testcard.core

import com.evcalex.testcard.core.text.plainReason
import com.evcalex.testcard.core.xtream.asReplyList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/** The panel replies the app cannot use, and the plain words a person is shown for them (the same cases as `xtreamReply.test.ts`). */
class PlainReasonAndReplyTest {
    private fun reply(json: String) = Json.parseToJsonElement(json)

    @Test fun `a list passes through and curly braces mean nothing here`() {
        assertEquals(2, reply("[1,2]").asReplyList("its movies").size)
        assertEquals(JsonArray(emptyList()), reply("{}").asReplyList("its movies"))
    }

    @Test fun `any other object is said in words, with the providers own words when it gave some`() {
        assertEquals("The provider sent a reply the app couldn't read for its series.", assertThrows<IllegalStateException> { reply("""{"foo":1}""").asReplyList("its series") }.message)
        assertEquals(
            "The provider sent a reply the app couldn't read for its movies. It said: \"Too many connections\".",
            assertThrows<IllegalStateException> { reply("""{"message":" Too many connections "}""").asReplyList("its movies") }.message,
        )
    }

    @Test fun `a refused login reads as one`() {
        assertEquals("The provider rejected the login.", assertThrows<IllegalStateException> { reply("""{"user_info":{"auth":0}}""").asReplyList("its movies") }.message)
        assertEquals("The provider rejected the login.", assertThrows<IllegalStateException> { reply("""{"user_info":{"auth":"0"}}""").asReplyList("its movies") }.message)
    }

    @Test fun `a text or a number is never a list`() {
        for (json in listOf("\"oops\"", "3", "null")) assertTrue(assertThrows<IllegalStateException> { reply(json).asReplyList("its movies") }.message!!.contains("couldn't read for its movies"))
    }

    @Test fun `the library's words for an unreadable reply never reach the screen`() {
        val plain = "The provider sent a reply the app couldn't read. Try again in a minute, and if it keeps happening, press Edit to check the source."
        assertEquals(plain, plainReason("class kotlinx.serialization.json.JsonObject cannot be cast to class kotlinx.serialization.json.JsonArray (kotlinx.serialization.json.JsonObject and kotlinx.serialization.json.JsonArray are in unnamed module of loader 'app')"))
        assertEquals(plain, plainReason("kotlinx.serialization.json.internal.JsonDecodingException: Unexpected JSON token at offset 0: Expected start of the object '{', but had '<' instead"))
    }

    @Test fun `what was already plain stays so, including the new reply messages`() {
        assertEquals("The provider turned down the login. Press Edit to check it.", plainReason("The provider rejected the login."))
        assertEquals("The provider sent a reply the app couldn't read for its movies.", plainReason("The provider sent a reply the app couldn't read for its movies."))
        assertEquals("The provider's server had a problem.", plainReason("Xtream get_live_streams failed: HTTP 503"))
    }
}
