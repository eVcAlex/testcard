package com.evcalex.testcard.core.sync

import com.evcalex.testcard.core.SecretStore
import java.util.concurrent.ConcurrentHashMap
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** An Xtream login: a base URL, a user and a password. Kept in the secret store under `source:<id>`, never in the database. */
data class XtreamLogin(val baseUrl: String, val username: String, val password: String)

fun loadLogin(secrets: SecretStore, sourceId: String): XtreamLogin? {
    val stored = secrets.get("source:$sourceId") ?: return null
    val json = Json.parseToJsonElement(stored).jsonObject
    return XtreamLogin(json["baseUrl"]!!.jsonPrimitive.content, json["username"]!!.jsonPrimitive.content, json["password"]!!.jsonPrimitive.content)
}

fun saveLogin(secrets: SecretStore, sourceId: String, login: XtreamLogin) {
    secrets.put(
        "source:$sourceId",
        Json.encodeToString(JsonObject.serializer(), JsonObject(mapOf("baseUrl" to JsonPrimitive(login.baseUrl), "username" to JsonPrimitive(login.username), "password" to JsonPrimitive(login.password)))),
    )
}

/**
 * The logins of the sources (`platform/secrets.ts`). `stored` is the login with the source's main address: what sync
 * sends and what the source's form shows. `current` is the one to talk to the provider with: on the backup server in
 * use, when the main one is down (`ServerPicker`).
 */
class SourceLogins(private val secrets: SecretStore) {
    private val serverInUse = ConcurrentHashMap<String, String>()

    fun stored(sourceId: String): XtreamLogin = loadLogin(secrets, sourceId) ?: throw IllegalStateException("No stored credentials for source $sourceId")

    fun current(sourceId: String): XtreamLogin {
        val stored = stored(sourceId)
        val server = serverInUse[sourceId]
        return if (server != null) stored.copy(baseUrl = server) else stored
    }

    fun save(sourceId: String, login: XtreamLogin) = saveLogin(secrets, sourceId, login)

    fun delete(sourceId: String) = secrets.remove("source:$sourceId")

    fun setServerInUse(sourceId: String, baseUrl: String?) {
        if (baseUrl == null) serverInUse.remove(sourceId) else serverInUse[sourceId] = baseUrl
    }

    fun serverFor(sourceId: String): String? = serverInUse[sourceId]
}
