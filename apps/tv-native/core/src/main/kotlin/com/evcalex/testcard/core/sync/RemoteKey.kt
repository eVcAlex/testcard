package com.evcalex.testcard.core.sync

import com.evcalex.testcard.core.crypto.hash64
import com.evcalex.testcard.core.crypto.sha1Hex
import okhttp3.HttpUrl.Companion.toHttpUrl

/** Strips scheme, port and trailing-slash noise so the same panel reached two ways collapses. Port of `remoteKey.ts`. */
fun normalizeProviderHost(rawHost: String): String {
    val url = (if ("://" in rawHost) rawHost else "http://$rawHost").toHttpUrl()
    val host = if (':' in url.host) "[${url.host}]" else url.host
    // HttpUrl reports the scheme's default port when none was written; the TS code treats 80 and 443 as default anyway.
    val defaultPort = url.port == 80 || url.port == 443
    return host + if (defaultPort) "" else ":${url.port}"
}

fun remoteKeyFor(providerHost: String, providerId: String): String = sha1Hex("${normalizeProviderHost(providerHost)}|$providerId")

fun remoteKeyForPlaylist(playlistUrl: String): String = sha1Hex("m3u|${playlistUrl.trim()}")

fun remoteKeyForPlaylistItem(playlistUrl: String, itemKey: String): String = sha1Hex("m3u|${playlistUrl.trim()}|$itemKey")

/** A channel's key on the account. The channel id holds NUL as U+0001 on Android. Port of `channelKeyFor`. */
fun channelKeyFor(sourceRemoteKey: String, sourceId: String, channelId: String): String? {
    if (!channelId.startsWith("$sourceId:")) return null
    val key = channelId.substring(sourceId.length + 1).replace('\u0001', '\u0000')
    return "ch.${hash64("$sourceRemoteKey|$key")}"
}
