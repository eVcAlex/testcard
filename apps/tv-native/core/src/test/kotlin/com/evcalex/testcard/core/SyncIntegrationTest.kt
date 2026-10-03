package com.evcalex.testcard.core

import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.recordMovieRecent
import com.evcalex.testcard.core.db.recordRecent
import com.evcalex.testcard.core.db.setPlaybackProgress
import com.evcalex.testcard.core.db.toggleFavourite
import com.evcalex.testcard.core.db.toggleMovieFavourite
import com.evcalex.testcard.core.importing.CatalogueSource
import com.evcalex.testcard.core.importing.importCatalogue
import com.evcalex.testcard.core.sync.AuthFailure
import com.evcalex.testcard.core.sync.SourceDraft
import com.evcalex.testcard.core.sync.SourceLogins
import com.evcalex.testcard.core.sync.SyncAccount
import com.evcalex.testcard.core.sync.SyncController
import com.evcalex.testcard.core.sync.removeSourceRows
import com.evcalex.testcard.core.sync.saveSource
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable

/**
 * Two devices against a real sync server: `TESTCARD_SYNC_URL=http://localhost:8787 gradle :core:test` with `wrangler dev` running
 * (apps/sync-worker). A throwaway account is made each run. Skipped without the variable, so CI without a worker stays green.
 * Covers the wire, the credential encryption (a login written on one device opens on the other), tombstones and the sign-in errors.
 */
@EnabledIfEnvironmentVariable(named = "TESTCARD_SYNC_URL", matches = ".+")
class SyncIntegrationTest {
    private val url = System.getenv("TESTCARD_SYNC_URL")

    @OptIn(ExperimentalCoroutinesApi::class)
    private class Device(url: String, onSources: (List<String>) -> Unit = {}) {
        val db = tempDb()
        val secrets = MemorySecretStore()
        val logins = SourceLogins(secrets)
        val sync = SyncController(db, logins, secrets, CoroutineScope(SupervisorJob() + Dispatchers.Default.limitedParallelism(1)), baseUrl = url, http = OkHttpClient(), onSourcesAdded = onSources)
        fun names() = runBlocking { db.read { c -> c.query("SELECT name FROM sources ORDER BY name") { it.getText(0) } } }
        fun ids() = runBlocking { db.read { c -> c.query("SELECT id FROM sources") { it.getText(0) } } }
    }

    private val world = ProviderWorld(dbJson("provider").let { it as kotlinx.serialization.json.JsonObject })

    /** The provider world, plus the login check (no action) that a real panel answers with the account's details. */
    private val provider: OkHttpClient = world.http.newBuilder().apply {
        interceptors().add(0, okhttp3.Interceptor { chain ->
            val request = chain.request()
            if (request.url.queryParameter("action") != null || !request.url.encodedPath.endsWith("player_api.php")) chain.proceed(request)
            else okhttp3.Response.Builder().request(request).protocol(okhttp3.Protocol.HTTP_1_1).code(200).message("OK")
                .body("""{"user_info":{"auth":1,"status":"Active","max_connections":"2","active_cons":"0"}}""".toResponseBody("application/json".toMediaType())).build()
        })
    }.build()

    @Test fun `a source and its login written on one device arrive on another, and a removal follows`() = runBlocking {
        val email = "it-${UUID.randomUUID()}@local.test"
        val password = "correct horse ${UUID.randomUUID()}"
        val a = Device(url).also { it.sync.start() }
        assertEquals(SyncAccount.SignedIn, a.sync.signUp(email, password).account)
        val saved = saveSource(a.db, a.logins, provider, null, SourceDraft("xtream", "Panel", XTREAM_BASE, "u", "p")) { UUID.randomUUID().toString() }
        a.sync.notifyLocalChange()
        a.sync.triggerNow()

        val arrived = ArrayList<String>()
        val b = Device(url) { arrived += it }.also { it.sync.start() }
        assertEquals(SyncAccount.SignedIn, b.sync.signIn(email, password).account)
        b.sync.triggerNow()
        assertEquals(listOf("Panel"), b.names())
        // Ids are local to a device: the source is the same one by its remote key, not by its id.
        val onB = b.ids().single()
        // The login travelled encrypted under a key made from the password, and opens here.
        assertEquals("p", b.logins.stored(onB).password)
        assertEquals("u", b.logins.stored(onB).username)
        assertTrue(arrived.contains(onB), "the new source is reported for import")

        // Removed on B; A hears of it.
        b.db.write { it.removeSourceRows(onB, recordTombstone = true) }
        b.sync.notifyLocalChange()
        b.sync.triggerNow()
        a.sync.triggerNow()
        assertEquals(emptyList<String>(), a.names())
        a.sync.dispose(); b.sync.dispose()
    }

    @Test fun `favourites, recents and progress follow the account to a device with its own ids`() = runBlocking {
        val email = "it-${UUID.randomUUID()}@local.test"
        val password = "correct horse ${UUID.randomUUID()}"
        val a = Device(url).also { it.sync.start() }
        a.sync.signUp(email, password)
        val saved = saveSource(a.db, a.logins, provider, null, SourceDraft("xtream", "Panel", XTREAM_BASE, "u", "p")) { UUID.randomUUID().toString() }
        importCatalogue(a.db, CatalogueSource(saved.id, "xtream", "Panel", XTREAM_BASE, null, null, true, true, true), world.api, world.http)
        val (channel, movie) = a.db.read { c -> c.query("SELECT id FROM channels WHERE source_id = ? ORDER BY rowid LIMIT 1", saved.id) { it.getText(0) }.single() to c.query("SELECT id FROM movies WHERE source_id = ? ORDER BY rowid LIMIT 1", saved.id) { it.getText(0) }.single() }
        a.db.write { c ->
            c.toggleFavourite(channel); c.recordRecent(channel)
            c.toggleMovieFavourite(movie); c.recordMovieRecent(movie)
            c.setPlaybackProgress("movie", movie, 300.0, 6000.0)
        }
        a.sync.notifyLocalChange()
        a.sync.triggerNow()

        val b = Device(url).also { it.sync.start() }
        b.sync.signIn(email, password)
        b.sync.triggerNow()
        val onB = b.ids().single()
        // The titles must be here before the history that points at them can be applied; it is held until then, and the next sync takes it.
        importCatalogue(b.db, CatalogueSource(onB, "xtream", "Panel", XTREAM_BASE, null, null, true, true, true), world.api, world.http)
        b.sync.triggerNow()
        fun names(device: Device, sql: String) = runBlocking { device.db.read { c -> c.query(sql) { it.getText(0) } } }
        // Channel favourites and recents are not checked: their account key includes the local source id (SYNC-09, kept as the
        // TypeScript has it), so a source another device made never matches them. Idea for after the move: issue labelled after-native.
        for ((what, sql) in listOf(
            "movie favourites" to "SELECT m.name FROM movie_favourites f JOIN movies m ON m.id = f.movie_id",
            "movie recents" to "SELECT m.name FROM movie_recents f JOIN movies m ON m.id = f.movie_id",
            "progress" to "SELECT m.name || ':' || p.position_secs FROM playback_progress p JOIN movies m ON m.id = p.item_id WHERE p.item_type = 'movie'",
        )) {
            val expected = names(a, sql)
            assertEquals(1, expected.size, "$what on A")
            assertEquals(expected, names(b, sql), "$what on B")
        }
        a.sync.dispose(); b.sync.dispose()
    }

    @Test fun `a wrong password is refused with a message, and an unknown account too`() = runBlocking {
        val email = "it-${UUID.randomUUID()}@local.test"
        val a = Device(url).also { it.sync.start() }
        a.sync.signUp(email, "right password 123")
        val b = Device(url).also { it.sync.start() }
        assertThrows(AuthFailure::class.java) { runBlocking { b.sync.signIn(email, "wrong password 123") } }
        assertThrows(AuthFailure::class.java) { runBlocking { b.sync.signIn("nobody-${UUID.randomUUID()}@local.test", "whatever 12345") } }
        a.sync.dispose(); b.sync.dispose()
    }
}
