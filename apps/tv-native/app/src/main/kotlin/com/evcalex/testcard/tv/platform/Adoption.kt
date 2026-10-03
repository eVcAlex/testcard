package com.evcalex.testcard.tv.platform

import android.content.Context
import com.evcalex.testcard.core.SecretStore
import com.evcalex.testcard.core.adopt.SECURE_STORE_PREFS
import com.evcalex.testcard.core.adopt.openSecureStoreItem
import com.evcalex.testcard.core.adopt.secureStoreAlias
import com.evcalex.testcard.core.adopt.secureStoreKey
import com.evcalex.testcard.core.adopt.secureStoreReadable
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.sync.ACCOUNT_SECRET
import java.io.File
import java.security.KeyStore
import javax.crypto.SecretKey

/**
 * An update in place from the React Native app (same package name) keeps everything: its database is opened where it is, so the
 * React Native app can still open it if the update is rolled back, and its logins are re-sealed under this app's own key.
 * Nothing the old app wrote is changed or deleted. On any failure the database stays and the viewer signs in again.
 */
object Adoption {
    private const val ADOPTED_KEY = "adopted:secrets"

    /** The React Native app's database (expo-sqlite keeps databases in `files/SQLite`) when there is one, else this app's own. */
    fun databaseFile(context: Context): File {
        val adopted = File(context.filesDir, "SQLite/testcard.db")
        return if (adopted.exists()) adopted else context.getDatabasePath("testcard-native.db").also { it.parentFile?.mkdirs() }
    }

    /** Copies the account password and every source login from expo-secure-store into [secrets]. Once, when all of them verified. Off the main thread. */
    suspend fun adoptSecrets(context: Context, db: Db, secrets: SecretStore) {
        val prefs = context.getSharedPreferences(SECURE_STORE_PREFS, Context.MODE_PRIVATE)
        if (prefs.all.isEmpty()) return
        if (db.read { c -> c.one("SELECT value FROM schema_meta WHERE key = ?", ADOPTED_KEY) { it.getText(0) } } == "1") return
        val sourceIds = db.read { c -> c.query("SELECT id FROM sources WHERE kind = 'xtream'") { it.getText(0) } }
        val wanted = listOf("testcard.account-password" to ACCOUNT_SECRET) + sourceIds.map { "testcard.source.$it" to "source:$it" }
        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        var allDone = true
        for ((oldKey, newKey) in wanted) {
            val item = prefs.getString(secureStoreKey(oldKey), null) ?: prefs.getString(oldKey, null) ?: continue
            val done = runCatching {
                if (!secureStoreReadable(item)) error("not readable")
                val sealingKey = keystore.getKey(secureStoreAlias(item), null) as? SecretKey ?: error("no key")
                val plain = openSecureStoreItem(item, sealingKey)
                secrets.put(newKey, plain)
                check(secrets.get(newKey) == plain) { "did not verify" }
            }.isSuccess
            if (!done) allDone = false
        }
        if (allDone) db.write { it.run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, '1')", ADOPTED_KEY) }
    }
}
