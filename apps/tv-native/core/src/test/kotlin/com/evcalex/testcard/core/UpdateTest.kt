package com.evcalex.testcard.core

import com.evcalex.testcard.core.update.UpdateInfo
import com.evcalex.testcard.core.update.downloadUpdate
import com.evcalex.testcard.core.update.parseManifest
import java.io.File
import java.io.IOException
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

/** The manifest rules of `update.ts` (UPD-01..04) and the download (a finished one is kept, a stalled one is given up). */
class UpdateTest {
    private val manifest = """{"versionCode":12,"versionName":"0.1.12","apks":{"firetv":"a.apk","firetvNative":"https://cdn.example/n.apk"},
        "notes":[{"versionCode":12,"versionName":"0.1.12","changes":["Faster"]},{"versionCode":11,"versionName":"0.1.11","changes":[]},{"versionCode":9,"versionName":"0.1.9","changes":["Old"]}]}"""

    @Test fun `a newer build is offered with the notes since the installed one`() {
        val info = parseManifest(manifest, 10, "firetv", "https://r/app")!!
        assertEquals(12, info.versionCode)
        assertEquals("https://r/app/a.apk", info.apkUrl)
        assertEquals(listOf("Faster"), info.notes.single().changes)
    }

    @Test fun `a full address is kept and the native key is read`() {
        assertEquals("https://cdn.example/n.apk", parseManifest(manifest, 10, "firetvNative", "https://r/app")!!.apkUrl)
    }

    @Test fun `the same or an older build, or no apk for this kind, is no update`() {
        assertNull(parseManifest(manifest, 12, "firetv", "b"))
        assertNull(parseManifest(manifest, 13, "firetv", "b"))
        assertNull(parseManifest(manifest, 1, "phone", "b"))
    }

    @Test fun `a manifest from before notes still offers the build`() {
        assertEquals(emptyList<Any>(), parseManifest("""{"versionCode":5,"versionName":"5","apks":{"firetv":"x.apk"}}""", 1, "firetv", "b")!!.notes)
    }

    private val info = UpdateInfo(3, "0.1.3", "", emptyList())

    @Test fun `a download is written whole and kept for the next try`(@TempDir cache: File) = MockWebServer().use { server ->
        server.enqueue(MockResponse().setBody("apk-bytes"))
        val seen = ArrayList<Float>()
        val file = runBlocking { downloadUpdate(OkHttpClient(), cache, UpdateInfo(3, "x", server.url("/a.apk").toString(), emptyList()), onProgress = { seen += it }) }
        assertEquals("apk-bytes", file.readText())
        assertEquals(1f, seen.last())
        assertFalse(File(cache, "testcard-3.apk.part").exists())
        // Second try: no second request.
        runBlocking { downloadUpdate(OkHttpClient(), cache, UpdateInfo(3, "x", server.url("/a.apk").toString(), emptyList()), onProgress = { }) }
        assertEquals(1, server.requestCount)
    }

    @Test fun `a download that stops moving is given up and leaves nothing behind`(@TempDir cache: File) = MockWebServer().use { server ->
        server.enqueue(MockResponse().setBody("partial").setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val error = assertThrows(IOException::class.java) {
            runBlocking { downloadUpdate(OkHttpClient(), cache, UpdateInfo(4, "x", server.url("/a.apk").toString(), emptyList()), stallMs = 300, onProgress = { }) }
        }
        assertTrue(error.message!!.contains("stopped moving"))
        assertEquals(0, cache.listFiles()!!.size)
    }

    @Test fun `an old download is cleared before a new one`(@TempDir cache: File) = MockWebServer().use { server ->
        File(cache, "testcard-1.apk").writeText("old")
        server.enqueue(MockResponse().setBody("new"))
        runBlocking { downloadUpdate(OkHttpClient(), cache, UpdateInfo(5, "x", server.url("/a.apk").toString(), emptyList()), onProgress = { }) }
        assertEquals(listOf("testcard-5.apk"), cache.list()!!.toList())
        assertNotNull(info)
    }
}
