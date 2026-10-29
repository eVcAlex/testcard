package com.evcalex.testcard.core.net

import java.net.Authenticator
import java.net.InetSocketAddress
import java.net.PasswordAuthentication
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import okhttp3.Credentials
import okhttp3.OkHttpClient

enum class RouteType { SOCKS5, HTTP }

/** A proxy a source's traffic is sent through, typically the proxy a VPN provider runs next to its VPN. */
data class NetworkRoute(val type: RouteType, val host: String, val port: Int, val username: String? = null, val password: String? = null) {
    // Carries a password, so it must never reach a log through a data class's own toString.
    override fun toString() = "NetworkRoute($type, $host:$port)"

    internal fun toProxy() = Proxy(if (type == RouteType.SOCKS5) Proxy.Type.SOCKS else Proxy.Type.HTTP, InetSocketAddress.createUnresolved(host, port))
}

/**
 * Which route each provider host goes through. Spike: keyed by the host a request is made to, so one client serves every source and
 * the player needs no change; the cost is that two logins on the same host cannot take different routes.
 */
class RouteTable {
    private val byHost = ConcurrentHashMap<String, NetworkRoute>()

    fun set(host: String, route: NetworkRoute?) {
        if (route == null) byHost.remove(host.lowercase()) else byHost[host.lowercase()] = route
    }

    fun routeFor(host: String): NetworkRoute? = byHost[host.lowercase()]

    internal fun routeAt(host: String, port: Int): NetworkRoute? = byHost.values.firstOrNull { it.host.equals(host, true) && it.port == port }

    /**
     * Sends a routed host through its proxy, everything else direct. A routed host is offered only its proxy, so a dead proxy is an
     * error and never a quiet direct connection (the point of routing is that the provider must not see this device's address).
     */
    fun applyTo(builder: OkHttpClient.Builder): OkHttpClient.Builder {
        installSocksCredentials(this)
        return builder
            .proxySelector(object : ProxySelector() {
                override fun select(uri: URI?): List<Proxy> = uri?.host?.let { routeFor(it) }?.let { listOf(it.toProxy()) } ?: listOf(Proxy.NO_PROXY)
                override fun connectFailed(uri: URI?, address: SocketAddress?, failure: java.io.IOException?) = Unit
            })
            .proxyAuthenticator { route, response ->
                val proxy = route?.proxy?.address() as? InetSocketAddress
                val login = proxy?.let { routeAt(it.hostString, it.port) }
                if (login?.username == null || response.request.header("Proxy-Authorization") != null) null
                else response.request.newBuilder().header("Proxy-Authorization", Credentials.basic(login.username, login.password ?: "")).build()
            }
    }
}

private val socksTables = java.util.concurrent.CopyOnWriteArrayList<RouteTable>()
private var socksInstalled = false

/**
 * OkHttp authenticates to an HTTP proxy itself but leaves SOCKS5 login to the JVM, which asks the process-wide default
 * [Authenticator]. So this is global: one default for every table, answering for whichever proxy host and port asks.
 */
@Synchronized
private fun installSocksCredentials(table: RouteTable) {
    if (table !in socksTables) socksTables += table
    if (socksInstalled) return
    socksInstalled = true
    Authenticator.setDefault(object : Authenticator() {
        override fun getPasswordAuthentication(): PasswordAuthentication? {
            if (!requestingProtocol.startsWith("SOCKS")) return null
            val route = socksTables.firstNotNullOfOrNull { it.routeAt(requestingHost ?: requestingSite?.hostName ?: return null, requestingPort) } ?: return null
            return route.username?.let { PasswordAuthentication(it, (route.password ?: "").toCharArray()) }
        }
    })
}

fun OkHttpClient.routedBy(table: RouteTable): OkHttpClient = table.applyTo(newBuilder()).build()
