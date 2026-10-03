package com.evcalex.testcard.core.sync

import com.evcalex.testcard.core.crypto.Base64
import com.evcalex.testcard.core.crypto.Sealed
import com.evcalex.testcard.core.crypto.randomBytes
import com.evcalex.testcard.core.nowMs
import java.io.IOException
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import kotlin.coroutines.coroutineContext

/** What the link page sealed: the person's sign-in. */
class LinkSecrets(val email: String, val password: String)

class LinkExpiredException : Exception("The code ran out.")

fun generateLinkSalt(): String = Base64.encode(randomBytes(16))

/** The TV's side of signing in with a code: ask the server for a session, show the code, wait for the page to answer (`linkSession.ts`). */
class LinkSession(
    /** Eight characters, as stored; show it with `formatLinkCode`. */
    val code: String,
    /** Epoch ms when the server forgets the code. */
    val expiresAt: Long,
    private val baseUrl: String,
    private val lookup: String,
    private val salt: String,
    private val http: OkHttpClient,
    private val pollEveryMs: Long,
    private val now: () -> Long,
) {
    /** Resolves with the person's sign-in once the page has sent it. Throws `LinkExpiredException` when the code runs out. */
    suspend fun waitForApproval(): LinkSecrets {
        while (true) {
            coroutineContext.ensureActive()
            val reply = try {
                http.newCall(Request.Builder().url("$baseUrl/link/poll?lookup=${URLEncoder.encode(lookup, "UTF-8")}").header("User-Agent", "node").build()).await()
            } catch (_: IOException) {
                // A dropped connection is not the end: the next poll tries again, until the code runs out.
                null
            }
            if (reply != null) {
                val outcome = reply.use {
                    if (it.code == 404) throw LinkExpiredException()
                    if (!it.isSuccessful) return@use null
                    val body = Json.parseToJsonElement(it.body.string()) as JsonObject
                    val blob = (body["blob"] as? JsonPrimitive)?.content
                    val iv = (body["iv"] as? JsonPrimitive)?.content
                    if ((body["status"] as? JsonPrimitive)?.content == "ready" && blob != null && iv != null) Sealed(blob, iv) else null
                }
                if (outcome != null) return withContext(Dispatchers.Default) { openSecrets(outcome) }
            }
            if (now() >= expiresAt) throw LinkExpiredException()
            delay(pollEveryMs)
        }
    }

    private fun openSecrets(sealed: Sealed): LinkSecrets {
        val parsed = Json.parseToJsonElement(openLinkSecrets(sealed, code, salt)) as JsonObject
        val email = (parsed["email"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val password = (parsed["password"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (email == null || password == null) throw IllegalStateException("The link did not carry a sign-in.")
        return LinkSecrets(email, password)
    }
}

/** Asks the server for a link session. A 409 is the one-in-a-trillion case of a live code that is already taken: the caller just asks again. */
suspend fun startLinkSession(baseUrl: String = SYNC_BASE_URL, http: OkHttpClient = OkHttpClient(), pollEveryMs: Long = 2000, now: () -> Long = ::nowMs): LinkSession {
    val code = com.evcalex.testcard.core.crypto.randomBytes(LINK_CODE_LENGTH).let(::generateLinkCode)
    val salt = generateLinkSalt()
    val lookup = withContext(Dispatchers.Default) { deriveLinkLookup(code) }
    val body = buildJsonObject { put("lookup", lookup); put("salt", salt) }.toString().toRequestBody("application/json".toMediaType())
    val started = try {
        http.newCall(Request.Builder().url("$baseUrl/link/start").header("User-Agent", "node").post(body).build()).await()
    } catch (_: IOException) {
        throw IllegalStateException("Could not reach Testcard.")
    }
    val expiresAt = started.use {
        if (!it.isSuccessful) throw IllegalStateException(if (it.code == 409) "Try again." else "Could not reach Testcard.")
        ((Json.parseToJsonElement(it.body.string()) as JsonObject)["expiresAt"] as JsonPrimitive).content.toDouble().toLong()
    }
    return LinkSession(code, expiresAt, baseUrl, lookup, salt, http, pollEveryMs, now)
}
