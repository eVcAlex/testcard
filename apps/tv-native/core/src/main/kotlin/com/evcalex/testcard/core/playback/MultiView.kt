package com.evcalex.testcard.core.playback

import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.ChannelFeed
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.run

/*
 * Multi view: several live channels on one screen. Everything that decides whether it plays smoothly lives here, apart from
 * the player: how many pictures this device and this provider account can carry (a stream that is not allowed, or a
 * decoder that does not exist, is what makes other multi view players buffer), which quality each picture needs, and what to
 * do when one stalls. The screen only carries it out. See docs/adr/0014-multi-view.md.
 */

/** A tile's place on the screen, as fractions of its width and height. A 16:9 tile on a 16:9 screen has equal `w` and `h`. */
class TileRect(val x: Float, val y: Float, val w: Float, val h: Float)

private fun r(x: Float, y: Float, w: Float, h: Float) = TileRect(x, y, w, h)

/**
 * The screen variants. Slot 0 is the main picture: in a layout with one big tile it is the big one, and "Make main" swaps a
 * channel into it. Every tile is 16:9 so the picture fills it; what is left over is black.
 */
enum class MultiLayout(val id: String, val label: String, val note: String, val slots: List<TileRect>) {
    SideBySide("duo", "Side by side", "Two equal pictures", listOf(r(0f, .25f, .5f, .5f), r(.5f, .25f, .5f, .5f))),
    Inset("pip", "Picture in picture", "One full screen, one in the corner", listOf(r(0f, 0f, 1f, 1f), r(.70f, .70f, .26f, .26f))),
    Quad("quad", "Four grid", "Four equal pictures", listOf(r(0f, 0f, .5f, .5f), r(.5f, 0f, .5f, .5f), r(0f, .5f, .5f, .5f), r(.5f, .5f, .5f, .5f))),
    Spotlight3("spot3", "Spotlight, 2 beside", "One big, two small", listOf(r(0f, 0f, .75f, .75f), r(.75f, 0f, .25f, .25f), r(.75f, .25f, .25f, .25f))),
    Spotlight4("spot4", "Spotlight, 3 beside", "One big, three small", listOf(r(0f, 0f, .75f, .75f), r(.75f, 0f, .25f, .25f), r(.75f, .25f, .25f, .25f), r(.75f, .5f, .25f, .25f))),
    Stage("stage", "Stage, 3 below", "One big, three in a row beneath", listOf(r(.2f, 0f, .6f, .6f), r(0f, .6f, 1f / 3, 1f / 3), r(1f / 3, .6f, 1f / 3, 1f / 3), r(2f / 3, .6f, 1f / 3, 1f / 3)));

    /** True where slot 0 is bigger than the rest, so "Make main" means something. */
    val hasMain get() = slots.drop(1).any { it.w < slots[0].w }

    companion object {
        fun of(id: String?) = entries.firstOrNull { it.id == id } ?: Quad
    }
}

/** The layouts a screen may offer when it can carry [tiles] pictures at most: those that never need more. Two at least. */
fun layoutsFor(tiles: Int): List<MultiLayout> = MultiLayout.entries.filter { it.slots.size <= tiles }

/** The layout to start in for [wanted] channels with room for [tiles]: the smallest that holds them all, else the largest. */
fun startLayout(wanted: Int, tiles: Int, last: MultiLayout?): MultiLayout {
    val offered = layoutsFor(tiles)
    if (offered.isEmpty()) return MultiLayout.SideBySide
    if (last != null && last in offered && last.slots.size >= wanted) return last
    val holds = offered.filter { it.slots.size >= wanted }
    val fewest = holds.minOfOrNull { it.slots.size } ?: return offered.maxBy { it.slots.size }
    return holds.first { it.slots.size == fewest }
}

// ---- how many pictures can be carried

/** The most pictures a device carries without struggling, from its memory and what its video decoder says it can run at once. */
fun deviceTileCap(totalMemMb: Int, decoderInstances: Int?): Int {
    // A decoder's own claim is generous on cheap chips; memory is the honest limit: each picture holds a decoder, a surface and a buffer.
    val byMemory = if (totalMemMb < 900) 2 else if (totalMemMb < 1400) 3 else MAX_TILES
    val byDecoder = decoderInstances?.coerceAtLeast(1) ?: byMemory
    return minOf(byMemory, byDecoder, MAX_TILES)
}

/** Multi view shows four pictures at most: past that each is too small to follow and the line rarely carries them. */
const val MAX_TILES = 4

/** A channel the viewer wants in the view, and which source (provider account) it plays from. */
class TileWish(val channelId: String, val sourceId: String)

class TilePlan(val kept: List<TileWish>, val left: List<TileWish>, val note: String?)

/**
 * Which wished channels get a picture. Kept in the order given (the first is the main picture), a channel only once, up to
 * what the device carries and, per source, what its account allows at once: a provider that allows two streams refuses the
 * third, and a refused tile would only sit there buffering. [allowed] gives a source's free streams, or null when it says nothing.
 */
fun planTiles(wished: List<TileWish>, deviceCap: Int, allowed: (sourceId: String) -> Int?): TilePlan {
    val kept = ArrayList<TileWish>()
    val left = ArrayList<TileWish>()
    val perSource = HashMap<String, Int>()
    var byDevice = false
    var byAccount = false
    for (wish in wished) {
        if (kept.any { it.channelId == wish.channelId }) continue
        val used = perSource[wish.sourceId] ?: 0
        val room = allowed(wish.sourceId)
        if (kept.size >= deviceCap) { left += wish; byDevice = true; continue }
        if (room != null && used >= room) { left += wish; byAccount = true; continue }
        kept += wish
        perSource[wish.sourceId] = used + 1
    }
    val note = if (left.isEmpty()) null
    else if (byAccount) "Your provider only allows so many streams at once, so ${kept.size} ${if (kept.size == 1) "is" else "are"} showing."
    else if (byDevice) "This device carries ${kept.size} ${if (kept.size == 1) "picture" else "pictures"} smoothly, so ${kept.size} ${if (kept.size == 1) "is" else "are"} showing."
    else null
    return TilePlan(kept, left, note)
}

/** Free streams on an Xtream account, counting the ones other devices have open. Null when the account does not say. */
fun freeStreams(maxConnections: Int?, activeConnections: Int?): Int? {
    if (maxConnections == null) return null
    return (maxConnections - (activeConnections ?: 0)).coerceAtLeast(0)
}

// ---- which quality each picture needs

/** A quality label's picture height: "1080p50" -> 1080, "4K" / "UHD" -> 2160, "FHD" -> 1080, "HD" -> 720, "SD" -> 480. Null when it says nothing. */
fun qualityHeight(label: String?): Int? {
    if (label == null) return null
    Regex("(\\d{3,4})\\s*[pP]").find(label)?.let { return it.groupValues[1].toInt() }
    val word = label.trim().uppercase()
    return when {
        Regex("\\b(4K|UHD|2160)\\b").containsMatchIn(word) -> 2160
        Regex("\\b(8K)\\b").containsMatchIn(word) -> 4320
        Regex("\\b(FHD|FULL ?HD)\\b").containsMatchIn(word) -> 1080
        Regex("\\bHD\\b").containsMatchIn(word) -> 720
        Regex("\\b(SD|LOW)\\b").containsMatchIn(word) -> 480
        else -> null
    }
}

/** The picture height worth decoding for a tile this tall (a fraction of the screen's 1080 lines): sharp for its size, never past 1080. */
fun targetHeight(tileHeightFraction: Float): Int = (tileHeightFraction * 1080 * 1.5f).toInt().coerceIn(480, 1080)

/**
 * The feed to play in a tile: of the channel's own variants, the sharpest not above [target], else the softest there is. A
 * smaller picture is the cheapest way to keep several streams flowing at once. Null when none says its quality (the first one plays).
 */
fun pickFeed(feeds: List<ChannelFeed>, channelId: String, target: Int): ChannelFeed? {
    val own = feeds.filter { it.channelId == channelId }
    val known = own.mapNotNull { f -> qualityHeight(f.quality)?.let { f to it } }
    if (known.isEmpty()) return null
    return known.filter { it.second <= target }.maxByOrNull { it.second }?.first ?: known.minBy { it.second }.first
}

/** The next softer feed than [current] among the channel's own, or null when it is already the softest. */
fun softerFeed(feeds: List<ChannelFeed>, channelId: String, current: ChannelFeed?): ChannelFeed? {
    val own = feeds.filter { it.channelId == channelId }.mapNotNull { f -> qualityHeight(f.quality)?.let { f to it } }
    val now = current?.let { qualityHeight(it.quality) } ?: own.maxOfOrNull { it.second } ?: return null
    return own.filter { it.second < now }.maxByOrNull { it.second }?.first
}

// ---- keeping the pictures flowing

/** Stagger: each picture after the first waits for the one before to show a frame, or this long, so they do not all fight for the line at once. */
const val TILE_START_STAGGER_MS = 3_500L

/** Read-ahead per picture in milliseconds and bytes: the one with sound can afford more, the rest only need to ride out a hiccup. */
class TileBuffer(val targetMs: Int, val capBytes: Int, val playAtMs: Int)

private const val MB = 1024 * 1024
val AUDIO_TILE_BUFFER = TileBuffer(15_000, 16 * MB, 1_500)
val MUTED_TILE_BUFFER = TileBuffer(8_000, 6 * MB, 1_500)

/** What to do about a picture that keeps stalling. */
sealed interface TileAction {
    /** Switch to the next softer feed of the same channel. */
    class Downshift(val slot: Int) : TileAction

    /** Ask for the stream again. */
    class Reload(val slot: Int) : TileAction

    /** Stop this picture so the others stay smooth; the viewer can start it again. */
    class Pause(val slot: Int) : TileAction
}

const val STALL_WINDOW_MS = 30_000L
const val STALLS_BEFORE_ACTION = 2

/**
 * Watches the stalls (a picture that was playing and ran dry) across all tiles. A tile that stalls twice in half a minute drops
 * to a softer feed; with none softer it is asked for again; and when several tiles are stalling together it is the line that is
 * short, not one stream, so the least important stalling tile (never the one with sound) is paused to let the rest through.
 */
class TileGovernor(private val now: () -> Long) {
    private val stalls = HashMap<Int, ArrayList<Long>>()

    private fun recent(slot: Int): ArrayList<Long> {
        val list = stalls.getOrPut(slot) { ArrayList() }
        val cutoff = now() - STALL_WINDOW_MS
        list.removeAll { it < cutoff }
        return list
    }

    /** [priority]: lower is more important (0 is the main picture). */
    fun onStall(slot: Int, priority: Map<Int, Int>, hasSofter: Boolean, audioSlot: Int): TileAction? {
        val mine = recent(slot)
        mine += now()
        if (mine.size < STALLS_BEFORE_ACTION) return null
        if (hasSofter) { mine.clear(); return TileAction.Downshift(slot) }
        val stalling = stalls.keys.filter { it != slot && recent(it).size >= STALLS_BEFORE_ACTION - 1 } + slot
        if (stalling.size >= 2) {
            val victim = stalling.filter { it != audioSlot }.maxByOrNull { priority[it] ?: Int.MAX_VALUE }
            if (victim != null) { recent(victim).clear(); return TileAction.Pause(victim) }
        }
        mine.clear()
        return TileAction.Reload(slot)
    }

    fun forget(slot: Int) { stalls.remove(slot) }
}

// ---- remembered choice

private const val LAYOUT_KEY = "ui:multiview:layout"

fun SQLiteConnection.readMultiLayout(): MultiLayout? = try {
    one("SELECT value FROM schema_meta WHERE key = ?", LAYOUT_KEY) { it.getText(0) }?.let { id -> MultiLayout.entries.firstOrNull { it.id == id } }
} catch (_: Exception) {
    null
}

fun SQLiteConnection.writeMultiLayout(layout: MultiLayout) {
    try {
        run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)", LAYOUT_KEY, layout.id)
    } catch (_: Exception) {
        // The next visit starts in the default layout.
    }
}
