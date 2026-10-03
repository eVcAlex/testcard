package com.evcalex.testcard.core

import com.evcalex.testcard.core.sync.SourceLogins
import com.evcalex.testcard.core.sync.SyncAccount
import com.evcalex.testcard.core.sync.SyncController
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** When the sync loop runs, on a clock the test holds: coalescing of changes, the rate limit, the periodic tick, a pause, and an expired session. */
class SyncScheduleTest {
    private class Server : AutoCloseable {
        val pulls = AtomicInteger()
        val signIns = AtomicInteger()
        @Volatile var pullStatus = 200
        @Volatile var signInStatus = 200
        val web = MockWebServer().also {
            it.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when {
                    request.path!!.startsWith("/sync/pull") -> { pulls.incrementAndGet(); if (pullStatus == 200) json("""{"serverCursor":5}""") else MockResponse().setResponseCode(pullStatus).setBody("no") }
                    request.path == "/sync/push" -> json("""{"newCursor":1}""")
                    request.path == "/sync/salt" -> if (request.method == "GET") MockResponse().setResponseCode(404) else json("{}")
                    request.path!!.startsWith("/auth/sign-up") -> json("""{"user":{"id":"u"},"token":"t1"}""")
                    request.path!!.startsWith("/auth/sign-in") -> { signIns.incrementAndGet(); if (signInStatus == 200) json("""{"user":{"id":"u"},"token":"t2"}""") else MockResponse().setResponseCode(signInStatus).setBody("no") }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        private fun json(body: String) = MockResponse().setBody(body).setHeader("content-type", "application/json")
        val url: String get() = web.url("").toString().trimEnd('/')
        override fun close() = web.close()
    }

    /** Lets real I/O finish: the test dispatcher runs what is ready, and the wait is for the network, not for time. */
    private fun TestScope.settle(done: () -> Boolean) {
        val limit = System.nanoTime() + 5_000_000_000L
        while (!done() && System.nanoTime() < limit) { runCurrent(); Thread.sleep(5) }
        runCurrent()
    }

    private fun TestScope.signedIn(server: Server): SyncController {
        val secrets = MemorySecretStore()
        val sync = SyncController(tempDb(), SourceLogins(secrets), secrets, backgroundScope, baseUrl = server.url, now = { currentTime })
        runBlockingSignUp(sync)
        settle { server.pulls.get() >= 1 }
        return sync
    }

    private fun TestScope.runBlockingSignUp(sync: SyncController) {
        var result: Throwable? = null
        var done = false
        backgroundScope.launch { try { sync.signUp("a@b.test", "password 12345") } catch (error: Throwable) { result = error }; done = true }
        settle { done }
        result?.let { throw it }
    }


    @Test fun `changes made close together are one sync, a few seconds later`() = runTest {
        Server().use { server ->
            val sync = signedIn(server)
            // Past the gap that follows the sign-up sync.
            advanceTimeBy(20_000); runCurrent()
            val before = server.pulls.get()
            repeat(5) { sync.notifyLocalChange() }
            advanceTimeBy(2_999); runCurrent()
            assertEquals(before, server.pulls.get())
            advanceTimeBy(2); settle { server.pulls.get() > before }
            assertEquals(before + 1, server.pulls.get())
        }
    }

    @Test fun `a change soon after a sync waits out the gap`() = runTest {
        Server().use { server ->
            val sync = signedIn(server)
            val before = server.pulls.get()
            // The sign-up sync just ran: the next may not start for 15 s from that.
            sync.notifyLocalChange()
            advanceTimeBy(14_000); runCurrent()
            assertEquals(before, server.pulls.get())
            advanceTimeBy(2_000); settle { server.pulls.get() > before }
            assertEquals(before + 1, server.pulls.get())
        }
    }

    @Test fun `it syncs once a minute on its own`() = runTest {
        Server().use { server ->
            val sync = signedIn(server)
            val before = server.pulls.get()
            // The next tick is counted from when the cycle ends, so each is waited out to its end before time moves on.
            advanceTimeBy(60_001); settle { (sync.status.value.lastSyncedAt ?: 0) >= currentTime }
            assertEquals(before + 1, server.pulls.get())
            advanceTimeBy(60_001); settle { (sync.status.value.lastSyncedAt ?: 0) >= currentTime }
            assertEquals(before + 2, server.pulls.get())
        }
    }

    @Test fun `paused, nothing runs, and resuming syncs at once`() = runTest {
        Server().use { server ->
            val sync = signedIn(server)
            var paused = false
            backgroundScope.launch { sync.setPaused(true); paused = true }
            settle { paused }
            val before = server.pulls.get()
            sync.notifyLocalChange()
            advanceTimeBy(120_000); runCurrent()
            assertEquals(before, server.pulls.get())
            backgroundScope.launch { sync.setPaused(false) }
            settle { server.pulls.get() > before }
            assertEquals(before + 1, server.pulls.get())
        }
    }

    @Test fun `an expired session signs in again quietly with the stored password`() = runTest {
        Server().use { server ->
            val sync = signedIn(server)
            server.pullStatus = 401
            val before = server.pulls.get()
            advanceTimeBy(60_001)
            // The first pull is refused; after the quiet sign-in the second is let through.
            settle { server.pulls.get() > before }
            server.pullStatus = 200
            settle { server.signIns.get() >= 1 && server.pulls.get() >= before + 2 }
            assertEquals(1, server.signIns.get())
            assertEquals(SyncAccount.SignedIn, sync.status.value.account)
        }
    }

    @Test fun `a refused quiet sign-in ends the session with a message`() = runTest {
        Server().use { server ->
            val sync = signedIn(server)
            server.pullStatus = 401
            server.signInStatus = 401
            advanceTimeBy(60_001)
            settle { sync.status.value.account == SyncAccount.SignedOut }
            assertEquals(SyncAccount.SignedOut, sync.status.value.account)
            assertNotNull(sync.status.value.lastError)
            assertTrue(sync.status.value.lastError!!.contains("Sign in again"))
        }
    }
}
