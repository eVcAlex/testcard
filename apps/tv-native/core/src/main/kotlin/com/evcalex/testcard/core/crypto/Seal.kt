package com.evcalex.testcard.core.crypto

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

const val ACCOUNT_ITERATIONS = 210_000
private const val IV_BYTES = 12

/** A sealed value as it travels: base64 ciphertext with the 128-bit tag appended, and the base64 IV. */
data class Sealed(val blob: String, val iv: String)

private val random = SecureRandom()

fun randomBytes(count: Int): ByteArray = ByteArray(count).also(random::nextBytes)

fun deriveAesKey(password: String, saltBase64: String, iterations: Int = ACCOUNT_ITERATIONS): ByteArray =
    pbkdf2Sha256(password.toByteArray(Charsets.UTF_8), Base64.decode(saltBase64), iterations)

/** `iv` is only given by tests, to reproduce a TypeScript blob exactly. */
fun seal(plaintext: String, key: ByteArray, iv: ByteArray = randomBytes(IV_BYTES)): Sealed {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
    return Sealed(Base64.encode(cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))), Base64.encode(iv))
}

/** Throws if the key is wrong or the blob was altered. */
fun open(sealed: Sealed, key: ByteArray): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, Base64.decode(sealed.iv)))
    return String(cipher.doFinal(Base64.decode(sealed.blob)), Charsets.UTF_8)
}

/** Derives the account key once per password and salt, like the TS cache: 210,000 rounds is slow on a Fire Stick. */
class AccountKeys {
    private var last: Triple<String, String, ByteArray>? = null

    @Synchronized
    fun keyFor(password: String, saltBase64: String): ByteArray {
        last?.let { (p, s, key) -> if (p == password && s == saltBase64) return key }
        return deriveAesKey(password, saltBase64).also { last = Triple(password, saltBase64, it) }
    }
}
