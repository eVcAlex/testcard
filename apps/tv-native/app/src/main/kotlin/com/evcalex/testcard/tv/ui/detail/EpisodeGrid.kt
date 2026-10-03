package com.evcalex.testcard.tv.ui.detail

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.db.EpisodeRow
import com.evcalex.testcard.core.shouldPromptResume
import com.evcalex.testcard.core.text.episodeTitle
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.ArtImage
import com.evcalex.testcard.tv.ui.components.Focusable
import com.evcalex.testcard.tv.ui.components.Glyph
import com.evcalex.testcard.tv.ui.components.GlyphIcon
import com.evcalex.testcard.tv.ui.home.progressOf
import com.evcalex.testcard.tv.ui.theme.Palette

/** Episodes are a grid like the app's posters: several cards to a row, sized to fit the screen width. */
@Composable
internal fun EpisodeGrid(episodes: List<EpisodeRow>, fallbacks: List<String>, nextIndex: Int, key: String, onPlay: (EpisodeRow, Boolean) -> Unit, onOptions: (Int, EpisodeRow) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val width = maxWidth.value
        val columns = Math.min(6, Math.max(2, Math.floor(((width + GRID_GAP) / (MIN_CARD + GRID_GAP)).toDouble()).toInt()))
        val cardWidth = (width - GRID_GAP * (columns - 1)) / columns
        val thumbHeight = cardWidth * 9 / 16
        val firstRow = if (nextIndex > columns * 2) Math.max(0, nextIndex / columns - 1) else 0
        val state = remember(key, columns) { androidx.compose.foundation.lazy.grid.LazyGridState(firstRow * columns) }
        // The row the remote is on is brought to the top of the grid, so the row above is not left cut through under the season pills.
        var row by remember(key, columns) { mutableIntStateOf(-1) }
        LaunchedEffect(row) { if (row >= 0) state.animateScrollToItem(row * columns) }
        LazyVerticalGrid(
            GridCells.Fixed(columns), Modifier.fillMaxSize(), state,
            contentPadding = PaddingValues(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(30.dp), horizontalArrangement = Arrangement.spacedBy(GRID_GAP.dp),
        ) {
            itemsIndexed(episodes, key = { _, episode -> episode.id }) { index, episode ->
                EpisodeCard(episode, fallbacks, thumbHeight, onFocus = { row = index / columns }, onPlay = onPlay, onOptions = { onOptions(index, episode) })
            }
        }
    }
}

@Composable
internal fun EpisodeCard(episode: EpisodeRow, fallbacks: List<String>, thumbHeight: Float, onFocus: () -> Unit, onPlay: (EpisodeRow, Boolean) -> Unit, onOptions: () -> Unit) {
    val position = episode.positionSecs
    val started = position != null && shouldPromptResume(position, episode.durationSecs)
    val ratio = if (started) Math.min(1f, progressOf(position, episode.durationSecs) ?: 0f) else 0f
    val duration = episode.durationSecs?.takeIf { it > 0 }?.let { episodeRuntime(it) } ?: ""
    Focusable(
        { onPlay(episode, started) }, Modifier.fillMaxWidth(), RoundedCornerShape(12.dp), onLongClick = onOptions,
        onFocusChange = { if (it) onFocus() }, ring = false,
    ) { focused ->
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                Modifier.fillMaxWidth().height(thumbHeight.dp).clip(RoundedCornerShape(12.dp)).background(Palette.raised)
                    .border(3.dp, if (focused) Palette.accent else Color.Transparent, RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.BottomStart,
            ) {
                EpisodeArt(episode.imageUrl, fallbacks)
                if (episode.watched) Box(Modifier.fillMaxSize().background(Color(0x47000000)))
                AppText("E${episode.episodeNumber}", 18, Palette.foreground, FontWeight.SemiBold, Modifier.align(Alignment.TopStart).padding(12.dp, 10.dp).background(Color(0xB3000000), RoundedCornerShape(6.dp)).padding(horizontal = 10.dp, vertical = 3.dp))
                if (episode.watched) Row(
                    Modifier.align(Alignment.TopEnd).padding(12.dp, 10.dp).background(Color(0xB3000000), RoundedCornerShape(6.dp)).padding(start = 8.dp, end = 10.dp, top = 3.dp, bottom = 3.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    GlyphIcon(Glyph.Check, Palette.accent, 20.dp)
                    AppText("Watched", 18, Palette.foreground, FontWeight.SemiBold)
                }
                if (ratio > 0f) Box(Modifier.fillMaxWidth().height(6.dp).background(Color(0x80000000))) { Box(Modifier.fillMaxHeight().fillMaxWidth(ratio).background(Palette.accent)) }
            }
            AppText(episodeTitle(episode.name), 24, if (focused) Palette.foreground else Palette.muted, FontWeight.Medium, maxLines = 1)
            AppText(if (started && position != null) "Resume from ${positionLabel(position)}" else duration, 21, if (started) Palette.accent else Palette.faint, maxLines = 1, modifier = Modifier.height(28.dp))
        }
    }
}

/**
 * An episode card's picture: its own still, else a borrowed poster, blurred behind a veil so it reads as a stand-in rather than
 * the episode's own picture, else a play glyph. A link that fails to load moves on to the next.
 */
@Composable
internal fun EpisodeArt(still: String?, fallbacks: List<String>) {
    val candidates = remember(still, fallbacks) { listOfNotNull(still?.takeIf { it.isNotEmpty() }) + fallbacks }
    var failed by remember(candidates) { mutableIntStateOf(0) }
    val url = candidates.getOrNull(failed)
    if (url == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { GlyphIcon(Glyph.Play, Color(0x40FFFFFF), 44.dp) }
        return
    }
    if (url != still) {
        ArtImage(url, Modifier.fillMaxSize().blur(3.dp), onError = { failed++ })
        Box(Modifier.fillMaxSize().background(Color(0x6B000000)))
    } else ArtImage(url, Modifier.fillMaxSize(), onError = { failed++ })
}

/** A slow pulse for the loading outlines. */
@Composable
internal fun pulse(): Float {
    val value by rememberInfiniteTransition(label = "pulse").animateFloat(0.45f, 1f, infiniteRepeatable(tween(550), RepeatMode.Reverse), label = "alpha")
    return value
}

/** Where the buttons will be, while the episodes (which the big button depends on) load. */
@Composable
internal fun ActionsSkeleton() {
    Row(Modifier.padding(top = 6.dp).alpha(pulse()), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(250.dp, 68.dp).background(Palette.cardActive, CircleShape))
        repeat(3) { Box(Modifier.size(68.dp).background(Palette.card, CircleShape)) }
    }
}

/** The shape of the season pills and episode cards, while the episode list is fetched. */
@Composable
internal fun EpisodesSkeleton() {
    Column(Modifier.fillMaxWidth().alpha(pulse()), verticalArrangement = Arrangement.spacedBy(24.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) { repeat(3) { Box(Modifier.size(150.dp, 52.dp).background(Palette.card, CircleShape)) } }
        Row(horizontalArrangement = Arrangement.spacedBy(GRID_GAP.dp)) {
            repeat(4) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Palette.card, RoundedCornerShape(12.dp)))
                    Box(Modifier.fillMaxWidth(0.7f).height(22.dp).background(Palette.cardActive, RoundedCornerShape(6.dp)))
                    Box(Modifier.fillMaxWidth(0.35f).height(18.dp).background(Palette.card, RoundedCornerShape(6.dp)))
                }
            }
        }
    }
}
