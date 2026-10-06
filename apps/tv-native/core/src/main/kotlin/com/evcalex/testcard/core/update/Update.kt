package com.evcalex.testcard.core.update

import com.evcalex.testcard.core.sync.await
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request

class ReleaseNote(val versionName: String, val changes: List<String>)

class UpdateInfo(val versionCode: Int, val versionName: String, val apkUrl: String, /** What changed in each build newer than this one, newest first. */ val notes: List<ReleaseNote>)

/**
 * The newer build named by a manifest (`update.ts` `checkForUpdate`), or null when this one is current. [apkKey] is the
 * manifest entry for this kind of install: the native beta reads `firetvNative`, after cutover it reads `firetv`.
 */
fun parseManifest(body: String, installed: Int, apkKey: String, baseUrl: String): UpdateInfo? {
    val manifest = Json.parseToJsonElement(body).jsonObject
    val versionCode = manifest["versionCode"]?.jsonPrimitive?.intOrNull ?: return null
    val apk = manifest["apks"]?.jsonObject?.get(apkKey)?.jsonPrimitive?.contentOrNull
    if (apk == null || versionCode <= installed) return null
    val notes = ((manifest["notes"] as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { entry ->
        val note = entry as? JsonObject ?: return@mapNotNull null
        val code = note["versionCode"]?.jsonPrimitive?.intOrNull ?: return@mapNotNull null
        val changes = (note["changes"] as? JsonArray)?.map { it.jsonPrimitive.content } ?: return@mapNotNull null
        if (code > installed && changes.isNotEmpty()) ReleaseNote(note["versionName"]?.jsonPrimitive?.contentOrNull ?: "", changes) else null
    }
    return UpdateInfo(versionCode, manifest["versionName"]?.jsonPrimitive?.contentOrNull ?: "", if (apk.startsWith("http")) apk else "$baseUrl/$apk", notes)
}

/** Reads the manifest from the release server. Throws a message to show when it cannot. */
suspend fun checkForUpdate(http: OkHttpClient, baseUrl: String, installed: Int, apkKey: String, manifest: String = "latest.json"): UpdateInfo? {
    val request = Request.Builder().url("$baseUrl/$manifest").header("cache-control", "no-cache").build()
    val call = http.newBuilder().callTimeout(20, java.util.concurrent.TimeUnit.SECONDS).build().newCall(request)
    val response = try { call.await() } catch (error: java.io.InterruptedIOException) { throw IllegalStateException("The update server took too long to answer.", error) }
    return response.use { response ->
        if (!response.isSuccessful) throw IllegalStateException("The update check failed (${response.code}).")
        parseManifest(response.body.string(), installed, apkKey, baseUrl)
    }
}
