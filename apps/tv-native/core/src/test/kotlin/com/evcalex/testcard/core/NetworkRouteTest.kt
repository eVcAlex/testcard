package com.evcalex.testcard.core

import com.evcalex.testcard.core.net.NetworkRoute
import com.evcalex.testcard.core.net.RouteTable
import com.evcalex.testcard.core.net.RouteType
import com.evcalex.testcard.core.net.routedBy
import java.io.DataInputStream
import java.io.IOException
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The spike's question: does one OkHttp client route per provider host, through an HTTP or SOCKS5 proxy, and refuse to leak when the proxy is down? */
class NetworkRouteTest {
    private fun get(client: OkHttpClient, url: String): String = client.newCall(Request.Builder().url(url).build()).execute().use { it.body!!.string() }

    @Test
    fun `an unrouted host goes direct and a routed host goes through the HTTP proxy`() {
        MockWebServer().use { origin ->
            MockWebServer().use { proxy ->
                origin.enqueue(MockResponse().setBody("direct"))
                proxy.enqueue(MockResponse().setResponseCode(407).setHeader("Proxy-Authenticate", "Basic realm=\"vpn\""))
                proxy.enqueue(MockResponse().setBody("via proxy"))
                val table = RouteTable().apply { set("stream.example", NetworkRoute(RouteType.HTTP, proxy.hostName, proxy.port, "u", "p")) }
                val client = OkHttpClient().routedBy(table)

                assertEquals("direct", get(client, origin.url("/a").toString()))
                assertEquals(1, origin.requestCount)
                assertEquals(0, proxy.requestCount)

                // The target is never resolved here: the proxy gets the whole address, so the DNS lookup happens at the VPN exit.
                assertEquals("via proxy", get(client, "http://stream.example/live/u/p/1.ts"))
                proxy.takeRequest()
                val authed = proxy.takeRequest()
                assertEquals("GET http://stream.example/live/u/p/1.ts HTTP/1.1", authed.requestLine)
                assertEquals("Basic dTpw", authed.getHeader("Proxy-Authorization"))
                assertEquals(1, origin.requestCount)
            }
        }
    }

    @Test
    fun `a SOCKS5 route logs in and hands the proxy the hostname`() {
        MockWebServer().use { origin ->
            origin.enqueue(MockResponse().setBody("via socks"))
            FakeSocks5(forwardTo = origin.port, user = "u", pass = "p").use { socks ->
                val table = RouteTable().apply { set("stream.example", NetworkRoute(RouteType.SOCKS5, "127.0.0.1", socks.port, "u", "p")) }
                assertEquals("via socks", get(OkHttpClient().routedBy(table), "http://stream.example:8080/live/u/p/1.ts"))
                assertEquals(listOf("stream.example:8080"), socks.requested.toList())
                assertEquals(listOf("u:p"), socks.logins.toList())
            }
        }
    }

    @Test
    fun `a dead proxy fails and the origin is never contacted`() {
        MockWebServer().use { origin ->
            val dead = ServerSocket(0).use { it.localPort }
            val table = RouteTable().apply { set(origin.hostName, NetworkRoute(RouteType.SOCKS5, "127.0.0.1", dead)) }
            assertThrows(IOException::class.java) { get(OkHttpClient().routedBy(table), origin.url("/x").toString()) }
            assertEquals(0, origin.requestCount)
        }
    }

    @Test
    fun `the route can be changed or removed on the live client`() {
        MockWebServer().use { origin ->
            origin.enqueue(MockResponse().setBody("direct again"))
            val dead = ServerSocket(0).use { it.localPort }
            val table = RouteTable()
            val client = OkHttpClient().routedBy(table)
            table.set(origin.hostName, NetworkRoute(RouteType.SOCKS5, "127.0.0.1", dead))
            assertThrows(IOException::class.java) { get(client, origin.url("/x").toString()) }
            table.set(origin.hostName, null)
            assertNull(table.routeFor(origin.hostName))
            assertEquals("direct again", get(client, origin.url("/x").toString()))
        }
    }

    @Test
    fun `a route never prints its password`() {
        val text = NetworkRoute(RouteType.SOCKS5, "p.example", 1080, "user", "secret").toString()
        assertTrue("secret" !in text && "user" !in text)
        assertNotNull(text)
    }
}

/** Just enough SOCKS5 (RFC 1928/1929): password login, CONNECT by domain name, then a pipe to a local server in place of the real one. */
private class FakeSocks5(private val forwardTo: Int, private val user: String, private val pass: String) : AutoCloseable {
    private val server = ServerSocket(0)
    val port get() = server.localPort
    val requested = CopyOnWriteArrayList<String>()
    val logins = CopyOnWriteArrayList<String>()

    init { thread(isDaemon = true) { while (!server.isClosed) { val client = try { server.accept() } catch (_: IOException) { return@thread }; thread(isDaemon = true) { serve(client) } } } }

    private fun serve(client: Socket) = client.use {
        val input = DataInputStream(it.getInputStream()); val output = it.getOutputStream()
        input.readByte(); val methods = ByteArray(input.readUnsignedByte()); input.readFully(methods)
        output.write(byteArrayOf(5, 2)); output.flush()
        input.readByte()
        val name = ByteArray(input.readUnsignedByte()).also { b -> input.readFully(b) }
        val secret = ByteArray(input.readUnsignedByte()).also { b -> input.readFully(b) }
        val ok = String(name) == user && String(secret) == pass
        logins += "${String(name)}:${String(secret)}"
        output.write(byteArrayOf(1, if (ok) 0 else 1)); output.flush()
        if (!ok) return@use
        input.readFully(ByteArray(3)) // VER CMD RSV
        val type = input.readUnsignedByte()
        check(type == 3) { "hostname expected, got address type $type: the client resolved the name itself" }
        val host = String(ByteArray(input.readUnsignedByte()).also { b -> input.readFully(b) })
        requested += "$host:${input.readUnsignedShort()}"
        val upstream = Socket("127.0.0.1", forwardTo)
        output.write(byteArrayOf(5, 0, 0, 1, 0, 0, 0, 0, 0, 0)); output.flush()
        val back = thread(isDaemon = true) { runCatching { upstream.getInputStream().copyTo(output) }; runCatching { it.shutdownOutput() } }
        runCatching { input.copyTo(upstream.getOutputStream()) }
        runCatching { upstream.shutdownOutput() }
        back.join(2000); upstream.close()
    }

    override fun close() = server.close()
}
