package com.evcalex.testcard.tv.ui.player

import android.app.ActivityManager
import android.content.Context
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.evcalex.testcard.core.db.ChannelFeed
import com.evcalex.testcard.core.db.listChannelFeeds
import com.evcalex.testcard.core.db.listFavouriteChannels
import com.evcalex.testcard.core.db.listRecentChannels
import com.evcalex.testcard.core.playback.MAX_TILES
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.playback.AUDIO_TILE_BUFFER
import com.evcalex.testcard.core.playback.HealthAction
import com.evcalex.testcard.core.playback.MUTED_TILE_BUFFER
import com.evcalex.testcard.core.playback.MultiLayout
import com.evcalex.testcard.core.playback.PlayItem
import com.evcalex.testcard.core.playback.PlayKind
import com.evcalex.testcard.core.playback.PlaybackHealth
import com.evcalex.testcard.core.playback.TILE_START_STAGGER_MS
import com.evcalex.testcard.core.playback.TileAction
import com.evcalex.testcard.core.playback.TileGovernor
import com.evcalex.testcard.core.playback.TileWish
import com.evcalex.testcard.core.playback.deviceTileCap
import com.evcalex.testcard.core.playback.freeStreams
import com.evcalex.testcard.core.playback.layoutsFor
import com.evcalex.testcard.core.playback.pickFeed
import com.evcalex.testcard.core.playback.planTiles
import com.evcalex.testcard.core.playback.qualityHeight
import com.evcalex.testcard.core.playback.readMultiLayout
import com.evcalex.testcard.core.playback.resolveStream
import com.evcalex.testcard.core.playback.softerFeed
import com.evcalex.testcard.core.playback.sourceOfPlay
import com.evcalex.testcard.core.playback.startLayout
import com.evcalex.testcard.core.playback.targetHeight
import com.evcalex.testcard.core.playback.writeMultiLayout
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.platform.Media3Player
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

enum class TileState { Starting, Playing, Buffering, Stopped, Failed }

enum class MultiPhase { Checking, Ready, Unavailable }

/** One picture of Multi view: a channel, its player, and what is known about how it is doing. */
class MultiTile(val item: PlayItem) {
    var player: ExoPlayer? = null
    var feeds: List<ChannelFeed> = emptyList()

    /** Feeds to try in turn: the one picked for this tile's size first, then the channel's others. */
    var order: List<ChannelFeed?> = listOf(null)
    var at = 0

    /** The sharpest picture this tile may ask for: lowered when it keeps stalling, and not raised again until it is added afresh. */
    var ceiling = Int.MAX_VALUE
    var health: PlaybackHealth? = null
    var loadJob: Job? = null
    var wasReady = false

    /** The source (provider account) this channel plays from, for the streams that account allows at once. */
    var sourceId: String = ""

    var feed by mutableStateOf<ChannelFeed?>(null)
    var state by mutableStateOf(TileState.Starting)
    var playedOnce by mutableStateOf(false)
    var message by mutableStateOf<String?>(null)
}

/**
 * Multi view's state and what it does about it (`docs/adr/0014-multi-view.md`). The numbers (how many pictures, which quality,
 * when a stalling picture is lowered or stopped) come from core's `MultiView.kt`, which is tested; this class carries them out
 * on the players. Every call is made from the main thread, where the players live; the database and the provider are only
 * ever asked from `Dispatchers.Default`.
 */
class MultiViewModel(private val app: AppController, private val context: Context, private val scope: CoroutineScope) {
    val tiles = mutableStateListOf<MultiTile>()
    var layout by mutableStateOf(MultiLayout.Quad)
        private set
    var audio by mutableStateOf<MultiTile?>(null)
        private set
    var phase by mutableStateOf(MultiPhase.Checking)
        private set

    /** Why there is nothing to show, or what had to be left out. */
    var note by mutableStateOf<String?>(null)
        private set
    private var cap = 2
    private var governor = TileGovernor(::nowMs)

    // ---- starting

    suspend fun start(queue: List<PlayItem>) {
        cap = withContext(Dispatchers.Default) { deviceCap() }
        var wishes = withContext(Dispatchers.Default) {
            queue.mapNotNull { q -> sourceOfPlay(app.db, PlayKind.Channel, q.id)?.let { TileWish(q.id, it.first) to it.second } }
        }
        // A provider that has only just been told the guide's preview has gone may still count it: look again once before dropping a picture for it.
        var plan = planTiles(wishes.map { it.first }, cap, allowanceOf(wishes))
        if (plan.left.isNotEmpty() && plan.kept.size < cap) {
            delay(2_000)
            plan = planTiles(wishes.map { it.first }, cap, allowanceOf(wishes))
        }
        // One channel is enough to start: the empty places in the layout are buttons that add the others.
        if (plan.kept.isEmpty()) {
            note = plan.note ?: "None of these channels can be played right now."
            phase = MultiPhase.Unavailable
            return
        }
        val titles = queue.associate { it.id to it.title }
        val built = plan.kept.map { wish -> MultiTile(PlayItem(PlayKind.Channel, wish.channelId, titles[wish.channelId] ?: "")).also { it.sourceId = wish.sourceId } }
        val feeds = withContext(Dispatchers.Default) { built.map { tile -> app.db.read { it.listChannelFeeds(tile.item.id) } } }
        val saved = withContext(Dispatchers.Default) { app.db.read { it.readMultiLayout() } }
        layout = startLayout(built.size, cap, saved)
        audio = built.first()
        for ((i, tile) in built.withIndex()) {
            tile.feeds = feeds[i]
            val muted = tile !== audio
            tile.player = Media3Player.createTile(context, app.http, if (muted) MUTED_TILE_BUFFER else AUDIO_TILE_BUFFER, muted, targetHeight(layout.slots[i].h))
            attach(tile)
            retarget(tile, i, force = true)
            tiles.add(tile)
        }
        note = plan.note
        phase = MultiPhase.Ready
        // The picture with sound first; each of the others once the one before has a frame up, so the pictures do not all
        // fight for the line while they start (a stampede of requests is how most multi views begin by buffering).
        for (tile in tiles.toList()) {
            if (tile !in tiles) continue
            load(tile, fresh = true)
            withTimeoutOrNull(TILE_START_STAGGER_MS) { snapshotFlow { tile.playedOnce || tile.state == TileState.Failed }.first { it } }
        }
    }

    private suspend fun allowanceOf(wishes: List<Pair<TileWish, String>>): (String) -> Int? {
        val xtream = wishes.filter { it.second == "xtream" }.map { it.first.sourceId }.distinct()
        val free = withContext(Dispatchers.Default) {
            xtream.map { id -> async { id to (withTimeoutOrNull(5_000) { app.accounts.account(id, fresh = true) }?.let { freeStreams(it.maxConnections, it.activeConnections) }) } }.awaitAll().toMap()
        }
        return { source -> free[source] }
    }

    /** The most pictures this device carries, from its memory and what its hardware video decoder claims it can run at once. */
    private fun deviceCap(): Int {
        val info = ActivityManager.MemoryInfo()
        (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(info)
        val instances = runCatching {
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
                .filter { !it.isEncoder && hardware(it) && it.supportedTypes.any { type -> type.equals("video/avc", ignoreCase = true) } }
                .maxOfOrNull { it.getCapabilitiesForType("video/avc").maxSupportedInstances }
        }.getOrNull()
        return deviceTileCap((info.totalMem / (1024 * 1024)).toInt(), instances)
    }

    private fun hardware(info: MediaCodecInfo) =
        if (Build.VERSION.SDK_INT >= 29) info.isHardwareAccelerated else !info.name.startsWith("OMX.google.") && !info.name.startsWith("c2.android.")

    // ---- one tile

    private fun attach(tile: MultiTile) {
        tile.player?.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) = changed(tile, state, null)
            override fun onPlayerError(error: PlaybackException) = changed(tile, Player.STATE_IDLE, error)
            override fun onIsPlayingChanged(isPlaying: Boolean) { tile.health?.onPlaying(isPlaying) }
            override fun onRenderedFirstFrame() {
                tile.playedOnce = true
                tile.state = TileState.Playing
            }
        })
    }

    private fun changed(tile: MultiTile, state: Int, error: PlaybackException?) {
        if (tile.state == TileState.Stopped) return
        val stalled = state == Player.STATE_BUFFERING && tile.wasReady && tile.playedOnce
        if (state == Player.STATE_READY) { tile.wasReady = true; if (tile.playedOnce) tile.state = TileState.Playing }
        if (state == Player.STATE_BUFFERING) { tile.wasReady = false; if (tile.playedOnce) tile.state = TileState.Buffering }
        val raw = error?.let { Media3Player.describe(it) }
        val actions = tile.health?.onStatus(Media3Player.status(state, error != null), raw).orEmpty()
        if (error != null && actions.none { it is HealthAction.FailOver }) {
            tile.state = TileState.Failed
            tile.message = explain(raw ?: "")
        }
        carryOut(tile, actions)
        if (stalled) stalledOn(tile)
    }

    private fun carryOut(tile: MultiTile, actions: List<HealthAction>) {
        for (action in actions) when (action) {
            HealthAction.Reload -> load(tile, fresh = false)
            HealthAction.FailOver -> if (tile.at + 1 < tile.order.size) { tile.at += 1; load(tile, fresh = true) } else { tile.state = TileState.Failed; tile.message = "This channel didn't respond." }
            is HealthAction.TryOtherServer -> {}
        }
    }

    /** Asks for the tile's stream (afresh = with a new health record and its place in the feeds kept; else the same stream again). */
    private fun load(tile: MultiTile, fresh: Boolean) {
        tile.loadJob?.cancel()
        val feed = tile.order.getOrNull(tile.at)
        tile.feed = feed
        tile.wasReady = false
        if (fresh) {
            tile.playedOnce = false
            tile.health = PlaybackHealth(false, false, tile.at + 1 < tile.order.size, null, ::nowMs, app.switchOnBuffering)
        }
        if (tile.state != TileState.Playing || fresh) tile.state = TileState.Starting
        tile.loadJob = scope.launch {
            val url = try {
                withContext(Dispatchers.Default) { resolveStream(app.db, app.logins, tile.item, false, null, feed).url }
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                tile.state = TileState.Failed
                tile.message = failure.message ?: "This couldn't be played."
                return@launch
            }
            val player = tile.player ?: return@launch
            player.setMediaItem(MediaItem.fromUri(url))
            player.prepare()
            player.play()
        }
    }

    /** Puts the feed that suits the tile's current size first. Loads the tile again when that changes which feed plays. */
    private fun retarget(tile: MultiTile, slot: Int, force: Boolean = false) {
        val target = minOf(targetHeight(layout.slots[slot].h), tile.ceiling)
        val picked = pickFeed(tile.feeds, tile.item.id, target)
        val rest = tile.feeds.filter { it.variantId != picked?.variantId }
        val order: List<ChannelFeed?> = if (picked != null) listOf<ChannelFeed?>(picked) + rest else if (rest.isEmpty()) listOf(null) else rest
        val changes = picked != null && picked.variantId != tile.feed?.variantId
        tile.order = order
        tile.at = 0
        tile.player?.let { Media3Player.applyTileLook(it, tile !== audio, targetHeight(layout.slots[slot].h)) }
        // A tile still waiting for its turn to start (no load yet) simply starts on the right feed when its turn comes.
        if (changes && !force && tile.loadJob != null) load(tile, fresh = true)
        if (force) tile.feed = order.firstOrNull()
    }

    private fun retargetAll() {
        governor = TileGovernor(::nowMs)
        tiles.forEachIndexed { slot, tile -> retarget(tile, slot) }
    }

    // ---- stalls

    private fun stalledOn(tile: MultiTile) {
        val slot = tiles.indexOf(tile)
        if (slot < 0) return
        val priority = tiles.indices.associateWith { it }
        val action = governor.onStall(slot, priority, softerOf(tile) != null, tiles.indexOf(audio)) ?: return
        when (action) {
            is TileAction.Downshift -> tiles.getOrNull(action.slot)?.let(::lower)
            is TileAction.Reload -> tiles.getOrNull(action.slot)?.let { load(it, fresh = false) }
            is TileAction.Pause -> tiles.getOrNull(action.slot)?.let { stop(it, "Paused to keep the others smooth. Press OK to start it again.") }
        }
    }

    private fun softerOf(tile: MultiTile): ChannelFeed? {
        val slot = tiles.indexOf(tile).coerceAtLeast(0)
        val current = tile.feed ?: pickFeed(tile.feeds, tile.item.id, minOf(targetHeight(layout.slots[slot].h), tile.ceiling))
        return softerFeed(tile.feeds, tile.item.id, current)
    }

    private fun lower(tile: MultiTile) {
        val softer = softerOf(tile) ?: return
        tile.ceiling = qualityHeight(softer.quality) ?: tile.ceiling
        tile.order = listOf<ChannelFeed?>(softer) + tile.feeds.filter { it.variantId != softer.variantId }
        tile.at = 0
        tile.message = "Lowered the quality to keep it smooth"
        scope.launch { delay(5_000); if (tile.message?.startsWith("Lowered") == true) tile.message = null }
        load(tile, fresh = true)
    }

    private fun stop(tile: MultiTile, why: String) {
        tile.loadJob?.cancel()
        tile.player?.stop()
        tile.state = TileState.Stopped
        tile.message = why
    }

    /** Called twice a second: whatever the health records have been waiting on time for (a stuck picture, one that never starts). */
    fun tick() {
        for (tile in tiles.toList()) carryOut(tile, tile.health?.tick().orEmpty())
    }

    // ---- the viewer

    /** OK on a tile: a stopped or failed one starts again, any other gets the sound (and in a layout with a main picture, the main place). */
    fun select(tile: MultiTile) {
        if (tile.state == TileState.Stopped || tile.state == TileState.Failed) { restart(tile); return }
        if (tile === audio) return
        giveSound(tile)
        if (layout.hasMain) makeMain(tile)
    }

    fun restart(tile: MultiTile) {
        governor.forget(tiles.indexOf(tile))
        tile.message = null
        tile.at = 0
        load(tile, fresh = true)
    }

    fun giveSound(tile: MultiTile) {
        val before = audio
        audio = tile
        tiles.forEachIndexed { slot, t -> if (t === before || t === tile) t.player?.let { Media3Player.applyTileLook(it, t !== tile, targetHeight(layout.slots[slot].h)) } }
    }

    fun makeMain(tile: MultiTile) {
        val at = tiles.indexOf(tile)
        if (at <= 0) return
        tiles[at] = tiles[0]
        tiles[0] = tile
        retargetAll()
    }

    fun remove(tile: MultiTile) {
        if (tiles.size <= 2) return
        tile.loadJob?.cancel()
        tile.player?.release()
        tiles.remove(tile)
        app.multiQueue.removeAll { it.id == tile.item.id }
        if (audio === tile) giveSound(tiles.first())
        if (layout.slots.size > tiles.size) layout = startLayout(tiles.size, cap, null)
        retargetAll()
    }

    // ---- adding and swapping without leaving

    /** Channels to offer for an empty place or a swap: favourites, then what was watched lately, minus those already showing. */
    suspend fun suggestions(): List<PlayItem> = withContext(Dispatchers.Default) {
        val showing = tiles.map { it.item.id }.toSet()
        app.db.read { c -> c.listFavouriteChannels() + c.listRecentChannels(40) }
            .filter { it.id !in showing }.distinctBy { it.id }.take(60)
            .map { PlayItem(PlayKind.Channel, it.id, it.normalisedName) }
    }

    /** True when another picture can be added: the device carries it and the layouts have a place for it. */
    fun canAdd() = tiles.size < minOf(cap, MAX_TILES)

    /**
     * Puts [item] in the view: in a new place, or (with [replacing]) in the place of a picture, which stops. The same checks as
     * at the start apply: a provider account that has no stream free refuses it, with a note saying so.
     */
    suspend fun addChannel(item: PlayItem, replacing: MultiTile? = null) {
        if (tiles.any { it.item.id == item.id }) return
        if (replacing == null && !canAdd()) { note = "This device carries $cap pictures smoothly."; return }
        val source = withContext(Dispatchers.Default) { sourceOfPlay(app.db, PlayKind.Channel, item.id) }
        if (source == null) { note = "That channel can't be played right now."; return }
        // The place being given up frees a stream on its own account; any other account must have one free.
        val frees = replacing != null && replacing.sourceId == source.first
        val free = allowanceOf(listOf(TileWish(item.id, source.first) to source.second))(source.first)
        if (!frees && free != null && free < 1) { note = "Your provider doesn't allow another stream at once."; return }
        val tile = MultiTile(item).also { it.sourceId = source.first }
        tile.feeds = withContext(Dispatchers.Default) { app.db.read { it.listChannelFeeds(item.id) } }
        val slot = if (replacing != null) tiles.indexOf(replacing).also { if (it < 0) return } else tiles.size
        val hadSound = replacing != null && replacing === audio
        if (replacing != null) {
            replacing.loadJob?.cancel()
            replacing.player?.release()
            replacing.player = null
            governor.forget(slot)
            app.multiQueue.removeAll { it.id == replacing.item.id }
        }
        val relaid = layout.slots.size <= slot
        if (relaid) layout = startLayout(slot + 1, cap, null)
        if (app.multiQueue.none { it.id == item.id }) app.multiQueue.add(item)
        val sound = hadSound || audio == null
        tile.player = Media3Player.createTile(context, app.http, if (sound) AUDIO_TILE_BUFFER else MUTED_TILE_BUFFER, !sound, targetHeight(layout.slots[slot].h))
        attach(tile)
        if (replacing != null) tiles[slot] = tile else tiles.add(tile)
        if (sound) audio = tile
        retarget(tile, slot, force = true)
        // A bigger layout makes the other pictures smaller: each asks for the feed that fits its new size.
        if (relaid) retargetAll()
        note = null
        load(tile, fresh = true)
    }

    /** The layouts to choose between: those that hold every picture and that this device is happy to carry. */
    fun offered(): List<MultiLayout> = layoutsFor(maxOf(cap, tiles.size)).filter { it.slots.size >= tiles.size }.ifEmpty { listOf(layout) }

    fun chooseLayout(next: MultiLayout) {
        layout = next
        retargetAll()
        scope.launch { withContext(Dispatchers.Default) { app.db.write { it.writeMultiLayout(next) } } }
    }

    fun release() {
        for (tile in tiles) { tile.loadJob?.cancel(); tile.player?.release(); tile.player = null }
        tiles.clear()
    }
}
