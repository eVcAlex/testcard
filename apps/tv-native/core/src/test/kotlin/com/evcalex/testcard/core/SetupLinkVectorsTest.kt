package com.evcalex.testcard.core

import com.evcalex.testcard.core.crypto.Sealed
import com.evcalex.testcard.core.sync.LinkSecrets
import com.evcalex.testcard.core.sync.LinkSetup
import com.evcalex.testcard.core.sync.SetupFragment
import com.evcalex.testcard.core.sync.SetupLinkException
import com.evcalex.testcard.core.sync.SetupSource
import com.evcalex.testcard.core.sync.base64UrlEncode
import com.evcalex.testcard.core.sync.openLinkSecrets
import com.evcalex.testcard.core.sync.openSetupProfile
import com.evcalex.testcard.core.sync.parseLinkOutcome
import com.evcalex.testcard.core.sync.parseSetupFragment
import com.evcalex.testcard.core.sync.parseSetupProfile
import com.evcalex.testcard.core.sync.setupProof
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** A source shared by link must be claimed, opened and read on the TV exactly as the TypeScript sealed it (`test-vectors/setup.json`, `link.json`). */
class SetupLinkVectorsTest {
    private fun sealed(element: JsonElement) = Sealed(element.jsonObject["blob"]!!.jsonPrimitive.content, element.jsonObject["iv"]!!.jsonPrimitive.content)
    private fun fragment(element: JsonElement) = SetupFragment(element.jsonObject["id"]!!.jsonPrimitive.content, element.jsonObject["secret"]!!.jsonPrimitive.content)

    @Test
    fun proofsAndLinkTextMatchTheTypeScript() {
        var checked = 0
        for (row in vectors("setup")) {
            when (row.fn) {
                "setupProof" -> {
                    val got = setupProof(row.string(0))
                    assertEquals(row.out.jsonObject["proof"]!!.jsonPrimitive.content, got.proof)
                    assertEquals(row.out.jsonObject["claimHash"]!!.jsonPrimitive.content, got.claimHash)
                }
                "parseSetupFragment" -> {
                    val got = parseSetupFragment(row.string(0))
                    if (row.out is JsonNull) assertNull(got) else assertEquals(fragment(row.out).let { it.id to it.secret }, got!!.let { it.id to it.secret })
                }
                "openSetupProfile" -> {
                    val profile = openSetupProfile(sealed(row.args[0]), fragment(row.args[1]))
                    val expected = row.out.jsonObject
                    assertEquals(expected["name"]!!.jsonPrimitive.content, profile.name)
                    assertEquals(expected["epgOptimise"]?.jsonPrimitive?.content == "true", profile.epgOptimise)
                    val source = expected["source"]!!.jsonObject
                    when (val got = profile.source) {
                        is SetupSource.Xtream -> {
                            assertEquals(source["host"]!!.jsonPrimitive.content, got.host)
                            assertEquals(source["username"]!!.jsonPrimitive.content, got.username)
                            assertEquals(source["password"]!!.jsonPrimitive.content, got.password)
                            assertEquals(source["epgUrl"]!!.jsonPrimitive.content, got.epgUrl)
                            assertEquals(listOf("http://b.example.com"), got.backupHosts)
                            assertEquals(listOf(true, false, true), listOf(got.content!!.live, got.content!!.movies, got.content!!.series))
                        }
                        is SetupSource.Playlist -> assertEquals(source["playlistUrl"]!!.jsonPrimitive.content, got.playlistUrl)
                    }
                }
                else -> continue
            }
            checked += 1
        }
        assertTrue(checked >= 8, "only $checked setup vectors checked")
    }

    @Test
    fun aBlobMovedToAnotherProfileOrOpenedWithAnotherSecretIsRefused() {
        val row = vectors("setup").first { it.fn == "openSetupProfile" }
        val link = fragment(row.args[1])
        assertThrows(SetupLinkException::class.java) { openSetupProfile(sealed(row.args[0]), SetupFragment("B".repeat(22), link.secret)) }
        assertThrows(SetupLinkException::class.java) { openSetupProfile(sealed(row.args[0]), SetupFragment(link.id, "c".repeat(43))) }
    }

    @Test
    fun theProfileReaderIsStrict() {
        val ok = """{"v":1,"name":"X","source":{"playlistUrl":"http://p.example.com/l.m3u"}}"""
        parseSetupProfile(ok)
        for (bad in listOf(
            """{"v":2,"name":"X","source":{"playlistUrl":"http://p.example.com/l.m3u"}}""",
            """{"v":1,"name":"","source":{"playlistUrl":"http://p.example.com/l.m3u"}}""",
            """{"v":1,"name":"X","extra":1,"source":{"playlistUrl":"http://p.example.com/l.m3u"}}""",
            """{"v":1,"name":"X","source":{"playlistUrl":"http://p.example.com/l.m3u","pins":[]}}""",
            """{"v":1,"name":"X","source":{"playlistUrl":"file:///etc/passwd"}}""",
            """{"v":1,"name":"X","source":{"playlistUrl":"javascript:alert(1)"}}""",
            """{"v":1,"name":"X","source":{"host":"http://h.example.com","username":"u"}}""",
            """{"v":1,"name":"X","source":{"host":"ftp://h.example.com","username":"u","password":"p"}}""",
            """{"v":1,"name":"X","source":{"playlistUrl":"http://p.example.com/l.m3u","content":{"live":true}}}""",
            "not json",
            "[]",
        )) assertThrows(SetupLinkException::class.java, { parseSetupProfile(bad) }, bad)
    }

    @Test
    fun theTvTellsASetupLinkFromASignInAndReadsTheTypeScriptsBlobs() {
        var setups = 0
        var signins = 0
        for (row in vectors("link").filter { it.fn == "openLinkPayload" }) {
            val outcome = parseLinkOutcome(openLinkSecrets(sealed(row.args[0]), row.string(1), row.string(2)))
            val expected = row.out.jsonObject
            when (expected["kind"]!!.jsonPrimitive.content) {
                "setup" -> { setups += 1; assertEquals(expected["link"]!!.jsonPrimitive.content, (outcome as LinkSetup).link) }
                else -> { signins += 1; assertEquals(expected["email"]!!.jsonPrimitive.content, (outcome as LinkSecrets).email) }
            }
        }
        assertEquals(1 to 1, setups to signins)
        assertThrows(IllegalStateException::class.java) { parseLinkOutcome("""{"other":1}""") }
    }

    @Test
    fun base64UrlHasNoPaddingOrUnsafeCharacters() {
        val encoded = base64UrlEncode(ByteArray(32) { (it * 37 + 251).toByte() })
        assertEquals(43, encoded.length)
        assertTrue(encoded.none { it == '+' || it == '/' || it == '=' })
    }
}
