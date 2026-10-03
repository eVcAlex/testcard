package com.evcalex.testcard.core.crypto

import java.security.MessageDigest

private fun digestHex(algorithm: String, text: String): String =
    MessageDigest.getInstance(algorithm).digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

fun sha1Hex(text: String): String = digestHex("SHA-1", text)

fun sha256Hex(text: String): String = digestHex("SHA-256", text)

/** Two FNV-1a passes with different seeds over UTF-16 code units: 16 hex chars. Port of `hash64` in `channelHistory.ts`. */
fun hash64(text: String): String {
    var a = 0x811c9dc5.toInt()
    var b = 0x9747b28c.toInt()
    for (char in text) {
        val code = char.code
        a = (a xor code) * 0x01000193
        b = (b xor code) * 0x01000193
    }
    return "%08x%08x".format(a.toLong() and 0xffffffffL, b.toLong() and 0xffffffffL)
}
