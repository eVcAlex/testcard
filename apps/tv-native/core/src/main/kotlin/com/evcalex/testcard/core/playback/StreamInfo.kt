package com.evcalex.testcard.core.playback

import java.util.Locale

/** Plain-language facts about the stream being played, from what the player reports (`playback/streamInfo.ts`). */

/** "4K", "1080p", "720p", "SD": what people call the picture size. Width counts too, since wide films are letterboxed. */
fun qualityLabel(width: Int, height: Int): String? {
    if (width <= 0 || height <= 0) return null
    if (width >= 3200 || height >= 2000) return "4K"
    if (width >= 2400 || height >= 1300) return "1440p"
    if (width >= 1800 || height >= 1000) return "1080p"
    if (width >= 1200 || height >= 700) return "720p"
    return "SD"
}

fun codecLabel(mimeType: String?): String? {
    val mime = (mimeType ?: "").lowercase(Locale.ROOT)
    return when {
        "hevc" in mime || "h265" in mime -> "HEVC"
        "avc" in mime || "h264" in mime -> "H.264"
        "av01" in mime || "av1" in mime -> "AV1"
        "vp9" in mime -> "VP9"
        "mpeg2" in mime || "mpeg-2" in mime -> "MPEG-2"
        else -> null
    }
}

fun fpsLabel(frameRate: Float?): String? {
    if (frameRate == null || !frameRate.isFinite() || frameRate <= 0f) return null
    val rounded = Math.round(frameRate * 100.0) / 100.0
    val text = if (rounded == Math.floor(rounded)) rounded.toInt().toString() else String.format(Locale.ROOT, "%.2f", rounded).replace(Regex("0$"), "")
    return "$text fps"
}

fun bitrateLabel(bitsPerSecond: Int?): String? {
    if (bitsPerSecond == null || bitsPerSecond <= 0) return null
    val mbps = bitsPerSecond / 1_000_000.0
    return if (mbps >= 1) String.format(Locale.ROOT, if (mbps >= 10) "%.0f Mbps" else "%.1f Mbps", mbps) else "${Math.round(bitsPerSecond / 1000.0)} kbps"
}

class StreamFacts(val quality: String?, val size: String?, val fps: String?, val codec: String?, val bitrate: String?, val hdr: String?)

val NO_FACTS = StreamFacts(null, null, null, null, null, null)

/** `hdr` is Media3's colour transfer: 6 is PQ (HDR10 and Dolby Vision), 7 is HLG. */
fun streamFacts(width: Int, height: Int, mimeType: String?, frameRate: Float?, bitrate: Int?, colorTransfer: Int?): StreamFacts =
    StreamFacts(
        qualityLabel(width, height),
        if (width > 0 && height > 0) "$width x $height" else null,
        fpsLabel(frameRate),
        codecLabel(mimeType),
        bitrateLabel(bitrate),
        when (colorTransfer) { 6 -> "HDR"; 7 -> "HLG"; else -> null },
    )
