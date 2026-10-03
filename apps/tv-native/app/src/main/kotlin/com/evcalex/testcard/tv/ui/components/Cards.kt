package com.evcalex.testcard.tv.ui.components

import androidx.compose.animation.core.animateFloat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.absoluteOffset
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.evcalex.testcard.core.normalise.splitTitle
import com.evcalex.testcard.core.text.sized
import com.evcalex.testcard.tv.ui.theme.Palette

/** A poster or channel card: what the rows and grids draw. */
@Immutable
open class PosterItem(
    val id: String,
    val name: String,
    val posterUrl: String?,
    /** 0 to 1 when started and not finished. */
    val progress: Float? = null,
    /** Already seen: shows a quiet checkmark instead of the progress bar. */
    val watched: Boolean = false,
    /** A short line under the title: which episode is next, or how long is left. */
    val note: String? = null,
    /** Present on a live channel; null when it has no number. */
    val channelNumber: Int? = null,
    val isChannel: Boolean = false,
)

/**
 * Source names by id, provided while the lists mix more than one source, so each poster can say where it is from. Null when
 * only one source is showing, where the label would be noise. Item ids start with their source id.
 */
val LocalSourceNames = compositionLocalOf<Map<String, String>?> { null }

private fun sourceOf(id: String) = id.substring(0, maxOf(0, id.indexOf(':')))

const val POSTER_WIDTH = 200

/** A card's full footprint (art width plus its own padding): what a sibling row must match to keep columns aligned. */
const val POSTER_CARD_WIDTH = POSTER_WIDTH + 4 * 2

@Composable
fun ArtImage(url: String, modifier: Modifier = Modifier, large: Boolean = false, fit: ContentScale = ContentScale.Crop, onError: (() -> Unit)? = null) {
    AsyncImage(
        ImageRequest.Builder(LocalContext.current).data(sized(url, large)).crossfade(false).build(), null, modifier, contentScale = fit,
        onError = onError?.let { handler -> { handler() } },
    )
}

/** A poster and its title. `grid` lets it share a grid row with its neighbours instead of keeping a fixed width. */
@Composable
fun PosterCard(
    item: PosterItem,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onFocusItem: ((PosterItem) -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    grid: Boolean = false,
    focusRequester: FocusRequester? = null,
) {
    val parts = remember(item.name) { splitTitle(item.name) }
    val sourceName = LocalSourceNames.current?.get(sourceOf(item.id))
    val progress = item.progress?.takeIf { it > 0f }?.coerceAtMost(1f)
    Focusable(
        onClick, modifier.then(if (grid) Modifier.fillMaxWidth() else Modifier.width(POSTER_WIDTH.dp)).padding(0.dp),
        RoundedCornerShape(16.dp), onLongClick = onLongClick, onFocusChange = { if (it) onFocusItem?.invoke(item) }, focusRequester = focusRequester, ring = false,
    ) { focused ->
        Column(Modifier.padding(4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)).background(Palette.raised)
                    .border(3.dp, if (focused) Palette.accent else Color.Transparent, RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center,
            ) {
                if (!item.posterUrl.isNullOrEmpty()) ArtImage(item.posterUrl, Modifier.fillMaxSize())
                else AppText(parts.title, 18, Palette.muted, modifier = Modifier.padding(16.dp), maxLines = 4, align = TextAlign.Center)
                if (parts.is4k) Box(Modifier.align(Alignment.TopStart).padding(10.dp).background(Color(0xB3000000), RoundedCornerShape(6.dp)).padding(horizontal = 10.dp, vertical = 3.dp)) {
                    AppText("4K", 17, Palette.foreground, FontWeight.SemiBold, letterSpacing = 0.5f)
                }
                if (sourceName != null) Box(
                    Modifier.align(Alignment.BottomStart).padding(start = 8.dp, bottom = 14.dp).fillMaxWidth(0.9f).background(Color(0xCC000000), RoundedCornerShape(8.dp))
                        .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 4.dp),
                ) { AppText(sourceName, 20, Palette.foreground, FontWeight.Bold, maxLines = 1) }
                if (progress != null) Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(5.dp).background(Color(0x88000000))) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(progress).background(Palette.accent))
                }
                if (progress == null && item.watched) Box(Modifier.align(Alignment.TopEnd).padding(10.dp).size(30.dp).background(Color(0xB3000000), CircleShape), contentAlignment = Alignment.Center) {
                    GlyphIcon(Glyph.Check, Palette.accent, 18.dp)
                }
            }
            // With a note the title keeps to one line, so the card is no taller than its neighbours.
            AppText(parts.title, 21, if (focused) Palette.foreground else Palette.muted, maxLines = if (item.note != null) 1 else 2, modifier = Modifier.height(if (item.note != null) 28.dp else 56.dp))
            if (item.note != null) AppText(item.note, 18, if (focused) Palette.accent else Palette.faint, maxLines = 1, modifier = Modifier.padding(top = 0.dp))
        }
    }
}

/** Quiet, dark tones that sit with the rest of the app; a channel keeps the same one wherever it is shown. */
private val TONES = listOf(0xFF2B3A4A, 0xFF3A2F45, 0xFF23413A, 0xFF4A3328, 0xFF2F3D24, 0xFF452A33, 0xFF26364A, 0xFF3D3A26, 0xFF1F3F45, 0xFF40283F).map { Color(it) }

private val QUALITY = Regex("^(?:\\d*K|UHD|FHD|HDR\\d*|HD|SD|\\d{3,4}P\\d{0,3}|HEVC|H\\.?265)$", RegexOption.IGNORE_CASE)

/** Up to four letters that stand for a channel when it has no logo: "BBC One" -> "BBC1", "Sky News" -> "SN" (`ChannelLogo.monogram`). */
fun monogram(name: String): String {
    val words = name.replace(Regex("[^\\p{L}\\p{N}\\s+&]"), " ").split(Regex("\\s+")).filter { it != "" && !QUALITY.matches(it) }
    if (words.isEmpty()) return name.trim().take(2).uppercase()
    val first = words[0]
    val second = words.getOrNull(1)
    val numberWords = mapOf("one" to "1", "two" to "2", "three" to "3", "four" to "4", "five" to "5")
    val secondMark = if (second == null) "" else if (Regex("^\\+?\\d{1,2}\\+?$").matches(second)) second else numberWords[second.lowercase()] ?: ""
    // A name that leads with an acronym or a number ("BBC", "ITV2", "5USA") is best known by it.
    if (Regex("^[\\p{Lu}\\p{N}]{2,4}\\+?$").matches(first)) return (first + secondMark).take(4)
    // "Film4" is "F4".
    val lead = first.take(1) + (Regex("\\d+$").find(first)?.value ?: "")
    if (secondMark != "" || lead.length > 1) return (lead + secondMark).uppercase().take(4)
    return words.take(2).joinToString("") { it.take(1) }.uppercase()
}

private fun toneFor(name: String): Color {
    var hash = 0
    for (char in name) hash = hash * 31 + char.code
    return TONES[Math.abs(hash) % TONES.size]
}

/** A channel's logo filling its panel, or, when the source has none or it will not load, the channel's letters on a colour of its own. */
@Composable
fun ChannelLogo(url: String?, name: String, textSize: Int, modifier: Modifier = Modifier) {
    var broken by remember(url) { mutableStateOf(false) }
    if (!url.isNullOrEmpty() && !broken) {
        ArtImage(url, modifier.fillMaxSize(), fit = ContentScale.Fit, onError = { broken = true })
        return
    }
    val letters = remember(name) { monogram(name) }
    Box(modifier.fillMaxSize().background(toneFor(name)), contentAlignment = Alignment.Center) {
        AppText(letters, if (letters.length > 3) (textSize * 0.8).toInt() else textSize, Palette.foreground, FontWeight.SemiBold, maxLines = 1, letterSpacing = 0.5f, modifier = Modifier.alpha(0.92f))
    }
}

private const val CHANNEL_CARD_WIDTH = 300

/** A channel on a landing row: its logo on a panel, its name beneath. Sits beside the poster cards, drawn the same way. */
@Composable
fun ChannelCard(
    item: PosterItem,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onFocusItem: ((PosterItem) -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
) {
    Focusable(
        onClick, modifier.width(CHANNEL_CARD_WIDTH.dp), RoundedCornerShape(16.dp), onLongClick = onLongClick,
        onFocusChange = { if (it) onFocusItem?.invoke(item) }, ring = false,
    ) { focused ->
        Column(Modifier.padding(4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(12.dp)).background(Palette.raised)
                    .border(3.dp, if (focused) Palette.accent else Color.Transparent, RoundedCornerShape(12.dp)).padding(12.dp),
                contentAlignment = Alignment.Center,
            ) {
                ChannelLogo(item.posterUrl, item.name, 52)
                if (item.channelNumber != null) Box(Modifier.align(Alignment.TopEnd).background(Color(0xB3000000), RoundedCornerShape(6.dp)).padding(horizontal = 10.dp, vertical = 2.dp)) {
                    AppText(item.channelNumber.toString(), 17, Palette.foreground, FontWeight.SemiBold)
                }
            }
            AppText(item.name, 21, if (focused) Palette.foreground else Palette.muted, maxLines = 2)
        }
    }
}

/** A row heading: its title and, for a category the viewer pinned to Home, a small "Pinned" tag. */
@Composable
fun RowHeading(title: String, pinned: Boolean, modifier: Modifier = Modifier) {
    Row(modifier.padding(start = 8.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
        AppText(title, 32, Palette.foreground, FontWeight.SemiBold, letterSpacing = -0.3f, maxLines = 1)
        if (pinned) PinBadge()
    }
}

/** Room left of each poster in a top 10 for its numeral, so it sits in its own space instead of over the poster before. */
private const val RANK_LEAD = 70

/** One row: a heading and posters that scroll sideways under the D-pad. Renders nothing when empty. */
@Composable
fun PosterRow(
    title: String,
    items: List<PosterItem>,
    onPress: (PosterItem) -> Unit,
    modifier: Modifier = Modifier,
    onFocusItem: ((PosterItem) -> Unit)? = null,
    onLongPress: ((PosterItem) -> Unit)? = null,
    pinned: Boolean = false,
    ranked: Boolean = false,
    state: LazyListState = rememberLazyListState(),
) {
    if (items.isEmpty()) return
    Column(modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        RowHeading(title, pinned)
        LazyRow(state = state, horizontalArrangement = Arrangement.spacedBy(16.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 8.dp)) {
            items(items, key = { it.id }) { item ->
                if (ranked) {
                    val index = items.indexOf(item)
                    Box(Modifier.padding(start = RANK_LEAD.dp).width(POSTER_CARD_WIDTH.dp)) {
                        // Behind the poster's left edge, absolute so a poster's left edge lands at the same x as every other row's.
                        AppText((index + 1).toString(), 250, Color(0xFF2A3138), FontWeight.Bold, Modifier.align(Alignment.TopStart).absoluteOffset((-84).dp, 74.dp).width(118.dp).wrapContentWidth(Alignment.End, unbounded = true), maxLines = 1, align = androidx.compose.ui.text.style.TextAlign.End, letterSpacing = -20f, lineHeight = 250)
                        PosterCard(item, { onPress(item) }, onFocusItem = onFocusItem, onLongClick = onLongPress?.let { { it(item) } })
                    }
                } else PosterCard(item, { onPress(item) }, onFocusItem = onFocusItem, onLongClick = onLongPress?.let { { it(item) } })
            }
        }
    }
}

/** One row of channel cards that scrolls sideways under the D-pad. Renders nothing when empty. */
@Composable
fun ChannelShelf(
    title: String,
    items: List<PosterItem>,
    onPress: (PosterItem) -> Unit,
    modifier: Modifier = Modifier,
    onFocusItem: ((PosterItem) -> Unit)? = null,
    onLongPress: ((PosterItem) -> Unit)? = null,
    pinned: Boolean = false,
) {
    if (items.isEmpty()) return
    Column(modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        RowHeading(title, pinned)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 8.dp)) {
            items(items, key = { it.id }) { item -> ChannelCard(item, { onPress(item) }, onFocusItem = onFocusItem, onLongClick = onLongPress?.let { { it(item) } }) }
        }
    }
}

/** Year, length and rating as small quiet chips. */
@Composable
fun Facts(facts: List<String>, modifier: Modifier = Modifier) {
    if (facts.isEmpty()) return
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        for (fact in facts) Box(Modifier.height(44.dp).background(Color(0x14FFFFFF), CircleShape).padding(horizontal = 20.dp), contentAlignment = Alignment.Center) {
            AppText(fact, 23, Palette.foreground, FontWeight.Medium, maxLines = 1)
        }
    }
}

/** The poster, blurred and dimmed, filling the page behind the content. */
@Composable
fun Backdrop(url: String?, modifier: Modifier = Modifier) {
    if (url.isNullOrEmpty()) return
    Box(modifier.fillMaxSize()) {
        // Decoded small and stretched to fill: the stretch blurs it for free.
        ArtImage(url, Modifier.fillMaxSize().alpha(0.5f).blur(24.dp))
        Box(Modifier.fillMaxSize().background(Color(0x990C0E11)))
    }
}

/** What can be done with a film or episode: one thing to do (`primary`) and a few more in a list (`actions`). */
class DetailAction(val key: String, val label: String, val glyph: ActionGlyph, val onPress: () -> Unit)

enum class ActionGlyph(val glyph: Glyph) {
    Restart(Glyph.Restart), Plus(Glyph.Plus), Check(Glyph.Check), Cross(Glyph.Close), Info(Glyph.Info), Watched(Glyph.Eye),
    Unwatched(Glyph.EyeOff), Versions(Glyph.Versions), Hide(Glyph.EyeOff), Earlier(Glyph.Back), Later(Glyph.ChevronRight),
}

class PrimaryAction(val label: String, val onPress: () -> Unit, /** 0 to 1: how far through it you are, drawn inside the pill. */ val progress: Float? = null)

/** One big Play pill, then a few round icon buttons; the focused icon's name shows underneath, so nothing needs a long label. */
@Composable
fun DetailActions(
    primary: PrimaryAction,
    actions: List<DetailAction>,
    modifier: Modifier = Modifier,
    primaryFocus: FocusRequester? = null,
    hintBeside: Boolean = false,
) {
    var hint by remember { mutableStateOf("") }
    Column(modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Focusable(
                primary.onPress, Modifier.height(72.dp), CircleShape, focusRequester = primaryFocus, onFocusChange = { if (it) hint = "" }, ring = true,
                background = Color(0x1FFFFFFF), focusedBackground = Palette.foreground,
            ) { focused ->
                Box {
                    Row(Modifier.fillMaxHeight().padding(horizontal = 36.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        GlyphIcon(Glyph.Play, if (focused) Color(0xFF0B0E10) else Palette.foreground, 28.dp)
                        AppText(primary.label, 26, if (focused) Color(0xFF0B0E10) else Palette.foreground, FontWeight.SemiBold, maxLines = 1)
                    }
                    if (primary.progress != null && primary.progress > 0f) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 7.dp, start = 40.dp, end = 40.dp).fillMaxWidth().height(3.dp).background(Color(0x33FFFFFF), RoundedCornerShape(2.dp))) {
                        Box(Modifier.fillMaxHeight().fillMaxWidth(primary.progress.coerceAtMost(1f)).background(Palette.accent, RoundedCornerShape(2.dp)))
                    }
                }
            }
            for (action in actions) Focusable(
                action.onPress, Modifier.size(72.dp), CircleShape, ring = false, onFocusChange = { hint = if (it) action.label else if (hint == action.label) "" else hint },
                background = Color(0x1FFFFFFF), focusedBackground = Palette.foreground, contentAlignment = Alignment.Center,
            ) { focused -> GlyphIcon(action.glyph.glyph, if (focused) Color(0xFF0B0E10) else Palette.foreground, 30.dp) }
            if (hintBeside && actions.isNotEmpty()) AppText(hint, 26, Palette.muted, modifier = Modifier.padding(start = 6.dp))
        }
        if (!hintBeside && actions.isNotEmpty()) AppText(hint, 24, Palette.muted, modifier = Modifier.height(34.dp))
    }
}

/** A grey outline of the landing page shown while the rows are built for the first time, so the screen has its shape straight away. */
@Composable
fun HomeSkeleton() {
    val pulse by androidx.compose.animation.core.rememberInfiniteTransition(label = "skeleton").animateFloat(
        0.5f, 1f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(550, easing = androidx.compose.animation.core.FastOutSlowInEasing), androidx.compose.animation.core.RepeatMode.Reverse), label = "pulse",
    )
    Column(Modifier.fillMaxSize().padding(top = 112.dp).alpha(pulse)) {
        Column(Modifier.height(408.dp).padding(start = 52.dp, top = 20.dp)) {
            Box(Modifier.size(200.dp, 22.dp).background(Palette.cardActive, RoundedCornerShape(10.dp)))
            Box(Modifier.padding(top = 18.dp).size(760.dp, 64.dp).background(Palette.cardActive, RoundedCornerShape(10.dp)))
            Box(Modifier.padding(top = 22.dp).size(420.dp, 32.dp).background(Palette.cardActive, RoundedCornerShape(10.dp)))
            Box(Modifier.padding(top = 18.dp).size(980.dp, 30.dp).background(Palette.cardActive, RoundedCornerShape(10.dp)))
            Box(Modifier.padding(top = 26.dp).size(240.dp, 70.dp).background(Palette.cardActive, RoundedCornerShape(35.dp)))
        }
        Box(Modifier.padding(start = 52.dp).size(320.dp, 32.dp).background(Palette.cardActive, RoundedCornerShape(10.dp)))
        Row(Modifier.padding(start = 52.dp, top = 24.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            repeat(8) { Box(Modifier.size(200.dp, 300.dp).background(Palette.card, RoundedCornerShape(12.dp))) }
        }
    }
}

