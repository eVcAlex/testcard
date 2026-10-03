package com.evcalex.testcard.core.adopt

import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The React Native app kept its secrets with expo-secure-store; this reads what that wrote so an update in place keeps the logins. */
const val SECURE_STORE_PREFS = "SecureStore"

/** expo-secure-store's default keychain service, the one every entry the app wrote is under. */
const val SECURE_STORE_SERVICE = "key_v1"

/** The preference key an entry is stored under (`createKeychainAwareKey`). */
fun secureStoreKey(key: String) = "$SECURE_STORE_SERVICE-$key"

/** The Keystore alias of the AES key that sealed an entry: the extended alias for current entries, the plain one for old ones. */
fun secureStoreAlias(item: String): String {
    val extended = Json.parseToJsonElement(item).jsonObject["usesKeystoreSuffix"]?.jsonPrimitive?.booleanOrNull == true
    return "AES/GCM/NoPadding:$SECURE_STORE_SERVICE" + if (extended) ":keystoreUnauthenticated" else ""
}

/** Whether the stored item is one this can read: sealed with the AES scheme and not behind a fingerprint. */
fun secureStoreReadable(item: String): Boolean {
    val json = Json.parseToJsonElement(item).jsonObject
    return json["scheme"]?.jsonPrimitive?.contentOrNull == "aes" && json["requireAuthentication"]?.jsonPrimitive?.booleanOrNull != true
}

/** Opens one stored item (`AESEncryptor.decryptItem`) with the key that sealed it. */
fun openSecureStoreItem(item: String, key: SecretKey): String {
    val json = Json.parseToJsonElement(item).jsonObject
    val sealed = Base64.getMimeDecoder().decode(json["ct"]!!.jsonPrimitive.content)
    val iv = Base64.getMimeDecoder().decode(json["iv"]!!.jsonPrimitive.content)
    val tagBits = json["tlen"]!!.jsonPrimitive.intOrNull ?: 128
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(tagBits, iv)) }
    return String(cipher.doFinal(sealed), Charsets.UTF_8)
}
