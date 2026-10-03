package com.evcalex.testcard.tv.ui.browse

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.guide.ChannelGuide
import com.evcalex.testcard.core.normalise.genreOptions
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.ChannelLogo
import com.evcalex.testcard.tv.ui.components.Focusable
import com.evcalex.testcard.tv.ui.components.MenuRow
import com.evcalex.testcard.tv.ui.components.Pill
import com.evcalex.testcard.tv.ui.components.PosterCard
import com.evcalex.testcard.tv.ui.components.PosterItem
import com.evcalex.testcard.tv.ui.components.withCommas
import com.evcalex.testcard.tv.ui.home.clock
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Something to pick in the grid: a film or series poster, or a channel. */
class BrowseItem(
    val id: String,
    val title: String,
    val imageUrl: String?,
    /** 0 to 1 when started and not finished. */
    val progress: Float? = null,
    val number: Int? = null,
    /** A film that has a saved position worth offering to resume. */
    val resume: Boolean = false,
    val watched: Boolean = false,
) {
    fun sameAs(other: BrowseItem) = title == other.title && imageUrl == other.imageUrl && progress == other.progress && number == other.number && resume == other.resume && watched == other.watched
}

class Selection(val kind: String, val key: String)

class Special(val key: String, val label: String, val count: Int)

class BrowseCategory(val id: String, val label: String, val count: Int, val genre: String?)

/** Pinning a category to the Home page. Left out where it does not apply. */
class Pinning(
    val pinned: Set<String>,
    val toggle: (categoryId: String, label: String) -> Unit,
    /** Takes the category out of every list (Settings brings it back). */
    val hide: (categoryId: String, label: String) -> Unit,
)

class BrowseSource(
    /** How the grid draws an item: "poster" or "channel". */
    val layout: String,
    /** "movies", "series", "channels": used for the empty message and the header count. */
    val noun: String,
    /** The same word for exactly one: "movie", "series", "channel". */
    val single: String,
    /** Fixed entries at the top of the list (continue watching, my list, history, all). Empty ones are hidden except "all". */
    val specials: List<Special>,
    val categories: List<BrowseCategory>,
    /** The items for a selection, at most `limit` of them. */
    val load: suspend (Selection, Int) -> List<BrowseItem>,
    /** What is on a channel right now. Asked of the provider, so only for the channel the remote rests on. */
    val guide: (suspend (String) -> ChannelGuide?)? = null,
    /** Whether the list offers the Genres group. On by default; Live TV turns it off. */
    val genres: Boolean = true,
    /** Where the categories sit: "list" down the left (default) or "pills" across the top. */
    val menu: String = "list",
    val pinning: Pinning? = null,
)

private sealed interface Entry {
    val id: String

    class Row(override val id: String, val label: String, val count: Int, val selection: Selection, val indent: Boolean) : Entry

    class Genres(val label: String, val count: Int) : Entry {
        override val id = GENRES_ID
    }
}

private const val GENRES_ID = "genres"

/** The category each section had open, so coming back from a film or the player lands where you were. */
private val remembered = HashMap<String, Pair<String, Selection>>()
private const val PAGE = 60
private const val MAX_ITEMS = 600

/** How long the remote must rest on a category before it opens, so scrolling past dozens does not load dozens. */
private const val OPEN_AFTER_MS = 160L

/** How long the remote must rest on a channel before its guide is asked for. */
private const val GUIDE_AFTER_MS = 350L

/** A channel's guide is good for this long before it is asked for again. */
private const val GUIDE_FRESH_MS = 5 * 60 * 1000L

/**
 * Categories down the left, what is in the highlighted one on the right (the TiviMate layout, with the desktop app's categories,
 * counts and genres). Everything is a plain read of the local database; only the rows on screen are drawn (`Browse.tsx`).
 */
@Composable
fun BrowseScreen(source: BrowseSource, empty: String, onSelect: (BrowseItem, List<BrowseItem>) -> Unit) {
    val genres = remember(source) { genreOptions(source.categories.map { it.genre to it.count }) }
    var genresOpen by remember { mutableStateOf(false) }
    val entries = remember(source, genres, genresOpen) {
        buildList<Entry> {
            for (special in source.specials) if (special.count > 0 || special.key == "all") add(Entry.Row("s:${special.key}", special.label, special.count, Selection("special", special.key), false))
            if (source.genres && genres.isNotEmpty()) {
                add(Entry.Genres("Genres", genres.size))
                if (genresOpen) for (genre in genres) add(Entry.Row("g:${genre.genre}", genre.label, genre.count, Selection("genre", genre.genre), true))
            }
            for (category in source.categories) add(Entry.Row("c:${category.id}", category.label, category.count, Selection("category", category.id), false))
        }
    }
    val byId = remember(entries) { entries.associateBy { it.id } }
    val first = entries.firstOrNull { it is Entry.Row && it.count > 0 } as? Entry.Row
    var open by remember(source.noun) { mutableStateOf(remembered[source.noun]) }
    // Until the viewer picks, show the first entry that has something in it. The remembered category can be gone (an emptied
    // Continue watching): fall back to the first one.
    val current = open?.takeIf { byId.containsKey(it.first) } ?: first?.let { it.id to it.selection }
    val shown = current?.first
    var limit by remember(shown) { mutableIntStateOf(PAGE) }
    val items by produceState<List<BrowseItem>>(emptyList(), source, current?.first, limit) {
        val selection = current?.second ?: return@produceState
        val loaded = withContext(Dispatchers.Default) { source.load(selection, limit) }
        // An unchanged item keeps the object it had, so its tile does not redraw.
        val before = value.associateBy { it.id }
        value = loaded.map { item -> before[item.id]?.takeIf { it.sameAs(item) } ?: item }
    }
    val shownEntry = shown?.let { byId[it] } as? Entry.Row
    var pinNote by remember { mutableStateOf<String?>(null) }
    var confirmHide by remember { mutableStateOf<String?>(null) }
    var pinnedNow by remember(source) { mutableStateOf(source.pinning?.pinned ?: emptySet()) }
    LaunchedEffect(pinNote) { if (pinNote != null) { delay(3000); pinNote = null } }
    val pinnable = if (source.pinning != null && shownEntry?.selection?.kind == "category") shownEntry.selection.key to shownEntry.label else null
    val pinned = pinnable != null && pinnable.first in pinnedNow

    fun openEntry(id: String) {
        val entry = byId[id] as? Entry.Row ?: return
        open = id to entry.selection
        remembered[source.noun] = id to entry.selection
    }
    var restingEntry by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(restingEntry) {
        val id = restingEntry ?: return@LaunchedEffect
        delay(OPEN_AFTER_MS)
        openEntry(id)
    }
    val onPressEntry = { id: String ->
        restingEntry = null
        if (id == GENRES_ID) genresOpen = !genresOpen else openEntry(id)
    }

    // The channel the remote rests on, for the "on now" strip above the grid.
    var restingId by remember { mutableStateOf<String?>(null) }
    var pendingRest by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(pendingRest) {
        val id = pendingRest ?: return@LaunchedEffect
        delay(GUIDE_AFTER_MS)
        restingId = id
    }
    val preview = items.firstOrNull { it.id == restingId } ?: items.firstOrNull()
    val previewId = preview?.id
    var guides by remember { mutableStateOf<Map<String, Pair<Long, ChannelGuide?>>>(emptyMap()) }
    val guideOf = source.guide
    LaunchedEffect(guideOf, previewId) {
        if (guideOf == null || previewId == null) return@LaunchedEffect
        val known = guides[previewId]
        if (known != null && nowMs() - known.first < GUIDE_FRESH_MS) return@LaunchedEffect
        val guide = try { withContext(Dispatchers.Default) { guideOf(previewId) } } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error else null }
        guides = guides + (previewId to (nowMs() to guide))
    }

    val poster = source.layout == "poster"
    val pills = source.menu == "pills"
    val columns = if (poster) 7 else if (pills) 4 else 3
    val gridState = rememberLazyGridState()
    val scope = rememberCoroutineScope()
    var gridRow by remember(shown) { mutableIntStateOf(-1) }
    // More are read as the grid nears its end.
    LaunchedEffect(gridState, items.size) {
        snapshotFlow { gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.collect { last ->
            if (last >= items.size - columns * 2 && limit < MAX_ITEMS && items.size >= limit) limit += PAGE
        }
    }
    // The row the remote is on is brought to a steady place in the frame, so it is never left half cut off at an edge.
    val alignRow = { index: Int ->
        val row = index / columns
        if (gridRow != row) {
            gridRow = row
            scope.launch { gridState.animateScrollToItem(row * columns, -(gridState.layoutInfo.viewportSize.height * 0.3f).toInt()) }
        }
    }
    val select = { item: BrowseItem -> onSelect(item, items) }

    if (entries.isEmpty() || (first == null && source.categories.isEmpty())) {
        Column(Modifier.fillMaxSize().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
            AppText("No ${source.noun} yet", 28, Palette.foreground, FontWeight.SemiBold)
            AppText(empty, 22, Palette.muted)
        }
        return
    }

    val pane: @Composable (Modifier) -> Unit = { modifier ->
        Column(modifier) {
            Row(Modifier.padding(start = 8.dp, end = 8.dp, top = 12.dp, bottom = 24.dp), horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.Bottom) {
                AppText(shownEntry?.label ?: "", 38, Palette.foreground, FontWeight.SemiBold, Modifier.weight(1f, fill = false), maxLines = 1, letterSpacing = -0.5f)
                if (shownEntry != null) AppText("${withCommas(shownEntry.count)} ${if (shownEntry.count == 1) source.single else source.noun}", 24, Palette.faint)
            }
            // On its own line, above the first column, so pressing up from the first poster lands on it.
            if (pinnable != null) Row(Modifier.padding(start = 8.dp, end = 8.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Focusable({
                    source.pinning?.toggle?.invoke(pinnable.first, pinnable.second)
                    pinnedNow = if (pinned) pinnedNow - pinnable.first else pinnedNow + pinnable.first
                    pinNote = if (pinned) "Removed from your Home page" else "Added to your Home page"
                }, Modifier, CircleShape, ring = false, background = Palette.card) { focused ->
                    AppText(if (pinned) "Pinned to Home. Press to remove" else "Pin to Home", 24, if (focused) Palette.foreground else if (pinned) Palette.accent else Palette.muted, modifier = Modifier.padding(horizontal = 22.dp, vertical = 8.dp))
                }
                Focusable({
                    if (confirmHide != pinnable.first) confirmHide = pinnable.first
                    else { confirmHide = null; source.pinning?.hide?.invoke(pinnable.first, pinnable.second) }
                }, Modifier, CircleShape, ring = false, background = Palette.card) { focused ->
                    AppText(if (confirmHide == pinnable.first) "Press again to hide it" else "Hide category", 24, if (focused) Palette.foreground else Palette.muted, modifier = Modifier.padding(horizontal = 22.dp, vertical = 8.dp))
                }
                pinNote?.let { AppText(it, 24, Palette.accent, modifier = Modifier.padding(start = 20.dp)) }
            }
            if (guideOf != null && preview != null) OnNow(preview, guides[preview.id] != null, guides[preview.id]?.second, pills)
            if (items.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { AppText("Nothing in here yet.", 22, Palette.muted) }
            else LazyVerticalGrid(
                GridCells.Fixed(columns), Modifier.fillMaxSize(), gridState, PaddingValues(bottom = 80.dp),
                horizontalArrangement = Arrangement.spacedBy(if (poster) 18.dp else 16.dp), verticalArrangement = Arrangement.spacedBy(if (poster) 0.dp else 0.dp),
            ) {
                itemsIndexed(items) { index, item ->
                    if (poster) PosterCard(
                        PosterItem(item.id, item.title, item.imageUrl, item.progress, item.watched), { select(item) }, grid = true,
                        onFocusItem = { alignRow(index) },
                    ) else ChannelTile(item, card = pills, onClick = { select(item) }, onFocus = { alignRow(index); pendingRest = item.id })
                }
            }
        }
    }

    if (pills) {
        Column(Modifier.fillMaxSize()) {
            val pillEntries = entries.filterIsInstance<Entry.Row>()
            LazyRow(Modifier.padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
                items(pillEntries, key = { it.id }) { entry ->
                    Pill(entry.label, { onPressEntry(entry.id) }, active = entry.id == shown, onFocusChange = { if (it) restingEntry = entry.id })
                }
            }
            pane(Modifier.weight(1f).fillMaxWidth())
        }
    } else {
        Row(Modifier.fillMaxSize()) {
            LazyColumn(Modifier.width(380.dp).padding(end = 20.dp)) {
                items(entries, key = { it.id }) { entry ->
                    when (entry) {
                        is Entry.Genres -> MenuRow(entry.label, { onPressEntry(entry.id) }, open = genresOpen)
                        is Entry.Row -> MenuRow(entry.label, { onPressEntry(entry.id) }, indent = entry.indent, active = entry.id == shown, onFocusChange = { if (it) restingEntry = entry.id })
                    }
                }
            }
            pane(Modifier.weight(1f).padding(start = 12.dp))
        }
    }
}

private fun <T> androidx.compose.foundation.lazy.grid.LazyGridScope.itemsIndexed(items: List<T>, content: @Composable androidx.compose.foundation.lazy.grid.LazyGridItemScope.(Int, T) -> Unit) {
    items(items.size, key = { index -> (items[index] as BrowseItem).id }) { index -> content(index, items[index]) }
}

/** The channel the remote rests on, with what is airing and what follows, above the grid. */
@Composable
private fun OnNow(item: BrowseItem, loaded: Boolean, guide: ChannelGuide?, hero: Boolean) {
    val now = guide?.now
    val next = guide?.next
    val span = if (now != null) now.end - now.start else 0L
    val progress = if (now != null && span > 0) ((nowMs() - now.start).toFloat() / span).coerceIn(0f, 1f) else 0f
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp).padding(bottom = if (hero) 26.dp else 22.dp).background(Color(0x0DFFFFFF), RoundedCornerShape(20.dp)).padding(if (hero) 28.dp else 20.dp),
        horizontalArrangement = Arrangement.spacedBy(if (hero) 32.dp else 24.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.then(if (hero) Modifier.size(200.dp, 132.dp) else Modifier.size(132.dp, 88.dp)).clip(RoundedCornerShape(12.dp)).background(Palette.sunken)) {
            ChannelLogo(item.imageUrl, item.title, if (hero) 44 else 30)
        }
        Column(Modifier.weight(1f).height(118.dp), verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically)) {
            AppText(if (item.number != null) "${item.number}  ${item.title}" else item.title, 22, Palette.accent, FontWeight.SemiBold, maxLines = 1, letterSpacing = 0.5f)
            if (now != null) {
                AppText(now.title, if (hero) 46 else 32, Palette.foreground, FontWeight.SemiBold, maxLines = 1, letterSpacing = if (hero) -0.8f else -0.4f)
                Row(horizontalArrangement = Arrangement.spacedBy(18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(200.dp).height(6.dp).clip(CircleShape).background(Color(0x26FFFFFF))) { Box(Modifier.fillMaxHeight().fillMaxWidth(progress).background(Palette.accent)) }
                    AppText("${clock(now.start)} to ${clock(now.end)}${if (next != null) "   Next ${clock(next.start)}  ${next.title}" else ""}", 22, Palette.muted, modifier = Modifier.weight(1f), maxLines = 1)
                }
            } else if (next != null) {
                // The provider only listed what is coming up.
                AppText(next.title, 32, Palette.foreground, FontWeight.SemiBold, maxLines = 1)
                AppText("Starts ${clock(next.start)}", 22, Palette.muted)
            } else AppText(if (loaded) "No guide for this channel" else "", 26, Palette.faint)
        }
    }
}

@Composable
private fun ChannelTile(item: BrowseItem, card: Boolean, onClick: () -> Unit, onFocus: () -> Unit) {
    Focusable(
        onClick, Modifier.fillMaxWidth().padding(bottom = 14.dp), RoundedCornerShape(16.dp), onFocusChange = { if (it) onFocus() }, ring = false,
        background = Palette.raised, focusedBackground = Color(0x24FFFFFF),
    ) { _ ->
        if (card) Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.fillMaxWidth().height(110.dp).clip(RoundedCornerShape(10.dp)).background(Palette.sunken)) { ChannelLogo(item.imageUrl, item.title, 40) }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                AppText(item.title, 24, Palette.foreground, FontWeight.Medium, Modifier.weight(1f), maxLines = 1)
                if (item.number != null) AppText(item.number.toString(), 22, Palette.faint)
            }
        } else Row(Modifier.padding(vertical = 12.dp, horizontal = 18.dp), horizontalArrangement = Arrangement.spacedBy(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(84.dp, 56.dp).clip(RoundedCornerShape(10.dp)).background(Palette.sunken)) { ChannelLogo(item.imageUrl, item.title, 24) }
            AppText(item.title, 24, Palette.foreground, FontWeight.Medium, Modifier.weight(1f), maxLines = 1)
            if (item.number != null) AppText(item.number.toString(), 22, Palette.faint)
        }
    }
}
