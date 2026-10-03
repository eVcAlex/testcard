package com.evcalex.testcard.core.sync

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dispatcher
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

const val SYNC_BASE_URL = "https://testcard-sync.evcalex.workers.dev"

/** Non-2xx from the Worker. `message` is the server's own words, as `serverMessage` in the TS controller reads them. */
class ApiException(val status: Int, message: String) : IOException(message)

data class AuthResult(val userId: String, val sessionToken: String)

private val JSON_TYPE = "application/json".toMediaType()

/**
 * The auth and sync routes of the Worker over OkHttp, with the headers and timeout of `sync/client.ts`: an `Origin`
 * equal to the base URL (better-auth's CSRF check), a Bearer token on authed calls, 15 s for the whole call, and the
 * `node` user agent. It owns its dispatcher, so `abortAll` cuts off only its own calls.
 */
class SyncApi(
    private val baseUrl: String = SYNC_BASE_URL,
    http: OkHttpClient = OkHttpClient(),
    private val sessionToken: () -> String? = { null },
) {
    private val http = http.newBuilder().dispatcher(Dispatcher()).callTimeout(15, TimeUnit.SECONDS).build()

    /** Cancels every request under way, so a caller that must wait for the sync to stop does not wait on the network. */
    fun abortAll() = http.dispatcher.cancelAll()

    private suspend fun request(path: String, body: String? = null, authed: Boolean = false, missingIsFine: Boolean = false): Response {
        val builder = Request.Builder().url(baseUrl + path).header("Origin", baseUrl).header("User-Agent", "node")
        if (authed) sessionToken()?.let { builder.header("Authorization", "Bearer $it") }
        if (body != null) builder.post(body.toRequestBody(JSON_TYPE))
        val response = http.newCall(builder.build()).await()
        if (response.isSuccessful || (response.code == 404 && missingIsFine)) return response
        val reply = response.use { runCatching { it.body.string() }.getOrDefault("") }
        throw ApiException(response.code, reply.ifEmpty { "${response.code} ${response.message}" })
    }

    private fun auth(reply: JsonObject) = AuthResult(((reply["user"] as JsonObject)["id"] as JsonPrimitive).content, (reply["token"] as JsonPrimitive).content)

    private suspend fun authCall(path: String, body: JsonObject) = request(path, body.toString()).use { auth(wireJson.parseToJsonElement(it.body.string()) as JsonObject) }

    suspend fun signUp(email: String, password: String): AuthResult =
        // better-auth's core user schema requires `name`; the email itself stands in for it.
        authCall("/auth/sign-up/email", buildJsonObject { put("email", email); put("password", password); put("name", email) })

    suspend fun signIn(email: String, password: String): AuthResult =
        authCall("/auth/sign-in/email", buildJsonObject { put("email", email); put("password", password) })

    suspend fun signOut() { request("/auth/sign-out", "{}", authed = true).close() }

    /** The account's PBKDF2 salt, or null if none is set yet. */
    suspend fun getSalt(): String? {
        val response = request("/sync/salt", authed = true, missingIsFine = true)
        return response.use { if (it.code == 404) null else ((wireJson.parseToJsonElement(it.body.string()) as JsonObject)["salt"] as JsonPrimitive).content }
    }

    /** Set-once: call only right after `signUp`, with a freshly generated salt. */
    suspend fun setSalt(salt: String) { request("/sync/salt", buildJsonObject { put("salt", salt) }.toString(), authed = true).close() }

    /** Tells the Worker a public guide address; answers the name of the file its daily job builds for it. */
    suspend fun registerGuide(url: String): String =
        request("/guides/register", buildJsonObject { put("url", url) }.toString(), authed = true).use { ((wireJson.parseToJsonElement(it.body.string()) as JsonObject)["file"] as JsonPrimitive).content }

    /** `profile`: whose favourites, recents and progress to fetch; Main's (unprefixed) when left out. */
    suspend fun pull(since: Long, profile: String? = null): PullResponse {
        val query = "?since=$since" + if (profile != null) "&profile=${java.net.URLEncoder.encode(profile, "UTF-8")}" else ""
        return request("/sync/pull$query", authed = true).use { wireJson.decodeFromString(PullResponse.serializer(), it.body.string()) }
    }

    suspend fun push(changes: PushRequest): PushResponse =
        request("/sync/push", wireJson.encodeToString(PushRequest.serializer(), changes), authed = true).use { wireJson.decodeFromString(PushResponse.serializer(), it.body.string()) }
}

/** The server's own message from a JSON error body (`{"message": ...}` / `{"error": ...}`), if it sent one. */
fun serverMessage(error: Throwable): String? {
    val text = error.message ?: return null
    return try {
        val body = Json.parseToJsonElement(text) as? JsonObject ?: return null
        (body["message"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: (body["error"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    } catch (_: Exception) {
        null
    }
}

internal suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { continuation.resumeWithException(e) }
        override fun onResponse(call: Call, response: Response) { continuation.resume(response) }
    })
}
