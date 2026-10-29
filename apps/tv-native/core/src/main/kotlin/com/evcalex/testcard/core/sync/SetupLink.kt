package com.evcalex.testcard.core.sync

import com.evcalex.testcard.core.crypto.Base64
import com.evcalex.testcard.core.crypto.Sealed
import java.io.IOException
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * A source shared by link, as the TV receives it (`setupCrypto.ts`, `sync-schema/setup.ts`; both must agree on
 * `test-vectors/setup.json`). The phone hands the TV the link sealed under the TV's code; the TV claims the sealed source from
 * the Worker with a proof derived from the link's secret, opens it, and validates it strictly before anything is added. Nothing
 * here is logged.
 */
class SetupFragment(val id: String, val secret: String)

private val FRAGMENT = Regex("^#?([A-Za-z0-9_-]{22})\\.([A-Za-z0-9_-]{43})\\z")

/** Reads `<id>.<secret>`, with or without a leading `#`; null for anything else. */
fun parseSetupFragment(text: String): SetupFragment? {
    val match = FRAGMENT.find(text.trim()) ?: return null
    return SetupFragment(match.groupValues[1], match.groupValues[2])
}

/** Base64url without padding, as `toBase64Url` in sync-schema writes it. */
fun base64UrlEncode(bytes: ByteArray): String = Base64.encode(bytes).replace('+', '-').replace('/', '_').trimEnd('=')

fun base64UrlDecode(text: String): ByteArray = Base64.decode(text.replace('-', '+').replace('_', '/'))

private fun hmac(key: ByteArray, data: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run {
    init(SecretKeySpec(key, "HmacSHA256"))
    doFinal(data)
}

/** HKDF-SHA256 with an empty salt, as WebCrypto's `HKDF` with `salt: new Uint8Array(0)` derives (RFC 5869); one block is all 32 bytes need. */
internal fun hkdfSha256(secret: ByteArray, info: String): ByteArray {
    val prk = hmac(ByteArray(32), secret)
    return hmac(prk, info.toByteArray(Charsets.UTF_8) + byteArrayOf(1))
}

private const val CLAIM_INFO = "testcard-setup-claim-v1"
private const val SEAL_INFO = "testcard-setup-seal-v1"

/** What the Worker is shown to hand over the sealed source, and the hash of it that the sender registered. */
class SetupProof(val proof: String, val claimHash: String)

fun setupProof(secret: String): SetupProof {
    val proof = hkdfSha256(base64UrlDecode(secret), CLAIM_INFO)
    return SetupProof(base64UrlEncode(proof), base64UrlEncode(MessageDigest.getInstance("SHA-256").digest(proof)))
}

/** A refusal in words fit to show. */
class SetupLinkException(message: String) : Exception(message)

sealed interface SetupSource {
    val epgUrl: String?
    val content: SourceContent?

    class Xtream(val host: String, val username: String, val password: String, val backupHosts: List<String>, override val epgUrl: String?, override val content: SourceContent?) : SetupSource
    class Playlist(val playlistUrl: String, override val epgUrl: String?, override val content: SourceContent?) : SetupSource
}

class SetupProfile(val name: String, val epgOptimise: Boolean, val source: SetupSource)

/** The provider's host name only, for showing the person: a playlist address may hold a login in its query. */
fun SetupSource.displayHost(): String = when (this) {
    is SetupSource.Xtream -> host
    is SetupSource.Playlist -> playlistUrl
}.toHttpUrlOrNull()?.host ?: ""

private fun bad(): Nothing = throw SetupLinkException("This link is damaged or incomplete. Ask whoever sent it for a new one.")

private fun JsonObject.onlyKeys(vararg allowed: String) {
    if (!keys.all { it in allowed }) bad()
}

private fun JsonObject.text(key: String, max: Int): String? {
    val value = this[key] ?: return null
    val text = (value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: bad()
    if (text.isEmpty() || text.length > max) bad()
    return text
}

private fun JsonObject.address(key: String): String? = text(key, 2048)?.also { value ->
    val url = value.toHttpUrlOrNull() ?: bad()
    if (url.scheme != "http" && url.scheme != "https") bad()
}

private fun JsonObject.content(): SourceContent? {
    val obj = this["content"] ?: return null
    if (obj !is JsonObject) bad()
    obj.onlyKeys("live", "movies", "series")
    fun flag(key: String) = (obj[key] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: bad()
    return SourceContent(flag("live"), flag("movies"), flag("series"))
}

/** Reads and validates the opened source the way `SetupProfilePayloadSchema` does: strict, one source, http(s) addresses only. */
fun parseSetupProfile(json: String): SetupProfile {
    val root = (try { Json.parseToJsonElement(json) } catch (_: Exception) { bad() }) as? JsonObject ?: bad()
    root.onlyKeys("v", "name", "epgOptimise", "source")
    if ((root["v"] as? JsonPrimitive)?.content != "1") bad()
    val name = root.text("name", 60)?.trim()?.takeIf { it.isNotEmpty() } ?: bad()
    val optimise = root["epgOptimise"]?.let { (it as? JsonPrimitive)?.takeIf { p -> !p.isString }?.booleanOrNull ?: bad() } ?: false
    val source = root["source"] as? JsonObject ?: bad()
    val parsed: SetupSource = if ("playlistUrl" in source) {
        source.onlyKeys("playlistUrl", "epgUrl", "content")
        SetupSource.Playlist(source.address("playlistUrl") ?: bad(), source.address("epgUrl"), source.content())
    } else {
        source.onlyKeys("host", "username", "password", "backupHosts", "epgUrl", "content")
        val backups = source["backupHosts"]?.let { element ->
            val array = element as? JsonArray ?: bad()
            if (array.size > 10) bad()
            array.map { item ->
                val text = (item as? JsonPrimitive)?.takeIf { it.isString }?.content ?: bad()
                if (text.length > 2048) bad()
                val url = text.toHttpUrlOrNull() ?: bad()
                if (url.scheme != "http" && url.scheme != "https") bad()
                text
            }
        } ?: emptyList()
        SetupSource.Xtream(source.address("host") ?: bad(), source.text("username", 256) ?: bad(), source.text("password", 256) ?: bad(), backups, source.address("epgUrl"), source.content())
    }
    return SetupProfile(name, optimise, parsed)
}

/** Opens the sealed source the Worker returned; bound to the link's id, so a blob moved to another profile does not open. Throws [SetupLinkException]. */
fun openSetupProfile(sealed: Sealed, link: SetupFragment): SetupProfile {
    val plain = try {
        val key = hkdfSha256(base64UrlDecode(link.secret), SEAL_INFO)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, Base64.decode(sealed.iv)))
        cipher.updateAAD(link.id.toByteArray(Charsets.UTF_8))
        String(cipher.doFinal(Base64.decode(sealed.blob)), Charsets.UTF_8)
    } catch (_: Exception) {
        bad()
    }
    return parseSetupProfile(plain)
}

/**
 * Claims the link with the Worker (one use is counted) and opens what it returns. Unknown, wrong, expired, withdrawn and used up all
 * look the same from here, as they do to anyone else.
 */
suspend fun claimSetupLink(link: SetupFragment, baseUrl: String = SYNC_BASE_URL, http: OkHttpClient = OkHttpClient()): SetupProfile {
    val body = buildJsonObject { put("id", link.id); put("proof", setupProof(link.secret).proof) }.toString().toRequestBody("application/json".toMediaType())
    val response = try {
        http.newCall(Request.Builder().url("$baseUrl/share/claim").header("User-Agent", "node").post(body).build()).await()
    } catch (_: IOException) {
        throw SetupLinkException("Couldn't reach Testcard. Check your connection and try again.")
    }
    val text = response.use {
        if (it.code == 429) throw SetupLinkException("Too many tries. Wait a while and try again.")
        if (!it.isSuccessful) throw SetupLinkException("This link has expired, has already been used, or was withdrawn. Ask whoever sent it for a new one.")
        it.body.string()
    }
    val parsed = try { Json.parseToJsonElement(text) as JsonObject } catch (_: Exception) { bad() }
    val blob = (parsed["blob"] as? JsonPrimitive)?.content ?: bad()
    val iv = (parsed["iv"] as? JsonPrimitive)?.content ?: bad()
    return withContext(Dispatchers.Default) { openSetupProfile(Sealed(blob, iv), link) }
}
