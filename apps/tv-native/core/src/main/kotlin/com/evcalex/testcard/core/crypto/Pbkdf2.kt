package com.evcalex.testcard.core.crypto

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * PBKDF2-HMAC-SHA256 over `Mac`, because `PBKDF2WithHmacSHA256` is missing below API 26. One 32-byte block is all the
 * app ever asks for (a 256-bit key), so there is no block loop.
 */
fun pbkdf2Sha256(password: ByteArray, salt: ByteArray, iterations: Int): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    // An empty password cannot be a SecretKeySpec; refuse it here rather than fail inside the JCA.
    require(password.isNotEmpty()) { "password must not be empty" }
    mac.init(SecretKeySpec(password, "HmacSHA256"))
    var u = mac.doFinal(salt + byteArrayOf(0, 0, 0, 1))
    val result = u.copyOf()
    for (round in 1 until iterations) {
        u = mac.doFinal(u)
        for (index in result.indices) result[index] = (result[index].toInt() xor u[index].toInt()).toByte()
    }
    return result
}
