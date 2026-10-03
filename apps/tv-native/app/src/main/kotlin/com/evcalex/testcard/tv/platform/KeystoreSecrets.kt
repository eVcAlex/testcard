package com.evcalex.testcard.tv.platform

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.evcalex.testcard.core.SecretStore
import com.evcalex.testcard.core.crypto.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Logins sealed with an AES-GCM key that lives in the Android Keystore and never leaves it; the sealed values sit in
 * SharedPreferences. Not for the main thread (the first read loads the preferences file).
 */
class KeystoreSecrets(private val context: Context) : SecretStore {
    private val prefs by lazy { context.getSharedPreferences("secrets", Context.MODE_PRIVATE) }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    @Synchronized
    override fun put(key: String, value: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        prefs.edit().putString(key, Base64.encode(cipher.iv) + ":" + Base64.encode(sealed)).apply()
    }

    @Synchronized
    override fun get(key: String): String? {
        val stored = prefs.getString(key, null) ?: return null
        val (iv, sealed) = stored.split(":", limit = 2)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv))) }
        return String(cipher.doFinal(Base64.decode(sealed)), Charsets.UTF_8)
    }

    @Synchronized
    override fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }

    private companion object {
        const val ALIAS = "testcard.secrets.v1"
    }
}
