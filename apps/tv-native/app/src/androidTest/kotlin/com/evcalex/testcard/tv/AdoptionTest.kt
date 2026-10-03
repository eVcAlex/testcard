package com.evcalex.testcard.tv

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import com.evcalex.testcard.core.MemorySecretStore
import com.evcalex.testcard.core.adopt.SECURE_STORE_PREFS
import com.evcalex.testcard.core.adopt.secureStoreKey
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.sync.ACCOUNT_SECRET
import com.evcalex.testcard.tv.platform.Adoption
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * A rehearsal of an update in place from the React Native app: entries sealed the way expo-secure-store seals them (an AES key in
 * the Keystore under its alias, JSON items in the `SecureStore` preferences) are carried into this app's own store, the old ones
 * are left as they were, and the work is not repeated.
 */
class AdoptionTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val alias = "AES/GCM/NoPadding:key_v1:keystoreUnauthenticated"
    private val prefs get() = context.getSharedPreferences(SECURE_STORE_PREFS, Context.MODE_PRIVATE)
    private lateinit var dbFile: File

    private fun store(key: String, value: String) {
        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val aes = keystore.getKey(alias, null) as javax.crypto.SecretKey
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, aes) }
        val ct = Base64.encodeToString(cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        prefs.edit().putString(secureStoreKey(key), """{"ct":"$ct","iv":"$iv","tlen":128,"scheme":"aes","usesKeystoreSuffix":true,"keystoreAlias":"key_v1","requireAuthentication":false}""").commit()
    }

    @Before fun seal() {
        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!keystore.containsAlias(alias)) {
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
            }.generateKey()
        }
        prefs.edit().clear().commit()
        store("testcard.account-password", "hunter2")
        store("testcard.source.s1", """{"baseUrl":"http://p:80","username":"u","password":"pw"}""")
        dbFile = File(context.cacheDir, "adoption-test.db").also { it.delete() }
    }

    @After fun clean() { prefs.edit().clear().commit(); dbFile.delete() }

    @Test fun logins_are_carried_over_once_and_the_old_entries_stay() {
        val db = Db(dbFile.path)
        runBlocking { db.write { it.run("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES ('s1', 'xtream', 'One', 'http://p:80', 1)") } }
        val secrets = MemorySecretStore()
        runBlocking { Adoption.adoptSecrets(context, db, secrets) }
        assertEquals("hunter2", secrets.get(ACCOUNT_SECRET))
        assertEquals("""{"baseUrl":"http://p:80","username":"u","password":"pw"}""", secrets.get("source:s1"))
        assertTrue(prefs.contains(secureStoreKey("testcard.account-password")))
        // Done: a later launch does not copy again, even over a changed value.
        secrets.remove(ACCOUNT_SECRET)
        runBlocking { Adoption.adoptSecrets(context, db, secrets) }
        assertNull(secrets.get(ACCOUNT_SECRET))
        db.close()
    }

    @Test fun an_unreadable_entry_is_left_for_the_next_launch() {
        prefs.edit().putString(secureStoreKey("testcard.account-password"), """{"scheme":"hybrid"}""").commit()
        val db = Db(dbFile.path)
        val secrets = MemorySecretStore()
        runBlocking { Adoption.adoptSecrets(context, db, secrets) }
        assertNull(secrets.get(ACCOUNT_SECRET))
        // Not marked done, so it is tried again.
        store("testcard.account-password", "hunter2")
        runBlocking { Adoption.adoptSecrets(context, db, secrets) }
        assertEquals("hunter2", secrets.get(ACCOUNT_SECRET))
        db.close()
    }

    @Test fun the_react_native_database_is_used_where_it_is() {
        val own = Adoption.databaseFile(context)
        assertTrue(own.name == "testcard-native.db")
        val adopted = File(context.filesDir, "SQLite/testcard.db").also { it.parentFile!!.mkdirs(); it.writeText("") }
        try { assertEquals(adopted.path, Adoption.databaseFile(context).path) } finally { adopted.delete() }
    }
}
