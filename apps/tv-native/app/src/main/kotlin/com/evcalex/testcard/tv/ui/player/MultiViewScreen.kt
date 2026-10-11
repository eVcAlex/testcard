package com.evcalex.testcard.tv.ui.player

import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.evcalex.testcard.core.playback.MultiLayout
import com.evcalex.testcard.core.playback.PlayItem
import com.evcalex.testcard.core.playback.TileRect
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.ui.components.AppButton
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.Focusable
import com.evcalex.testcard.tv.ui.components.Glyph
import com.evcalex.testcard.tv.ui.components.GlyphIcon
import com.evcalex.testcard.tv.ui.components.OptionsSheet
import com.evcalex.testcard.tv.ui.components.SheetOption
import com.evcalex.testcard.tv.ui.components.Toast
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.delay

/**
 * Several live channels on one screen. The remote moves between the pictures; OK gives one the sound (and, where the layout has a
 * big picture, the big place); holding OK opens what can be done with it; Menu opens the layouts. What decides whether it plays
 * smoothly (how many pictures, which quality, what to do when one stalls) is in [MultiViewModel] and core's `MultiView.kt`.
 */
@Composable
fun MultiViewScreen(app: AppController, onExit: () -> Unit, onFullScreen: (PlayItem, List<PlayItem>) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val model = remember { MultiViewModel(app, context, scope) }
    DisposableEffect(model) { onDispose { model.release() } }
    LaunchedEffect(model) { model.start(app.multiQueue.toList()) }
    LaunchedEffect(model) { while (true) { delay(500); model.tick() } }
    BackHandler(onBack = onExit)

    when (model.phase) {
        MultiPhase.Checking -> BufferingScreen()
        MultiPhase.Unavailable -> Column(
            Modifier.fillMaxSize().background(Palette.background).padding(48.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(32.dp, Alignment.CenterVertically),
        ) {
            val first = remember { FocusRequester() }
            LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
            AppText("Multi view", 44, Palette.foreground, FontWeight.SemiBold)
            AppText(model.note ?: "Multi view needs at least two channels.", 30, Palette.muted, align = TextAlign.Center, lineHeight = 44)
            AppButton("Back", onExit, primary = true, focusRequester = first)
        }
        MultiPhase.Ready -> Picture(model, onExit, onFullScreen)
    }
}

@Composable
private fun Picture(model: MultiViewModel, onExit: () -> Unit, onFullScreen: (PlayItem, List<PlayItem>) -> Unit) {
    var options by remember { mutableStateOf<MultiTile?>(null) }
    var layouts by remember { mutableStateOf(false) }
    var hint by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) { delay(8_000); hint = false }
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { delay(100); runCatching { first.requestFocus() } }

    BoxWithConstraints(
        Modifier.fillMaxSize().background(Color.Black).onPreviewKeyEvent { event ->
            if (event.type == KeyEventType.KeyDown && event.key == Key.Menu) { layouts = true; true } else false
        },
    ) {
        val layout = model.layout
        // Keyed by channel so a picture that changes place (Make main, a new layout) is moved, not rebuilt and restarted.
        model.tiles.forEachIndexed { slot, tile ->
            key(tile.item.id) {
                val rect = layout.slots[slot]
                TileView(
                    tile, rect, isAudio = tile === model.audio,
                    modifier = Modifier.offset(maxWidth * rect.x, maxHeight * rect.y).size(maxWidth * rect.w, maxHeight * rect.h).then(if (slot == 0) Modifier.focusRequester(first) else Modifier),
                    onSelect = { model.select(tile) },
                    onOptions = { options = tile },
                )
            }
        }
        for (slot in model.tiles.size until layout.slots.size) {
            val rect = layout.slots[slot]
            Box(Modifier.offset(maxWidth * rect.x, maxHeight * rect.y).size(maxWidth * rect.w, maxHeight * rect.h).padding(5.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.fillMaxSize().background(Palette.sunken, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                    AppText("Empty. Hold OK on a channel in the guide to add it.", 18, Palette.faint, align = TextAlign.Center, modifier = Modifier.padding(16.dp))
                }
            }
        }
        val note = model.note
        if (note != null) Toast(note, Modifier.align(Alignment.BottomCenter))
        else if (hint) Toast("OK: sound   ·   Hold OK: options   ·   Menu: layouts", Modifier.align(Alignment.BottomCenter))
    }

    val picked = options
    if (picked != null) {
        val choices = buildList {
            if (picked.state == TileState.Stopped || picked.state == TileState.Failed) add(SheetOption("retry", "Try again"))
            if (model.audio !== picked) add(SheetOption("sound", "Sound from this one"))
            if (model.layout.hasMain && model.tiles.indexOf(picked) > 0) add(SheetOption("main", "Make main picture"))
            add(SheetOption("full", "Full screen"))
            add(SheetOption("layout", "Change layout"))
            if (model.tiles.size > 2) add(SheetOption("remove", "Remove from view"))
        }
        OptionsSheet(
            picked.item.title, choices,
            onChoose = { id ->
                when (id) {
                    "retry" -> model.restart(picked)
                    "sound" -> model.setAudio(picked)
                    "main" -> model.makeMain(picked)
                    "full" -> onFullScreen(picked.item, model.tiles.map { it.item })
                    "layout" -> layouts = true
                    "remove" -> model.remove(picked)
                    else -> {}
                }
            },
            onClose = { options = null },
        )
    }
    if (layouts) OptionsSheet(
        "Layout", model.offered().map { SheetOption(it.id, "${it.label}  ·  ${it.note}") },
        onChoose = { id -> MultiLayout.of(id).let(model::chooseLayout) },
        onClose = { layouts = false },
        preferredId = model.layout.id,
    )
}

@Composable
private fun TileView(tile: MultiTile, rect: TileRect, isAudio: Boolean, modifier: Modifier, onSelect: () -> Unit, onOptions: () -> Unit) {
    val small = rect.w < 0.3f
    Focusable(onSelect, modifier, shape = RoundedCornerShape(12.dp), onLongClick = onOptions) { _ ->
        Box(Modifier.fillMaxSize().padding(5.dp).background(Color.Black, RoundedCornerShape(8.dp))) {
            val player = tile.player
            if (player != null) AndroidView(
                factory = { viewContext ->
                    PlayerView(viewContext).apply {
                        useController = false
                        setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                        setShutterBackgroundColor(android.graphics.Color.BLACK)
                        isFocusable = false
                        isFocusableInTouchMode = false
                        descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
                        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                        this.player = player
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
            // What the viewer is looking at: the channel, whether it has the sound, and the quality it is running at.
            Row(
                Modifier.align(Alignment.TopStart).padding(10.dp).background(Color(0xB3000000), RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 5.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                if (isAudio) GlyphIcon(Glyph.Headset, Palette.accent, if (small) 16.dp else 22.dp)
                AppText(tile.item.title, if (small) 16 else 22, Palette.foreground, FontWeight.Medium, maxLines = 1)
                val quality = tile.feed?.quality
                if (quality != null && !small) AppText(quality, 18, Palette.faint, maxLines = 1)
            }
            when (tile.state) {
                TileState.Starting, TileState.Buffering -> Box(Modifier.fillMaxSize().background(if (tile.playedOnce) Color.Transparent else Color(0x66000000)), contentAlignment = Alignment.Center) { Spinner(if (small) 32.dp else 56.dp) }
                TileState.Stopped, TileState.Failed -> Box(Modifier.fillMaxSize().background(Color(0xCC000000)), contentAlignment = Alignment.Center) {
                    AppText(tile.message ?: "", if (small) 16 else 24, Palette.muted, align = TextAlign.Center, modifier = Modifier.padding(16.dp))
                }
                TileState.Playing -> {}
            }
            val note = tile.message
            if (note != null && (tile.state == TileState.Playing || tile.state == TileState.Buffering)) {
                AppText(note, if (small) 14 else 18, Palette.foreground, modifier = Modifier.align(Alignment.BottomStart).padding(10.dp).background(Color(0xB3000000), RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 4.dp), maxLines = 1)
            }
        }
    }
}
