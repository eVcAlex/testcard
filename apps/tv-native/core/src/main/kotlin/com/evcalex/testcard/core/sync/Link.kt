package com.evcalex.testcard.core.sync

import com.evcalex.testcard.core.crypto.Base64
import com.evcalex.testcard.core.crypto.Sealed
import com.evcalex.testcard.core.crypto.deriveAesKey
import com.evcalex.testcard.core.crypto.open
import com.evcalex.testcard.core.crypto.pbkdf2Sha256
import com.evcalex.testcard.core.crypto.seal

const val LINK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const val LINK_CODE_LENGTH = 8
const val LINK_LOOKUP_SALT = "testcard-link-lookup-v1"
const val LINK_ITERATIONS = 210_000

/** 8 characters from an alphabet without look-alikes. 256 is a multiple of 32, so the remainder is not biased. */
fun generateLinkCode(randomBytes: ByteArray): String =
    randomBytes.take(LINK_CODE_LENGTH).map { LINK_ALPHABET[(it.toInt() and 0xff) % LINK_ALPHABET.length] }.joinToString("")

/** Upper case, without spaces or dashes: what was typed, ready to use. */
fun normaliseLinkCode(typed: String): String = typed.uppercase(java.util.Locale.ROOT).replace(Regex("[^A-Z0-9]"), "")

fun isValidLinkCode(code: String): Boolean = code.length == LINK_CODE_LENGTH && code.all { it in LINK_ALPHABET }

/** "K7M4-QX2P": how the code is shown. */
fun formatLinkCode(code: String): String = "${code.take(4)}-${code.drop(4)}"

/** What the server files the session under. */
fun deriveLinkLookup(code: String): String =
    Base64.encode(pbkdf2Sha256(code.toByteArray(Charsets.UTF_8), LINK_LOOKUP_SALT.toByteArray(Charsets.UTF_8), LINK_ITERATIONS))

/** Opens what the link page sealed: `{ "email": ..., "password": ... }`. Throws if the code is wrong. */
fun openLinkSecrets(sealed: Sealed, code: String, saltBase64: String): String =
    open(sealed, deriveAesKey(code, saltBase64, LINK_ITERATIONS))

/** `iv` is only given by tests. */
fun sealLinkSecrets(json: String, code: String, saltBase64: String, iv: ByteArray): Sealed =
    seal(json, deriveAesKey(code, saltBase64, LINK_ITERATIONS), iv)
