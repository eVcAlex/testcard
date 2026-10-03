package com.evcalex.testcard.core

/**
 * Where logins live. The app implements it over the Android Keystore; tests use a map. Keys follow the React Native
 * app's (`source:<id>` holds a source's login JSON, `account` the sync account's), so adoption can carry them over.
 */
interface SecretStore {
    fun put(key: String, value: String)
    fun get(key: String): String?
    fun remove(key: String)
}

class MemorySecretStore : SecretStore {
    private val values = HashMap<String, String>()
    override fun put(key: String, value: String) { values[key] = value }
    override fun get(key: String): String? = values[key]
    override fun remove(key: String) { values.remove(key) }
}
