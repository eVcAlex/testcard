package com.evcalex.testcard.core.crypto

private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
private val REVERSE = IntArray(128) { -1 }.also { table -> ALPHABET.forEachIndexed { index, char -> table[char.code] = index } }

/**
 * Standard-alphabet Base64 with padding and no line breaks, as `btoa` writes it. Our own because `java.util.Base64`
 * is API 26+ and the app supports 24.
 */
object Base64 {
    fun encode(bytes: ByteArray): String {
        val out = StringBuilder((bytes.size + 2) / 3 * 4)
        var i = 0
        while (i < bytes.size) {
            val b0 = bytes[i].toInt() and 0xff
            val b1 = if (i + 1 < bytes.size) bytes[i + 1].toInt() and 0xff else 0
            val b2 = if (i + 2 < bytes.size) bytes[i + 2].toInt() and 0xff else 0
            out.append(ALPHABET[b0 shr 2])
            out.append(ALPHABET[((b0 and 3) shl 4) or (b1 shr 4)])
            out.append(if (i + 1 < bytes.size) ALPHABET[((b1 and 15) shl 2) or (b2 shr 6)] else '=')
            out.append(if (i + 2 < bytes.size) ALPHABET[b2 and 63] else '=')
            i += 3
        }
        return out.toString()
    }

    /** Like `atob`: whitespace is ignored, padding is optional, anything else outside the alphabet is an error. */
    fun decode(text: String): ByteArray {
        val out = java.io.ByteArrayOutputStream(text.length * 3 / 4)
        var buffer = 0
        var bits = 0
        for (char in text) {
            if (char == '=' || char.isWhitespace()) continue
            val value = if (char.code < 128) REVERSE[char.code] else -1
            require(value >= 0) { "Not Base64" }
            buffer = ((buffer shl 6) or value) and 0xffff
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.write((buffer shr bits) and 0xff)
            }
        }
        return out.toByteArray()
    }
}
