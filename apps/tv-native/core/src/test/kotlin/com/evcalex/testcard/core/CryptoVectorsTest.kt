package com.evcalex.testcard.core

import com.evcalex.testcard.core.crypto.AccountKeys
import com.evcalex.testcard.core.crypto.Base64
import com.evcalex.testcard.core.crypto.Sealed
import com.evcalex.testcard.core.crypto.open
import com.evcalex.testcard.core.crypto.seal
import com.evcalex.testcard.core.sync.channelKeyFor
import com.evcalex.testcard.core.sync.deriveLinkLookup
import com.evcalex.testcard.core.sync.formatLinkCode
import com.evcalex.testcard.core.sync.generateLinkCode
import com.evcalex.testcard.core.sync.isValidLinkCode
import com.evcalex.testcard.core.sync.normaliseLinkCode
import com.evcalex.testcard.core.sync.normalizeProviderHost
import com.evcalex.testcard.core.sync.openLinkSecrets
import com.evcalex.testcard.core.sync.remoteKeyFor
import com.evcalex.testcard.core.sync.remoteKeyForPlaylist
import com.evcalex.testcard.core.sync.remoteKeyForPlaylistItem
import com.evcalex.testcard.core.sync.sealLinkSecrets
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

/** Every crypto, key and link vector produced by the TypeScript core must come out the same here. */
class CryptoVectorsTest {
    // The script fixes crypto.getRandomValues to these bytes: (i * 37 + 11) & 0xff.
    private val fixedBytes = ByteArray(64) { ((it * 37 + 11) and 0xff).toByte() }

    private fun sealed(element: kotlinx.serialization.json.JsonElement): Sealed =
        Sealed(element.jsonObject["blob"]!!.jsonPrimitive.content, element.jsonObject["iv"]!!.jsonPrimitive.content)

    @Test
    fun base64RoundTrips() {
        for (size in 0..40) {
            val bytes = ByteArray(size) { (it * 7).toByte() }
            assertEquals(java.util.Base64.getEncoder().encodeToString(bytes), Base64.encode(bytes))
            assertEquals(bytes.toList(), Base64.decode(Base64.encode(bytes)).toList())
        }
    }

    @Test
    fun accountSealingMatches() {
        val keys = AccountKeys()
        for (row in vectors("crypto")) {
            when (row.fn) {
                "encryptJson" -> {
                    val key = keys.keyFor(row.string(1), row.string(2))
                    val expected = sealed(row.out)
                    // Same plaintext bytes, same IV: the blob must be identical, not just decryptable.
                    val actual = seal(row.args[0].toString(), key, Base64.decode(expected.iv))
                    assertEquals(expected, actual, row.args[0].toString())
                }
                "decryptJson" -> {
                    val key = keys.keyFor(row.string(1), row.string(2))
                    val plain = open(sealed(row.args[0]), key)
                    assertEquals(row.out, Json.parseToJsonElement(plain))
                }
            }
        }
    }

    @Test
    fun linkVectorsMatch() {
        for (row in vectors("link")) {
            when (row.fn) {
                "sealLinkSecrets" -> {
                    val secrets = row.obj(0)
                    val expected = sealed(row.out)
                    val actual = sealLinkSecrets(secrets.toString(), row.string(1), row.string(2), Base64.decode(expected.iv))
                    assertEquals(expected, actual)
                }
                "openLinkSecrets" -> {
                    val plain = openLinkSecrets(sealed(row.args[0]), row.string(1), row.string(2))
                    assertEquals(row.out, Json.parseToJsonElement(plain))
                }
                "deriveLinkLookup" -> assertEquals(row.out.jsonPrimitive.content, deriveLinkLookup(row.string(0)))
                "generateLinkCode" -> assertEquals(row.out.jsonPrimitive.content, generateLinkCode(fixedBytes))
                "normaliseLinkCode" -> assertEquals(row.out.jsonPrimitive.content, normaliseLinkCode(row.string(0)))
                "isValidLinkCode" -> assertEquals(row.out.jsonPrimitive.boolean, isValidLinkCode(row.string(0)))
                "formatLinkCode" -> assertEquals(row.out.jsonPrimitive.content, formatLinkCode(row.string(0)))
            }
        }
    }

    @Test
    fun aWrongCodeOrAlteredBlobFails() {
        val sealedValue = sealLinkSecrets("{}", "ABCD2345", "CzBVep/E6Q4zWH2ix+wRNg==", fixedBytes.copyOf(12))
        assertThrows(Exception::class.java) { openLinkSecrets(sealedValue, "ABCD2346", "CzBVep/E6Q4zWH2ix+wRNg==") }
    }

    @Test
    fun keyVectorsMatch() {
        for (row in vectors("keys")) {
            val expected = row.out.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val actual = when (row.fn) {
                "normalizeProviderHost" -> normalizeProviderHost(row.string(0))
                "remoteKeyFor" -> remoteKeyFor(row.string(0), row.string(1))
                "remoteKeyForPlaylist" -> remoteKeyForPlaylist(row.string(0))
                "remoteKeyForPlaylistItem" -> remoteKeyForPlaylistItem(row.string(0), row.string(1))
                "channelKeyFor" -> channelKeyFor(row.string(0), row.string(1), row.string(2))
                else -> continue
            }
            assertEquals(expected, actual, "${row.fn} ${row.args}")
        }
    }
}
