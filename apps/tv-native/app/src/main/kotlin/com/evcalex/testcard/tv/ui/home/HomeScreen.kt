package com.evcalex.testcard.tv.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.guide.ChannelGuide
import com.evcalex.testcard.core.normalise.splitTitle
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.ArtImage
import com.evcalex.testcard.tv.ui.components.ChannelLogo
import com.evcalex.testcard.tv.ui.components.ChannelShelf
import com.evcalex.testcard.tv.ui.components.Facts
import com.evcalex.testcard.tv.ui.components.Fade
import com.evcalex.testcard.tv.ui.components.FadeFrom
import com.evcalex.testcard.tv.ui.components.Focusable
import com.evcalex.testcard.tv.ui.components.Glyph
import com.evcalex.testcard.tv.ui.components.GlyphIcon
import com.evcalex.testcard.tv.ui.components.OptionsSheet
import com.evcalex.testcard.tv.ui.components.PosterItem
import com.evcalex.testcard.tv.ui.components.PosterRow
import com.evcalex.testcard.tv.ui.components.SheetOption
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The band at the top of the rows that a row scrolls up under; the focused row is lined up just below it. */
private const val ROWS_BAND = 56

/**
 * How long the remote must rest on a poster before the hero changes, so flicking along a row does not redraw it every step.
 * Past the remote's key-repeat interval, so holding a direction along a row does not swap (and decode) the hero's art on every step.
 */
private const val HERO_AFTER_MS = 240L

/** Longer, since this one costs a request to the provider. */
private const val DETAIL_AFTER_MS = 700L

private class Shown(val item: HomeItem, val row: String, val rowKey: String)

/**
 * The Movies / Series / Live landing page, laid out like a streaming service (`Home.tsx`): full-bleed art behind the nav bar, a
 * hero that describes the highlighted title, and rows under it. Rows are plain reads of the local database, built by the
 * caller; only the ones near the screen are drawn. Holding OK on a card lists what can be done with that title.
 */
@Composable
fun HomeScreen(
    rows: List<HomeRow>,
    heroActions: suspend (HomeItem, String) -> HeroActions,
    onSelect: (PosterItem) -> Unit,
    backToTop: Int,
    fetchDetail: (suspend (String) -> HomeDetail?)? = null,
    browseAll: (() -> Unit)? = null,
) {
    val byKey = remember(rows) {
        val map = HashMap<String, Shown>()
        for (row in rows) for (item in row.items) map.putIfAbsent("${row.key}|${item.id}", Shown(item, row.label, row.key))
        map
    }
    val first = rows.firstOrNull()?.items?.firstOrNull()
    // Unset until the remote rests on a poster: until then the hero follows the first row's first title, which is Continue
    // watching once the history has synced in.
    var focusedKey by remember { mutableStateOf<String?>(null) }
    var pendingKey by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(pendingKey) {
        if (pendingKey == null) return@LaunchedEffect
        delay(HERO_AFTER_MS)
        focusedKey = pendingKey
    }
    val shown = (focusedKey?.let { byKey[it] }) ?: first?.let { Shown(it, rows[0].label, rows[0].key) }

    var details by remember { mutableStateOf<Map<String, HomeDetail>>(emptyMap()) }
    val asked = remember { HashSet<String>() }
    // A highlighted title with no plot or length gets them fetched once the remote has rested on it for a moment.
    val shownId = shown?.item?.id
    val missing = shown != null && (shown.item.plot.isNullOrEmpty() || shown.item.durationSecs == null)
    // A channel's guide goes out of date when the programme on now ends: asked again then.
    val onNowEnd = shownId?.let { details[it]?.guide?.now?.end }
    val stale = onNowEnd != null && onNowEnd <= nowMs()
    LaunchedEffect(shownId, missing, stale) {
        if (fetchDetail == null || shownId == null || !missing) return@LaunchedEffect
        if (stale) asked.remove(shownId)
        if (shownId in asked) return@LaunchedEffect
        delay(DETAIL_AFTER_MS)
        asked += shownId
        try {
            withContext(Dispatchers.Default) { fetchDetail(shownId) }?.let { detail -> details = details + (shownId to detail) }
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            // The hero works without them. Asked again next time the remote rests here, since a failure is not an answer.
            asked -= shownId
        }
    }

    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val listState = rememberLazyListState()
    val bandPx = with(androidx.compose.ui.platform.LocalDensity.current) { ROWS_BAND.dp.roundToPx() }
    val offsetRows = if (browseAll != null) 1 else 0
    var rowOnFocus by remember { mutableIntStateOf(-1) }
    var scrolled by remember { mutableStateOf(false) }
    var moved by remember { mutableStateOf(false) }
    var options by remember { mutableStateOf<Pair<String, HeroActions>?>(null) }
    var heldAt by remember { mutableStateOf(0L) }

    // Back to the nav bar (see backToTop): the rows go back to the top and the hero to the first title.
    LaunchedEffect(backToTop) {
        if (backToTop == 0 || !moved) return@LaunchedEffect
        moved = false
        listState.scrollToItem(0)
        scrolled = false
        rowOnFocus = -1
        pendingKey = null
        focusedKey = null
    }

    var pendingScroll by remember { mutableStateOf<Int?>(null) }
    val select: (PosterItem) -> Unit = { item -> if (nowMs() - heldAt >= 800) onSelect(item) }
    val focusRow = { index: Int, row: HomeRow, item: PosterItem ->
        moved = true
        pendingKey = "${row.key}|${item.id}"
        scrolled = index > 0
        // The row the remote is on is lined up just below the top band, so it is never left half cut off at the edge.
        if (rowOnFocus != index) {
            rowOnFocus = index
            pendingScroll = index + offsetRows
        }
    }
    LaunchedEffect(pendingScroll) {
        val target = pendingScroll ?: return@LaunchedEffect
        listState.animateScrollToItem(target, -bandPx)
        pendingScroll = null
    }

    Column(Modifier.fillMaxSize().background(Palette.background)) {
        Hero(
            shown,
            plot = shown?.item?.let { item -> if (!item.plot.isNullOrEmpty()) item.plot else details[item.id]?.plot },
            durationSecs = shown?.item?.let { it.durationSecs ?: details[it.id]?.durationSecs },
            detail = shown?.item?.id?.let { details[it] },
        )
        Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 44.dp)) {
            LazyColumn(state = listState, contentPadding = PaddingValues(top = 20.dp, bottom = 100.dp)) {
                if (offsetRows == 1) item("header") {
                    Row(Modifier.padding(bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        if (browseAll != null) HeaderButton("All categories", browseAll)
                    }
                }
                itemsIndexed(rows, key = { _, row -> row.key }) { index, row ->
                    val modifier = Modifier.padding(bottom = 24.dp)
                    val onFocus = { item: PosterItem -> focusRow(index, row, item) }
                    val onHold = { item: PosterItem ->
                        heldAt = nowMs()
                        val full = byKey["${row.key}|${item.id}"]?.item
                        if (full != null) scope.launch { options = splitTitle(full.name).title to heroActions(full, row.key) }
                    }
                    if (row.channels) ChannelShelf(row.label, row.items, select, modifier, onFocus, onHold, row.pinned)
                    else PosterRow(row.label, row.items, select, modifier, onFocus, onHold, row.pinned, row.ranked)
                }
            }
            // Solid, with only its lower edge fading: the strip above the focused row holds the bottom of the row before it.
            if (scrolled) Column(Modifier.fillMaxWidth().height(ROWS_BAND.dp)) {
                Box(Modifier.fillMaxWidth().height((ROWS_BAND - 16).dp).background(Palette.background))
                Fade(FadeFrom.Top, Modifier.fillMaxWidth().height(16.dp))
            }
            // The next row's title peeks in at the bottom edge; faded out rather than sliced through.
            Fade(FadeFrom.Bottom, Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(72.dp))
        }
    }
    options?.let { (title, actions) ->
        OptionsSheet(
            title,
            listOf(SheetOption("primary", actions.primary.label)) + actions.actions.map { SheetOption(it.key, it.label) },
            { id -> if (id == "primary") actions.primary.onPress() else actions.actions.firstOrNull { it.key == id }?.onPress() },
            { options = null },
        )
    }
}

/** A way into every category (or the guide), above the rows: a quiet pill until the remote is on it. */
@Composable
private fun HeaderButton(label: String, onClick: () -> Unit) {
    Focusable(onClick, Modifier.height(52.dp), CircleShape, ring = false, background = Color.Transparent, focusedBackground = Palette.foreground) { focused ->
        Row(
            Modifier.fillMaxHeight().border(2.dp, if (focused) Palette.foreground else Palette.border, CircleShape).padding(start = 24.dp, end = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            val ink = if (focused) Palette.background else Palette.muted
            AppText(label, 22, ink, FontWeight.Medium, maxLines = 1)
            GlyphIcon(Glyph.ChevronRight, ink, 26.dp)
        }
    }
}

@Composable
private fun Hero(shown: Shown?, plot: String?, durationSecs: Double?, detail: HomeDetail?) {
    // A title that wraps to a second line takes the plot's second line, so the buttons always stay inside the hero.
    var titleLines by remember { mutableIntStateOf(1) }
    val wrapped = titleLines > 1
    val item = shown?.item
    val channel = item?.isChannel == true
    val parts = if (item != null) (if (channel) null else splitTitle(item.name)) else null
    val title = if (channel) item?.name ?: "" else parts?.title ?: ""
    val rating = item?.rating?.toDoubleOrNull()?.takeIf { it > 0 && it <= 10 }?.let { String.format(java.util.Locale.ROOT, "%.1f", it) }
    val facts = if (channel) listOfNotNull("Live", item?.channelNumber?.let { "Channel $it" })
    else listOfNotNull(parts?.year, durationSecs?.takeIf { it >= 60 }?.let { runtimeLabel(it) }, rating?.let { "$it rating" }, if (parts?.is4k == true) "4K" else null)
    val art = item?.posterUrl
    Box(Modifier.fillMaxWidth().height(570.dp).background(Palette.background).clipToBounds()) {
        if (channel) {
            Box(Modifier.align(Alignment.TopEnd).padding(top = 130.dp, end = 120.dp).size(440.dp, 280.dp).background(Palette.raised, RoundedCornerShape(24.dp)).padding(28.dp)) {
                ChannelLogo(art, item?.name ?: "", 96)
            }
        } else if (!art.isNullOrEmpty()) {
            Box(Modifier.align(Alignment.TopEnd).size(1180.dp, 570.dp).clipToBounds()) {
                ArtImage(art, Modifier.requiredSize(1180.dp, 1770.dp).offset(y = (-270).dp), large = true)
                Fade(FadeFrom.Left, Modifier.fillMaxSize())
                // The picture dissolves into the page at its own foot, not cut off square.
                Fade(FadeFrom.Bottom, Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(280.dp))
            }
        }
        Fade(FadeFrom.Top, Modifier.align(Alignment.TopCenter).fillMaxWidth().height(220.dp), 0.85f)
        Fade(FadeFrom.Bottom, Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(200.dp))
        Column(Modifier.padding(start = 52.dp, top = 118.dp).width(1000.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            AppText(shown?.row ?: "", 24, Palette.accent, FontWeight.SemiBold, maxLines = 1, letterSpacing = 1f)
            AppText(title, 68, Palette.foreground, FontWeight.SemiBold, maxLines = 2, letterSpacing = -1.5f, lineHeight = 78, onTextLayout = { titleLines = it })
            Box(Modifier.height(44.dp)) { Facts(facts) }
            if (channel && detail != null && detail.isGuide) NowNext(detail.guide)
            else AppText(plot ?: "", 25, Color(0xFFC3C9CE), maxLines = if (wrapped) 1 else 2, lineHeight = 36, modifier = Modifier.padding(top = 2.dp).height(if (wrapped) 36.dp else 72.dp))
            if (shown != null) Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.border(2.dp, Color(0x40FFFFFF), RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 2.dp)) { AppText("OK", 18, Palette.muted, FontWeight.SemiBold) }
                AppText("Hold for more options", 22, Palette.faint)
            }
        }
    }
}

/** "13:00" from epoch ms. */
fun clock(ms: Long): String {
    val calendar = java.util.Calendar.getInstance().apply { timeInMillis = ms }
    return String.format(java.util.Locale.ROOT, "%02d:%02d", calendar.get(java.util.Calendar.HOUR_OF_DAY), calendar.get(java.util.Calendar.MINUTE))
}

/**
 * A channel's hero line: the programme on now with how far through it is and how long is left, then what follows. Said plainly
 * when the channel has no guide, so an empty hero is never a question of whether it is still loading.
 */
@Composable
private fun NowNext(guide: ChannelGuide?) {
    if (guide == null || (guide.now == null && guide.next == null)) {
        AppText("No programme guide for this channel", 23, Palette.faint, modifier = Modifier.height(72.dp).padding(top = 2.dp), lineHeight = 36)
        return
    }
    val now = nowMs()
    val on = guide.now
    val through = if (on != null && on.end > on.start) ((now - on.start).toFloat() / (on.end - on.start)).coerceIn(0f, 1f) else null
    val left = if (on != null) maxOf(0L, Math.round((on.end - now) / 60_000.0)) else null
    Column(Modifier.height(72.dp).padding(top = 2.dp), verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically)) {
        if (on != null) Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            AppText("NOW", 20, Palette.accent, FontWeight.SemiBold, Modifier.width(80.dp), letterSpacing = 1f)
            AppText(on.title, 25, Palette.foreground, FontWeight.Medium, Modifier.weight(1f, fill = false), maxLines = 1)
            if (through != null) Box(Modifier.width(160.dp).height(5.dp).background(Color(0x30FFFFFF), CircleShape)) { Box(Modifier.fillMaxHeight().fillMaxWidth(through).background(Palette.foreground)) }
            if (left != null) AppText(if (left >= 60) "${left / 60}h ${left % 60}m left" else "${left}m left", 21, Palette.muted, maxLines = 1)
        }
        guide.next?.let { next ->
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                AppText(clock(next.start), 20, Palette.accent, FontWeight.SemiBold, Modifier.width(80.dp), letterSpacing = 1f)
                AppText(next.title, 25, Color(0xFFC3C9CE), maxLines = 1)
            }
        }
    }
}
