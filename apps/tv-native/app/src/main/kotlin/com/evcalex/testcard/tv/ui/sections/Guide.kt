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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.db.ChannelRow
import com.evcalex.testcard.core.db.browseChannels
import com.evcalex.testcard.core.db.listCategories
import com.evcalex.testcard.core.db.listFavouriteChannels
import com.evcalex.testcard.core.db.listRecentChannels
import com.evcalex.testcard.core.guide.Airing
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.playback.clock24
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.ChannelLogo
import com.evcalex.testcard.tv.ui.components.Focusable
import com.evcalex.testcard.tv.ui.components.Pill
import com.evcalex.testcard.tv.ui.shell.SectionContext
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
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

private fun floorToSlot(ms: Long) = ms / (SLOT_MIN * MINUTE) * SLOT_MIN * MINUTE

/** One stretch of a row: a programme, or time the listings do not cover. */
private class Segment(val key: Long, val start: Long, val end: Long, val airing: Airing?, /** "loading" or "none" when there is no programme. */ val empty: String? = null)

/** What the remote is on, for the details above the grid. */
private class Focused(val channel: ChannelRow, val segment: Segment)

/**
 * A row's programmes cut to the window, with the gaps between them filled so every part of the row can be reached. Keyed by
 * where each block starts, so the block the remote is on while a row loads is the one that replaces it and keeps focus.
 */
private fun segmentsFor(airings: List<Airing>?, from: Long, to: Long): List<Segment> {
    if (airings == null) return listOf(Segment(from, from, to, null, "loading"))
    val out = ArrayList<Segment>()
    var cursor = from
    for (airing in airings) {
        if (airing.end <= cursor || airing.start >= to) continue
        if (airing.start > cursor) out += Segment(cursor, cursor, airing.start, null, "none")
        val start = Math.max(airing.start, cursor)
        val end = Math.min(airing.end, to)
        out += Segment(start, start, end, airing)
        cursor = end
    }
    if (cursor < to) out += Segment(cursor, cursor, to, null, "none")
    return out
}

private class GuideList(val id: String, val label: String)

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
 * The TV guide: channels down the side, time across the top, what is on and what is coming as blocks the remote moves over. OK on
 * any block watches that channel. Listings come from the imported guide when there is one, else from the provider a few channels
 * at a time as they come on screen. Left and Right at the grid's edges move it an hour (`Guide.tsx`).
 */
@Composable
fun GuideScreen(ctx: SectionContext) {
    val app = ctx.app
    val sourceId = ctx.sourceId
    val active = ctx.active
    fun own(channel: ChannelRow) = sourceId == null || channel.sourceId == sourceId

    // The lists to pick from: your own first, then every category.
    val lists by produceState(emptyList<GuideList>(), app.version, app.catalogue, sourceId) {
        val categories = app.memoByCatalogue("live-categories", sourceId) { it.listCategories(sourceId).browsable() }
        val (favourites, recents) = app.db.read { c -> c.listFavouriteChannels().count(::own) to c.listRecentChannels(60).count(::own) }
        value = buildList {
            if (favourites > 0) add(GuideList("favourites", "Favourites"))
            if (recents > 0) add(GuideList("recent", "Recently watched"))
            for (category in categories.filter { it.count > 0 }) add(GuideList(category.id, category.label))
            add(GuideList("all", "All channels"))
        }
    }
    var listId by remember { mutableStateOf<String?>(null) }
    val shownList = listId?.takeIf { id -> lists.any { it.id == id } } ?: lists.firstOrNull()?.id ?: "all"
    val channels by produceState(emptyList<ChannelRow>(), app.version, shownList, sourceId) {
        value = app.db.read { c ->
            when (shownList) {
                "favourites" -> c.listFavouriteChannels().filter(::own)
                "recent" -> c.listRecentChannels(60).filter(::own)
                "all" -> c.browseChannels(limit = ALL_CHANNELS_MOST, sourceId = sourceId)
                else -> c.browseChannels(categoryId = shownList, limit = ALL_CHANNELS_MOST, sourceId = sourceId)
            }
        }
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

    var focused by remember { mutableStateOf<Focused?>(null) }
    // Where focus should land after the grid moves or a list opens: the block covering `at` on that channel's row.
    var wantFocus by remember { mutableStateOf<Pair<String, Long>?>(null) }
    // Only when a list opens: a sync that re-reads the same list leaves the remote where it was.
    LaunchedEffect(shownList) {
        offsetMin = 0
        wantFocus = null
    }
    val firstId = channels.firstOrNull()?.id
    LaunchedEffect(shownList, firstId) { if (firstId != null && wantFocus == null && focused == null) wantFocus = firstId to nowMs() }

    fun play(channel: ChannelRow) {
        ctx.actions.playChannel(channel.id, channel.normalisedName, channels.take(300).map { it.id to it.normalisedName })
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
        return false
    }

    Column(Modifier.fillMaxSize().padding(start = 44.dp, end = 44.dp, top = 104.dp)) {
        Details(focused, now)
        LazyRow(Modifier.height(72.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)) {
            items(lists, key = { it.id }) { list -> Pill(list.label, { listId = list.id }, active = list.id == shownList) }
        }
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val pxPerMs = (maxWidth.value - CHANNEL_W) / (WINDOW_MIN * MINUTE).toFloat()
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxWidth().height(44.dp).border(width = 1.dp, color = Color.Transparent)) {
                    AppText(dayLabel(from, now), 22, Palette.foreground, FontWeight.SemiBold, Modifier.align(Alignment.CenterStart).padding(start = 8.dp))
                    for (index in 0 until WINDOW_MIN / SLOT_MIN) {
                        val slot = from + index * SLOT_MIN * MINUTE
                        AppText(clock24(slot), 20, Palette.muted, modifier = Modifier.align(Alignment.CenterStart).offset(x = (CHANNEL_W + (slot - from) * pxPerMs).dp).padding(start = 8.dp))
                    }
                }
                Box(Modifier.fillMaxSize()) {
                    if (channels.isEmpty()) AppText("No channels in this list.", 24, Palette.muted, modifier = Modifier.padding(top = 40.dp))
                    else LazyColumn(Modifier.fillMaxSize()) {
                        items(channels, key = { it.id }) { channel ->
                            GuideRow(
                                ctx, channel, from, to, pxPerMs, now,
                                preferredAt = wantFocus?.takeIf { it.first == channel.id }?.second,
                                onFocusCell = { next -> focused = next; wantFocus = null },
                                onPage = { cell, direction -> page(cell, direction) },
                                onPlay = ::play,
                            )
                        }
                    }
                    if (now in from until to) Box(Modifier.offset(x = (CHANNEL_W + (now - from) * pxPerMs).dp).width(3.dp).fillMaxHeight().background(Palette.live.copy(alpha = 0.8f)))
                }
            }
        }
    }
}

/** The block the remote is on, spelled out above the grid. */
@Composable
private fun Details(focused: Focused?, now: Long) {
    Column(Modifier.fillMaxWidth().height(150.dp).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.Bottom)) {
        if (focused == null) return@Column
        val airing = focused.segment.airing
        val channel = focused.channel
        val when_ = when {
            airing == null -> null
            airing.start <= now && now < airing.end -> "On now   ${clock24(airing.start)} to ${clock24(airing.end)}   ${Math.max(1, Math.round((airing.end - now) / MINUTE.toDouble()))} min left"
            else -> "${dayLabel(airing.start, now).let { if (it == "Today") "" else "$it " }}${clock24(airing.start)} to ${clock24(airing.end)}"
        }
        AppText(if (channel.channelNumber != null) "${channel.channelNumber}  ${channel.normalisedName}" else channel.normalisedName, 22, Palette.muted, maxLines = 1)
        AppText(airing?.title ?: if (focused.segment.empty == "loading") "Loading the guide…" else "No listings for this time", 40, Palette.foreground, FontWeight.SemiBold, maxLines = 1, letterSpacing = -0.4f)
        AppText(if (when_ != null) "$when_   ·   OK to watch ${channel.normalisedName}" else "OK to watch ${channel.normalisedName}", 22, Palette.faint, maxLines = 1)
    }
}

/** One channel's row: its logo and name, then its programmes laid out along the time axis. */
@Composable
private fun GuideRow(
    ctx: SectionContext, channel: ChannelRow, from: Long, to: Long, pxPerMs: Float, now: Long, preferredAt: Long?,
    onFocusCell: (Focused) -> Unit, onPage: (Focused, Int) -> Boolean, onPlay: (ChannelRow) -> Unit,
) {
    val guides = ctx.app.guides
    val airings by produceState<List<Airing>?>(guides.knownListings(channel.id), channel.id) {
        value = withContext(Dispatchers.Default) { guides.fetchListings(channel.id) }
    }
    val segments = remember(airings, from, to) { segmentsFor(airings, from, to) }
    Row(Modifier.fillMaxWidth().height(ROW_H.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.width(CHANNEL_W.dp).padding(end = 12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(96.dp).height(64.dp).background(Palette.sunken, RoundedCornerShape(10.dp)).padding(6.dp)) { ChannelLogo(channel.logoUrl, channel.normalisedName, 26) }
            AppText(channel.normalisedName, 20, Palette.muted, modifier = Modifier.weight(1f), maxLines = 2)
        }
        Box(Modifier.weight(1f).height((ROW_H - 12).dp)) {
            segments.forEachIndexed { index, segment ->
                androidx.compose.runtime.key(segment.key) {
                    GuideCell(
                        channel, segment, first = index == 0, last = index == segments.lastIndex,
                        left = ((segment.start - from) * pxPerMs), width = Math.max(2f, (segment.end - segment.start) * pxPerMs - 4),
                        clipped = segment.airing != null && segment.airing.start < from,
                        airingNow = segment.airing != null && segment.airing.start <= now && now < segment.airing.end,
                        preferred = preferredAt != null && segment.start <= preferredAt && preferredAt < segment.end,
                        onFocusCell = onFocusCell, onPage = onPage, onPlay = onPlay,
                    )
                }
            }
        }
    }
}

/** One block in a row. While the remote is on it, a change to what it shows (its row loaded) is reported again. */
@Composable
private fun GuideCell(
    channel: ChannelRow, segment: Segment, first: Boolean, last: Boolean, left: Float, width: Float, clipped: Boolean, airingNow: Boolean, preferred: Boolean,
    onFocusCell: (Focused) -> Unit, onPage: (Focused, Int) -> Boolean, onPlay: (ChannelRow) -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val requester = remember { FocusRequester() }
    LaunchedEffect(preferred) { if (preferred) { androidx.compose.runtime.withFrameNanos { }; runCatching { requester.requestFocus() } } }
    LaunchedEffect(focused, segment) { if (focused) onFocusCell(Focused(channel, segment)) }
    val airing = segment.airing
    Focusable(
        { onPlay(channel) },
        Modifier.offset(x = left.dp).width(width.dp).height((ROW_H - 12).dp).onKeyEvent { event ->
            // Right on the row's last block, or Left on its first, moves the window rather than the remote.
            if (event.type != KeyEventType.KeyDown || event.nativeKeyEvent.repeatCount > 0) false
            else if (event.key == Key.DirectionRight && last) onPage(Focused(channel, segment), 1)
            else if (event.key == Key.DirectionLeft && first) onPage(Focused(channel, segment), -1)
            else false
        },
        RoundedCornerShape(8.dp), onFocusChange = { focused = it }, focusRequester = requester,
        background = if (airing == null) Color.Transparent else if (airingNow) Palette.card else Palette.raised, focusedBackground = Palette.accent,
    ) { isFocused ->
        Column(
            Modifier.fillMaxSize().then(if (airing == null && !isFocused) Modifier.border(1.dp, Palette.border, RoundedCornerShape(8.dp)) else Modifier).padding(horizontal = 14.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            AppText(
                if (airing != null) "${if (clipped) "‹ " else ""}${airing.title}" else if (segment.empty == "loading") "" else "No listings",
                22, if (isFocused) Palette.accentInk else Palette.foreground, FontWeight.Medium, maxLines = 1,
            )
            if (airing != null) AppText("${clock24(airing.start)} to ${clock24(airing.end)}", 18, if (isFocused) Palette.accentInk else Palette.faint, maxLines = 1)
        }
    }
}
