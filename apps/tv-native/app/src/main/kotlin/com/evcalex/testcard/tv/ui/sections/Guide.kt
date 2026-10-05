package com.evcalex.testcard.tv.ui.sections

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.db.CategoryKind
import com.evcalex.testcard.core.db.ChannelRow
import com.evcalex.testcard.core.db.browseChannels
import com.evcalex.testcard.core.db.listCategories
import com.evcalex.testcard.core.db.listFavouriteChannels
import com.evcalex.testcard.core.db.listRecentChannels
import com.evcalex.testcard.core.db.removeChannelFromRecents
import com.evcalex.testcard.core.db.toggleFavourite
import com.evcalex.testcard.core.guide.Airing
import com.evcalex.testcard.core.guide.GuideSegment
import com.evcalex.testcard.core.guide.nowAndNext
import com.evcalex.testcard.core.guide.segmentsFor
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.playback.clock24
import com.evcalex.testcard.tv.ui.browse.Pinning
import com.evcalex.testcard.tv.ui.components.ActionGlyph
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.ChannelLogo
import com.evcalex.testcard.tv.ui.components.DetailAction
import com.evcalex.testcard.tv.ui.components.Focusable
import com.evcalex.testcard.tv.ui.components.Glyph
import com.evcalex.testcard.tv.ui.components.OptionsSheet
import com.evcalex.testcard.tv.ui.components.SheetOption
import com.evcalex.testcard.tv.ui.components.monogram
import com.evcalex.testcard.tv.ui.shell.SectionContext
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Calendar

/** How much of the day is on screen at once, and how far Left and Right move it at an edge. */
private const val WINDOW_MIN = 120
private const val STEP_MIN = 60
/** How far ahead the guide goes: past this, providers rarely list anything. */
private const val FURTHEST_MIN = 24 * 60
private const val SLOT_MIN = 30
private const val CHANNEL_W = 300
private const val ROW_H = 96
private const val ALL_CHANNELS_MOST = 2000
private const val MINUTE = 60_000L

/** Rows asked about beyond the ones on screen: a few above, more below, so a scroll finds them filled. */
private const val LOOK_BEHIND = 4
private const val LOOK_AHEAD = 12
private const val LISTINGS_REFRESH_MS = 20 * 60_000L

private fun floorToSlot(ms: Long) = ms / (SLOT_MIN * MINUTE) * SLOT_MIN * MINUTE

/** What the remote is on, for the info pane above the grid. */
private class Focused(val channel: ChannelRow, val segment: GuideSegment)

private fun dayLabel(at: Long, now: Long): String {
    fun day(ms: Long) = Calendar.getInstance().apply { timeInMillis = ms; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
    val days = Math.round((day(at).timeInMillis - day(now).timeInMillis) / 86_400_000.0).toInt()
    return when (days) {
        0 -> "Today"
        1 -> "Tomorrow"
        else -> java.text.SimpleDateFormat("EEEE", java.util.Locale.getDefault()).format(java.util.Date(at))
    }
}

/**
 * Live TV: the TV guide, channels down the side, time across the top, what is on and what is coming as blocks the remote moves
 * over, and a rail of lists (favourites, recents, categories) at the left that Left from the first block opens. OK on any block
 * watches that channel; holding OK offers the channel's options. Listings come from the imported guide when there is one, else
 * from the provider a few channels at a time as they come on screen. Left and Right at the grid's edges move it an hour (`Guide.tsx`).
 */
@Composable
fun GuideScreen(ctx: SectionContext) {
    val app = ctx.app
    val sourceId = ctx.sourceId
    val active = ctx.active
    val guides = app.guides
    fun own(channel: ChannelRow) = sourceId == null || channel.sourceId == sourceId
    val scope = rememberCoroutineScope()
    // Bumped when a change made here (favourite, hide) means the lists should be read again.
    var tick by remember { mutableIntStateOf(0) }

    // The lists to pick from, null until read: favourites, recents, every category, then all.
    val lists by produceState<List<GuideList>?>(null, app.version, app.catalogue, app.sources, sourceId, tick) {
        // With several sources and none picked in the nav bar, each source is its own section of the rail: nothing is merged.
        val bySource = if (sourceId == null) app.sources.filter { it.channels > 0 }.takeIf { it.size > 1 } else null
        val categories = if (bySource != null) emptyList() else app.memoByCatalogue("live-categories", sourceId) { it.listCategories(sourceId).browsable() }
        val (favourites, recents) = app.db.read { c -> c.listFavouriteChannels().count(::own) to c.listRecentChannels(60).count(::own) }
        value = buildList {
            add(GuideList("favourites", "Favourites", favourites, RailMark.Icon(Glyph.Star)))
            add(GuideList("recent", "Recently watched", recents, RailMark.Icon(Glyph.Restart)))
            if (bySource != null) for (source in bySource) {
                val own = app.memoByCatalogue("live-categories", source.id) { it.listCategories(source.id).browsable() }.filter { it.count > 0 }
                if (own.isEmpty()) continue
                add(GuideList("all:${source.id}", "All channels", own.sumOf { it.count }, RailMark.Letters("All"), source.name))
                for (c in own) add(GuideList(c.id, c.label, c.count, RailMark.Letters(c.label.trim().take(2).replaceFirstChar { it.uppercase() }), source.name))
            } else {
                for (c in categories.filter { it.count > 0 }) add(GuideList(c.id, c.label, c.count, RailMark.Letters(c.label.trim().take(2).replaceFirstChar { it.uppercase() })))
                add(GuideList("all", "All channels", categories.sumOf { it.count }, RailMark.Letters("All")))
            }
        }
    }
    var listId by rememberSaveable { mutableStateOf<String?>(null) }
    val shownList: String? = lists?.let { all ->
        listId?.takeIf { id -> all.any { it.id == id } }
            ?: all.firstOrNull { it.id == "favourites" && it.count > 0 }?.id
            ?: all.firstOrNull { it.id == "recent" && it.count > 0 }?.id
            ?: all.firstOrNull { it.isAll() }?.id ?: "all"
    }
    // The starting list is chosen once: adding a first favourite must not swap the grid under the remote.
    LaunchedEffect(shownList) { if (listId == null && shownList != null) listId = shownList }
    // The list the channels below were read for, so a list just picked can wait for its channels.
    var channelsFor by remember { mutableStateOf<String?>(null) }
    val channels by produceState<List<ChannelRow>?>(null, app.version, shownList, sourceId, tick) {
        val id = shownList ?: return@produceState
        value = app.db.read { c ->
            when (id) {
                "favourites" -> c.listFavouriteChannels().filter(::own)
                "recent" -> c.listRecentChannels(60).filter(::own)
                "all" -> c.browseChannels(limit = ALL_CHANNELS_MOST, sourceId = sourceId)
                else -> if (id.startsWith("all:")) c.browseChannels(limit = ALL_CHANNELS_MOST, sourceId = id.removePrefix("all:"))
                else c.browseChannels(categoryId = id, limit = ALL_CHANNELS_MOST, sourceId = sourceId)
            }
        }
        channelsFor = id
    }

    // The clock moves the now line and, once the window's first slot is over, the window itself.
    var now by remember { mutableLongStateOf(nowMs()) }
    LaunchedEffect(active) {
        while (active) { now = nowMs(); delay(30_000) }
    }
    val earliest = floorToSlot(now)
    var offsetMin by remember { mutableStateOf(0) }
    val from = earliest + offsetMin * MINUTE
    val to = from + WINDOW_MIN * MINUTE

    val gridState = rememberLazyListState()
    // Every row's programmes, filled for the rows on screen and a lookahead; overwritten, never cleared, so cells do not flash.
    val listings = remember { mutableStateMapOf<String, List<Airing>>() }
    LaunchedEffect(channels, active, app.version, now / LISTINGS_REFRESH_MS) {
        val rows = channels ?: return@LaunchedEffect
        if (!active || rows.isEmpty()) return@LaunchedEffect
        snapshotFlow { gridState.layoutInfo.visibleItemsInfo.let { (it.firstOrNull()?.index ?: 0) to (it.lastOrNull()?.index ?: 0) } }
            .distinctUntilChanged()
            .collectLatest { (first, last) ->
                delay(80) // let a held key settle before querying
                val ids = rows.subList(maxOf(0, first - LOOK_BEHIND), minOf(rows.size, last + 1 + LOOK_AHEAD)).map { it.id }
                val stored = withContext(Dispatchers.Default) { guides.storedListings(ids) }
                listings.putAll(stored)
                for (id in ids) if (id !in stored) launch { listings[id] = withContext(Dispatchers.Default) { guides.fetchListings(id) } }
            }
    }

    var focused by remember { mutableStateOf<Focused?>(null) }
    // Where focus should land after the grid moves or a list opens: the block covering `at` on that channel's row.
    var wantFocus by remember { mutableStateOf<Pair<String, Long>?>(null) }
    // Only when a list opens: a sync that re-reads the same list leaves the remote where it was.
    LaunchedEffect(shownList) {
        offsetMin = 0
        wantFocus = null
    }
    // Back from the player (or another tab) uncovers the guide: the remote returns to the cell it left, not the nav bar.
    val wasActive = remember { booleanArrayOf(active) }
    LaunchedEffect(active) {
        if (active && !wasActive[0]) focused?.let { wantFocus = it.channel.id to it.segment.start }
        wasActive[0] = active
    }
    // Back sent the remote to the nav bar: the guide starts again from now and its top row.
    val seenBack = remember { intArrayOf(ctx.backToTop) }
    LaunchedEffect(ctx.backToTop) {
        if (ctx.backToTop != seenBack[0]) {
            seenBack[0] = ctx.backToTop
            offsetMin = 0
            gridState.scrollToItem(0)
            focused = null
        }
    }

    // The rail of lists.
    var railOpen by remember { mutableStateOf(false) }
    val railState = rememberLazyListState()
    val railRequesters = remember(lists) { lists.orEmpty().associate { it.id to FocusRequester() } }
    fun openRail() {
        val current = shownList ?: return
        railOpen = true
        scope.launch {
            // The separator after "recent" is an item of its own.
            railState.scrollToItem(railItemIndex(lists.orEmpty(), current))
            androidx.compose.runtime.withFrameNanos { }
            runCatching { railRequesters[current]?.requestFocus() }
        }
    }
    fun closeRail(id: String) {
        listId = id
        scope.launch {
            // Wait for the picked list's channels before choosing the row to land on.
            withTimeoutOrNull(3_000) { snapshotFlow { channelsFor }.first { it == id } }
            val keep = focused?.channel?.id
            val index = channels.orEmpty().indexOfFirst { it.id == keep }.coerceAtLeast(0)
            offsetMin = 0
            gridState.scrollToItem(index)
            wantFocus = channels.orEmpty().getOrNull(index)?.let { it.id to nowMs() }
            railOpen = false
        }
    }
    BackTo(railOpen) { closeRail(shownList ?: "all") }
    // Pinning or hiding a category drops the focused rail item (or the sheet's focus owner): put the remote back on the rail.
    var railRefocus by remember { mutableStateOf(0) }
    LaunchedEffect(railRefocus, lists) {
        if (railRefocus == 0 || !railOpen) return@LaunchedEffect
        delay(150)
        runCatching { railRequesters[shownList ?: "all"]?.requestFocus() }
    }

    fun play(channel: ChannelRow) {
        ctx.actions.playChannel(channel.id, channel.normalisedName, channels.orEmpty().take(300).map { it.id to it.normalisedName })
    }
    fun page(cell: Focused, direction: Int): Boolean {
        if (direction > 0 && offsetMin + WINDOW_MIN < FURTHEST_MIN) {
            offsetMin += STEP_MIN
            wantFocus = cell.channel.id to to
            return true
        }
        if (direction < 0 && offsetMin > 0) {
            offsetMin = Math.max(0, offsetMin - STEP_MIN)
            wantFocus = cell.channel.id to (from - 1)
            return true
        }
        if (direction < 0) { openRail(); return true }
        return false
    }

    // Holding OK on a channel: watch, favourite, forget, move, hide.
    var channelSheet by remember { mutableStateOf<ChannelRow?>(null) }
    val sheetActions by produceState(emptyList<DetailAction>(), channelSheet) {
        val channel = channelSheet
        if (channel == null) { value = emptyList(); return@produceState }
        val refresh: () -> Unit = { tick++ }
        value = buildList {
            add(DetailAction("watch", "Watch live", ActionGlyph.Restart) { play(channel) })
            add(DetailAction("favourite", if (channel.isFavourite) "Remove from Favourites" else "Add to Favourites", ActionGlyph.Plus) {
                app.scope.launch { app.db.write { it.toggleFavourite(channel.id) }; app.sync.notifyLocalChange(); refresh() }
            })
            if (shownList == "recent") add(DetailAction("forget", "Remove from Recently watched", ActionGlyph.Cross) {
                app.scope.launch { app.db.write { it.removeChannelFromRecents(channel.id) }; refresh() }
            })
            addAll(channelExtras(app, channel.id, channel.normalisedName, shownList == "favourites", refresh))
        }
    }
    // Holding OK on a category in the rail: pin it to Home, or hide it.
    var categorySheet by remember { mutableStateOf<GuideList?>(null) }
    val pinning by produceState<Pinning?>(null, categorySheet) {
        value = if (categorySheet == null) null else app.db.read { it.pinningFor(app, CategoryKind.Live) { app.bump() } }
    }

    val all = lists
    if (all == null || channels == null) { Box(Modifier.fillMaxSize()); return }
    if (all.all { it.count == 0 }) {
        EmptyNote(if (sourceId != null) NOTHING_FROM_SOURCE else "Sources that sync from your account load here. Open Sources to see progress.")
        return
    }
    val rows = channels.orEmpty()
    // Before the remote is on the grid, the info pane describes the top channel.
    val shown = focused?.takeIf { f -> rows.any { it.id == f.channel.id } } ?: rows.firstOrNull()?.let { Focused(it, GuideSegment(from, to, null)) }

    Box(Modifier.fillMaxSize().padding(top = 104.dp)) {
        Column(Modifier.fillMaxSize().padding(start = (RAIL_COLLAPSED_W + 24).dp, end = 44.dp)) {
            // The picture only runs while the remote is on a cell: opening Live TV alone never starts a stream.
            LiveHeader(shown, listings, now, Modifier.height(284.dp)) {
                if (active && !railOpen) LivePreview(app, focused?.channel)
            }
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val pxPerMs = (maxWidth.value - CHANNEL_W) / (WINDOW_MIN * MINUTE).toFloat()
                Column(Modifier.fillMaxSize()) {
                    if (rows.isNotEmpty()) Box(Modifier.fillMaxWidth().height(44.dp)) {
                        AppText(dayLabel(from, now), 22, Palette.foreground, FontWeight.SemiBold, Modifier.align(Alignment.CenterStart).padding(start = 8.dp))
                        for (index in 0 until WINDOW_MIN / SLOT_MIN) {
                            val slot = from + index * SLOT_MIN * MINUTE
                            AppText(clock24(slot), 20, Palette.muted, modifier = Modifier.align(Alignment.CenterStart).offset(x = (CHANNEL_W + (slot - from) * pxPerMs).dp).padding(start = 8.dp))
                        }
                    }
                    Box(Modifier.fillMaxSize()) {
                        // Focusable, so the remote can still reach the rail (Left or OK) when the list has nothing to land on.
                        if (rows.isEmpty()) Focusable(
                            ::openRail,
                            Modifier.padding(top = 24.dp).onPreviewKeyEvent { e ->
                                if (e.type == KeyEventType.KeyDown && e.key == Key.DirectionLeft) { openRail(); true } else false
                            },
                        ) { focused ->
                            AppText(
                                when (shownList) {
                                    "favourites" -> "No favourite channels yet. Hold OK on a channel to add it."
                                    "recent" -> "Channels you watch show up here."
                                    else -> "No channels in this list."
                                },
                                24, if (focused) Palette.foreground else Palette.muted, modifier = Modifier.padding(16.dp),
                            )
                        }
                        else LazyColumn(Modifier.fillMaxSize().focusRestorer(), gridState) {
                            itemsIndexed(rows, key = { _, channel -> channel.id }) { index, channel ->
                                GuideRow(
                                    channel, listings[channel.id], from, to, pxPerMs, now,
                                    preferredAt = wantFocus?.takeIf { it.first == channel.id }?.second,
                                    onFocusCell = { next -> focused = next; wantFocus = null },
                                    onPage = { cell, direction -> page(cell, direction) },
                                    onPlay = ::play,
                                    onLongPress = { channelSheet = it },
                                    onUpEdge = if (index == 0) ({ ctx.focusNav(); true }) else null,
                                )
                            }
                        }
                        if (rows.isNotEmpty() && now in from until to) Box(Modifier.offset(x = (CHANNEL_W + (now - from) * pxPerMs).dp).width(3.dp).fillMaxHeight().background(Palette.live.copy(alpha = 0.8f)))
                    }
                }
            }
        }
        if (railOpen) Box(Modifier.fillMaxSize().background(Color(0x9E050709)))
        GuideRail(
            all, shownList ?: "all", railOpen,
            onPick = { listId = it }, onClose = ::closeRail, onLongPress = { categorySheet = it },
            requesters = railRequesters, state = railState,
        )
    }

    val sheet = channelSheet
    if (sheet != null && sheetActions.isNotEmpty()) OptionsSheet(
        sheet.normalisedName, sheetActions.map { SheetOption(it.key, it.label) },
        onChoose = { key -> sheetActions.firstOrNull { it.key == key }?.onPress?.invoke(); channelSheet = null },
        onClose = { channelSheet = null },
    )
    val category = categorySheet
    val pins = pinning
    if (category != null && pins != null) OptionsSheet(
        category.label,
        listOf(SheetOption("pin", if (category.id in pins.pinned) "Pinned to Home. Press to remove" else "Pin to Home"), SheetOption("hide", "Hide category")),
        onChoose = { key ->
            if (key == "pin") pins.toggle(category.id, category.label)
            else {
                pins.hide(category.id, category.label)
                if (shownList == category.id) listId = null
            }
            categorySheet = null
            railRefocus++
        },
        onClose = { categorySheet = null },
    )
}

/** The picture frame and, beside it, what the focused block is: channel, title, time, how far through, and what follows. */
@Composable
private fun LiveHeader(focused: Focused?, listings: Map<String, List<Airing>>, now: Long, modifier: Modifier, picture: @Composable () -> Unit) {
    val channel = focused?.channel
    val airings = channel?.let { listings[it.id] }
    val airing = focused?.segment?.airing
    val guide = airings?.let { nowAndNext(it, now) }
    var title = ""
    var time: String? = null
    var fraction: Float? = null
    var extra: String? = null
    if (airings != null) {
        if (airing != null && !(airing.start <= now && now < airing.end)) {
            title = airing.title
            time = "${dayLabel(airing.start, now).let { if (it == "Today") "" else "$it " }}${clock24(airing.start)} to ${clock24(airing.end)}"
            guide?.now?.let { extra = "On now: ${it.title}" }
        } else {
            val current = guide?.now
            if (current == null) title = "No listings for this time"
            else {
                title = current.title
                time = "${clock24(current.start)} to ${clock24(current.end)} · ${Math.max(1, Math.round((current.end - now) / MINUTE.toDouble()))} min left"
                fraction = ((now - current.start).toFloat() / (current.end - current.start)).coerceIn(0f, 1f)
            }
            guide?.next?.let { extra = "Next: ${clock24(it.start)} ${it.title}" }
        }
    }
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(32.dp)) {
        PreviewFrame(channel, picture)
        Column(Modifier.weight(1f).height(252.dp), verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically)) {
            if (channel != null) AppText(if (channel.channelNumber != null) "${channel.channelNumber}  ${channel.normalisedName}" else channel.normalisedName, 22, Palette.muted, maxLines = 1)
            AppText(title, 40, Palette.foreground, FontWeight.SemiBold, maxLines = 2, letterSpacing = -0.4f)
            if (time != null) AppText(time, 22, Palette.faint, maxLines = 1)
            if (fraction != null) Box(Modifier.fillMaxWidth(0.6f).height(4.dp).background(Palette.border)) {
                Box(Modifier.fillMaxWidth(fraction).fillMaxHeight().background(Palette.accent))
            }
            if (extra != null) AppText(extra!!, 22, Palette.muted, maxLines = 1)
        }
    }
}

/** The 16:9 frame beside the info: the channel's logo on a dark ground, a LIVE badge, and any `picture` over the logo. */
@Composable
private fun PreviewFrame(channel: ChannelRow?, picture: @Composable () -> Unit = {}) {
    Box(Modifier.width(448.dp).height(252.dp).clip(RoundedCornerShape(12.dp)).background(Palette.sunken)) {
        if (channel != null) Box(Modifier.align(Alignment.Center).size(200.dp, 120.dp)) { ChannelLogo(channel.logoUrl, channel.normalisedName, 40) }
        picture()
        if (channel != null) Row(Modifier.align(Alignment.TopStart).padding(start = 18.dp, top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(12.dp).background(Palette.live, CircleShape))
            AppText("LIVE", 18, Palette.foreground, FontWeight.SemiBold)
        }
    }
}

/** One channel's row: its number, logo and name, then its programmes laid out along the time axis. */
@Composable
private fun GuideRow(
    channel: ChannelRow, airings: List<Airing>?, from: Long, to: Long, pxPerMs: Float, now: Long, preferredAt: Long?,
    onFocusCell: (Focused) -> Unit, onPage: (Focused, Int) -> Boolean, onPlay: (ChannelRow) -> Unit, onLongPress: (ChannelRow) -> Unit,
    onUpEdge: (() -> Boolean)?,
) {
    val segments = remember(airings, from, to) { segmentsFor(airings, from, to) }
    Row(Modifier.fillMaxWidth().height(ROW_H.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.width(CHANNEL_W.dp).padding(end = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            AppText(channel.channelNumber?.toString() ?: "", 22, Palette.muted, align = TextAlign.End, modifier = Modifier.width(56.dp), maxLines = 1)
            Box(Modifier.width(80.dp).height(56.dp).background(Palette.sunken, RoundedCornerShape(10.dp)).padding(6.dp)) { ChannelLogo(channel.logoUrl, channel.normalisedName, 26) }
            AppText(channel.normalisedName, 20, Palette.muted, modifier = Modifier.weight(1f), maxLines = 2)
        }
        Box(Modifier.weight(1f).height((ROW_H - 12).dp)) {
            segments.forEachIndexed { index, segment ->
                androidx.compose.runtime.key(segment.start) {
                    GuideCell(
                        channel, segment, first = index == 0, last = index == segments.lastIndex,
                        left = ((segment.start - from) * pxPerMs), width = Math.max(2f, (segment.end - segment.start) * pxPerMs - 4),
                        clipped = segment.airing.let { it != null && it.start < from },
                        airingNow = segment.airing.let { it != null && it.start <= now && now < it.end },
                        preferred = preferredAt != null && segment.start <= preferredAt && preferredAt < segment.end,
                        onFocusCell = onFocusCell, onPage = onPage, onPlay = onPlay, onLongPress = onLongPress, onUpEdge = onUpEdge,
                    )
                }
            }
        }
    }
}

/** One block in a row. While the remote is on it, a change to what it shows (its row loaded) is reported again. */
@Composable
private fun GuideCell(
    channel: ChannelRow, segment: GuideSegment, first: Boolean, last: Boolean, left: Float, width: Float, clipped: Boolean, airingNow: Boolean, preferred: Boolean,
    onFocusCell: (Focused) -> Unit, onPage: (Focused, Int) -> Boolean, onPlay: (ChannelRow) -> Unit, onLongPress: (ChannelRow) -> Unit,
    onUpEdge: (() -> Boolean)?,
) {
    var focused by remember { mutableStateOf(false) }
    val requester = remember { FocusRequester() }
    LaunchedEffect(preferred) { if (preferred) { androidx.compose.runtime.withFrameNanos { }; runCatching { requester.requestFocus() } } }
    LaunchedEffect(focused, segment) { if (focused) onFocusCell(Focused(channel, segment)) }
    val airing = segment.airing
    Focusable(
        { onPlay(channel) },
        Modifier.offset(x = left.dp).width(width.dp).height((ROW_H - 12).dp)
            // Up on the top row goes to the nav tab; asked before the list tries to scroll.
            .onPreviewKeyEvent { event -> event.type == KeyEventType.KeyDown && event.key == Key.DirectionUp && onUpEdge != null && onUpEdge() }
            .onKeyEvent { event ->
                // Right on the row's last block, or Left on its first, moves the window rather than the remote.
                if (event.type != KeyEventType.KeyDown || event.nativeKeyEvent.repeatCount > 0) false
                else if (event.key == Key.DirectionRight && last) onPage(Focused(channel, segment), 1)
                else if (event.key == Key.DirectionLeft && first) onPage(Focused(channel, segment), -1)
                else false
            },
        RoundedCornerShape(8.dp), onLongClick = { onLongPress(channel) }, onFocusChange = { focused = it }, focusRequester = requester,
        background = if (segment.loading) Palette.raised.copy(alpha = 0.5f) else if (airing == null) Color.Transparent else if (airingNow) Palette.card else Palette.raised,
        focusedBackground = Palette.accent,
    ) { isFocused ->
        Column(
            Modifier.fillMaxSize().then(if (airing == null && !segment.loading && !isFocused) Modifier.border(1.dp, Palette.border, RoundedCornerShape(8.dp)) else Modifier).padding(horizontal = 14.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            if (!segment.loading) AppText(
                if (airing != null) "${if (clipped) "‹ " else ""}${airing.title}" else "No listings",
                22, if (isFocused) Palette.accentInk else Palette.foreground, FontWeight.Medium, maxLines = 1,
            )
            if (airing != null) AppText("${clock24(airing.start)} to ${clock24(airing.end)}", 18, if (isFocused) Palette.accentInk else Palette.faint, maxLines = 1)
        }
    }
}
