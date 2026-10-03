package com.evcalex.testcard.tv.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.animation.core.animateFloat
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.Glyph
import com.evcalex.testcard.tv.ui.components.GlyphIcon
import com.evcalex.testcard.tv.ui.theme.Palette

/** The dark ink of a key drawn white under the remote's highlight. */
val INK = Color(0xFF0B0E10)

/** A transport key: a bare glyph at rest, a solid white disc with a dark glyph when the remote's highlight is on it. */
@Composable
fun TransportKey(big: Boolean = false, selected: Boolean = false, active: Boolean = false, disabled: Boolean = false, content: @Composable (ink: Color) -> Unit) {
    val filled = selected || active
    val size = if (big) 92.dp else 80.dp
    Box(
        Modifier.size(size).scale(if (filled) 1.08f else 1f).background(if (filled) Palette.foreground else Color.Transparent, CircleShape),
        contentAlignment = Alignment.Center,
    ) { content(if (filled) INK else if (disabled) Color(0x42FFFFFF) else Palette.foreground) }
}

/** A transport key with a word on it, for the few actions that have no familiar symbol. `dot` is a red dot: the state the viewer is in now (live). */
@Composable
fun TextKey(label: String, dot: Boolean = false, selected: Boolean = false) {
    Row(
        Modifier.height(80.dp).scale(if (selected) 1.08f else 1f).background(if (selected) Palette.foreground else Color(0x24FFFFFF), CircleShape).padding(horizontal = 32.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dot) Box(Modifier.size(12.dp).background(Palette.live, CircleShape))
        AppText(label, 26, if (selected) INK else Palette.foreground, FontWeight.Medium, maxLines = 1)
    }
}

/** A key of the options row: its symbol in a disc, what it is below, and what it is set to. */
@Composable
fun OptionKey(glyph: Glyph, label: String, value: String, selected: Boolean = false) {
    Column(Modifier.width(170.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(80.dp).scale(if (selected) 1.08f else 1f).background(if (selected) Palette.foreground else Color(0x1AFFFFFF), CircleShape), contentAlignment = Alignment.Center) {
            GlyphIcon(glyph, if (selected) INK else Palette.foreground, 36.dp)
        }
        AppText(label, 22, Palette.foreground.copy(alpha = if (selected) 1f else 0.85f), if (selected) FontWeight.SemiBold else FontWeight.Medium, maxLines = 1)
        AppText(value, 20, Palette.muted, maxLines = 1, modifier = Modifier.width(170.dp), align = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

@Composable
fun Chip(label: String) {
    Box(Modifier.border(2.dp, Color(0x66FFFFFF), RoundedCornerShape(7.dp)).padding(horizontal = 12.dp, vertical = 3.dp)) {
        AppText(label, 20, Palette.foreground, FontWeight.SemiBold, letterSpacing = 0.5f)
    }
}

/**
 * A darkening that fades out from one edge. Drawn as one gradient with many stops, so the darkness builds up in small steps with
 * no seams (stacked solid bands showed as stripes across the picture on a big screen).
 */
private const val SCRIM_STOPS = 28

private fun scrimBrush(fromTop: Boolean): Brush {
    val stops = Array(SCRIM_STOPS + 1) { i ->
        val at = i / SCRIM_STOPS.toFloat()
        val darkness = if (i >= SCRIM_STOPS) 0f else 0.85f * Math.pow((1 - (i + 0.5) / SCRIM_STOPS).toDouble(), 1.5).toFloat()
        at to Color(5, 7, 9, (darkness * 255).toInt())
    }
    // Dark at the edge, clear at the far side.
    return if (fromTop) Brush.verticalGradient(colorStops = stops) else Brush.verticalGradient(colorStops = Array(SCRIM_STOPS + 1) { i -> stops[SCRIM_STOPS - i].second.let { c -> i / SCRIM_STOPS.toFloat() to c } })
}

@Composable
fun Scrim(fromTop: Boolean, modifier: Modifier = Modifier) {
    val brush = remember(fromTop) { scrimBrush(fromTop) }
    Box(modifier.background(brush))
}

/** The side panel the captions, soundtracks and catch-up lists share: a dark card down the right with one row per entry. */
@Composable
fun SidePanel(title: String, modifier: Modifier = Modifier, note: String? = null, content: @Composable () -> Unit) {
    Column(
        modifier.padding(end = 96.dp, top = 110.dp, bottom = 110.dp).width(780.dp).fillMaxHeight().background(Color(0xE0000000), RoundedCornerShape(18.dp)).padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AppText(title.uppercase(), 20, Palette.muted, FontWeight.Medium, letterSpacing = 1.5f)
        Box(Modifier.weight(1f)) { content() }
        if (note != null) AppText(note, 22, Palette.muted)
    }
}

const val PANEL_ROW = 64

/** A list whose highlighted row (`at`) is kept near the middle, scrolled in whole rows. */
@Composable
fun PanelList(count: Int, at: Int, state: LazyListState, row: @Composable (index: Int, lit: Boolean) -> Unit) {
    LaunchedEffect(at) { state.scrollToItem(Math.max(0, at - 3)) }
    LazyColumn(Modifier.fillMaxSize(), state) {
        itemsIndexed(List(count) { it }) { index, _ -> row(index, index == at) }
    }
}

/** One row of a side panel. */
@Composable
fun PanelRow(lit: Boolean, content: @Composable androidx.compose.foundation.layout.RowScope.(ink: Color?) -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(PANEL_ROW.dp).background(if (lit) Palette.foreground else Color.Transparent, RoundedCornerShape(12.dp)).padding(horizontal = 18.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically,
    ) { content(if (lit) INK else null) }
}

/** The "Next episode" button, a fixed width so its countdown fill can be drawn across it: `fill` is 0 to 1. */
@Composable
fun NextEpisodeKey(lit: Boolean, fill: Float) {
    val width: Dp = 330.dp
    Row(
        Modifier.width(width).height(76.dp).scale(if (lit) 1.06f else 1f)
            .background(if (lit) Palette.foreground else Color(0xB3F2EEE7), CircleShape)
            .border(2.dp, if (lit) Palette.accent else Color.Transparent, CircleShape)
            .drawBehind { drawRect(Color(0x330B0E10), Offset.Zero, Size(size.width * fill, size.height)) },
        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
    ) {
        GlyphIcon(Glyph.Play, INK, 34.dp)
        AppText("Next episode", 26, INK, FontWeight.SemiBold)
    }
}

/** The progress bar: buffered, played, a knob; live shows the programme so far (or the live edge). */
@Composable
fun ProgressBar(ratio: Float, buffered: Float?, lit: Boolean, live: Boolean, modifier: Modifier = Modifier) {
    val played = if (live) Palette.live else if (lit) Palette.accent else Palette.foreground
    val track = if (lit) 10.dp else 6.dp
    val knob = if (lit) 30.dp else 18.dp
    Box(modifier.fillMaxWidth().height(44.dp), contentAlignment = Alignment.CenterStart) {
        Box(Modifier.fillMaxWidth().height(track).background(Color(0x30FFFFFF), RoundedCornerShape(5.dp))) {
            if (buffered != null) Box(Modifier.fillMaxHeight().fillMaxWidth(buffered.coerceIn(0f, 1f)).background(Color(0x40FFFFFF), RoundedCornerShape(5.dp)))
            Box(Modifier.fillMaxHeight().fillMaxWidth(ratio.coerceIn(0f, 1f)).background(played, RoundedCornerShape(5.dp)))
        }
        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth()) {
            Box(Modifier.offset(x = maxWidth * ratio.coerceIn(0f, 1f) - knob / 2).size(knob).background(played, CircleShape))
        }
    }
}

/** A short note in a pill across the top of the picture (picked up on the other TV, the feed that took over). */
@Composable
fun BoxScope.Note(text: String) {
    Box(Modifier.align(Alignment.TopCenter).padding(top = 48.dp).background(Color(0xD9000000), CircleShape).padding(horizontal = 32.dp, vertical = 14.dp)) {
        AppText(text, 26, Palette.foreground)
    }
}

/** A "Trying another feed..." style message over a plain screen. */
@Composable
fun StatusScreen(title: String, message: String) {
    Column(Modifier.fillMaxSize().background(Palette.background).padding(48.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(32.dp, Alignment.CenterVertically)) {
        AppText(title, 44, Palette.foreground, FontWeight.SemiBold, maxLines = 2, letterSpacing = -0.5f)
        AppText(message, 28, Palette.muted)
    }
}

/** A turning arc, the buffering spinner. */
@Composable
fun Spinner(size: Dp) {
    val turn by androidx.compose.animation.core.rememberInfiniteTransition(label = "spinner").animateFloat(
        0f, 360f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(900, easing = androidx.compose.animation.core.LinearEasing)), label = "turn",
    )
    androidx.compose.foundation.Canvas(Modifier.size(size)) {
        val stroke = size.toPx() * 0.08f
        drawArc(
            Palette.foreground, turn, 270f, false, Offset(stroke / 2, stroke / 2), Size(this.size.width - stroke, this.size.height - stroke),
            style = androidx.compose.ui.graphics.drawscope.Stroke(stroke, cap = androidx.compose.ui.graphics.StrokeCap.Round),
        )
    }
}
