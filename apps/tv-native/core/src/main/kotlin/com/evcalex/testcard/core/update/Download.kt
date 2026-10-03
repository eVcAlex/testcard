package com.evcalex.testcard.core.update

import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/** A download that has not moved for this long is given up, rather than sitting at one percentage for good. */
const val STALL_MS = 45_000L

fun apkFile(cache: File, info: UpdateInfo) = File(cache, "testcard-${info.versionCode}.apk")

/**
 * Downloads the APK, once: a finished download is kept, so a second try (after allowing installs, say) goes straight to the
 * installer. Written under another name until it is whole, so a cut-off download is never taken for one.
 */
suspend fun downloadUpdate(http: OkHttpClient, cache: File, info: UpdateInfo, stallMs: Long = STALL_MS, onProgress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
    val file = apkFile(cache, info)
    if (file.exists() && file.length() > 0) { onProgress(1f); return@withContext file }
    cache.listFiles()?.forEach { if (Regex("^testcard-.*\\.apk(\\.part)?$").matches(it.name)) it.delete() }
    val part = File(cache, "testcard-${info.versionCode}.apk.part")
    var whole = false
    try {
        // A read that waits this long with no bytes is the stall.
        val client = http.newBuilder().readTimeout(stallMs, TimeUnit.MILLISECONDS).build()
        try {
            client.newCall(Request.Builder().url(info.apkUrl).build()).execute().use { response ->
                if (!response.isSuccessful) throw IOException("The download failed (${response.code}).")
                val total = response.body.contentLength()
                var written = 0L
                response.body.byteStream().use { input ->
                    part.outputStream().use { output ->
                        val buffer = ByteArray(1 shl 16)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            written += read
                            onProgress(if (total > 0) written.toFloat() / total else 0f)
                        }
                    }
                }
                if (total > 0 && written != total) throw IOException("The download did not finish.")
            }
        } catch (error: java.net.SocketTimeoutException) {
            throw IOException("The download stopped moving. Check the connection and try again.", error)
        }
        if (!part.exists() || part.length() == 0L) throw IOException("The download did not finish.")
        if (!part.renameTo(file)) throw IOException("The download did not finish.")
        whole = true
        file
    } finally {
        if (!whole && part.exists()) part.delete()
    }
}
