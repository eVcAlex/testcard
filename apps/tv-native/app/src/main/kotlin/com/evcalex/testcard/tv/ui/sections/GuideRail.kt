package com.evcalex.testcard.tv.ui.sections

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.Focusable
import com.evcalex.testcard.tv.ui.components.Glyph
import com.evcalex.testcard.tv.ui.components.GlyphIcon
import com.evcalex.testcard.tv.ui.components.trapFocus
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.delay

/** One list the guide can show: "favourites", "recent", a category id, or "all". */
internal class GuideList(val id: String, val label: String, val count: Int, val mark: RailMark)

/** What the collapsed rail draws for a list. */
internal sealed interface RailMark {
    class Icon(val glyph: Glyph) : RailMark
    class Letters(val text: String) : RailMark
}

internal const val RAIL_COLLAPSED_W = 110
internal const val RAIL_OPEN_W = 440
private const val RAIL_ITEM_H = 60
private const val PICK_DELAY_MS = 250L

/**
 * The Live TV list rail. Collapsed: a strip of marks, not focusable. Open: names and counts over the guide, focus held
 * inside; resting on an item for [PICK_DELAY_MS] calls `onPick`; OK or Right calls `onClose(id)` with the item under the
 * remote; Back is handled by the caller. A separator follows "recent".
 */
@Composable
internal fun GuideRail(
    lists: List<GuideList>, current: String, open: Boolean,
    onPick: (String) -> Unit, onClose: (String) -> Unit, onLongPress: (GuideList) -> Unit,
    requesters: Map<String, FocusRequester>, state: LazyListState,
) {
    var pending by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(pending) {
        val id = pending ?: return@LaunchedEffect
        delay(PICK_DELAY_MS)
        onPick(id)
    }
    LaunchedEffect(open) { if (!open) pending = null }
    Box(
        Modifier.fillMaxHeight().width((if (open) RAIL_OPEN_W else RAIL_COLLAPSED_W).dp).zIndex(1f)
            .then(if (open) Modifier.shadow(24.dp) else Modifier)
            .background(Palette.sunken),
    ) {
        LazyColumn(
            Modifier.fillMaxSize().then(if (open) Modifier.trapFocus() else Modifier), state,
            contentPadding = PaddingValues(vertical = 20.dp, horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            for (item in lists) {
                item(item.id) {
                    if (open) OpenItem(item, item.id == current, onClose, onLongPress, requesters[item.id]) { pending = item.id }
                    else Box(Modifier.fillMaxWidth().height(RAIL_ITEM_H.dp), contentAlignment = Alignment.Center) {
                        Mark(item.mark, if (item.id == current) Palette.accent else Palette.faint)
                    }
                }
                if (item.id == "recent") item("separator") {
                    Box(Modifier.padding(horizontal = 10.dp, vertical = 8.dp).fillMaxWidth().height(1.dp).background(Palette.border))
                }
            }
        }
        Box(Modifier.align(Alignment.CenterEnd).width(1.dp).fillMaxHeight().background(Palette.border))
    }
}

@Composable
private fun Mark(mark: RailMark, color: Color) {
    when (mark) {
        is RailMark.Icon -> GlyphIcon(mark.glyph, color, 28.dp)
        is RailMark.Letters -> AppText(mark.text, 20, color, FontWeight.SemiBold, maxLines = 1)
    }
}

@Composable
private fun OpenItem(
    item: GuideList, isCurrent: Boolean, onClose: (String) -> Unit, onLongPress: (GuideList) -> Unit,
    requester: FocusRequester?, onFocused: () -> Unit,
) {
    Focusable(
        { onClose(item.id) },
        Modifier.fillMaxWidth().height(RAIL_ITEM_H.dp).onPreviewKeyEvent { event ->
            if (event.type != KeyEventType.KeyDown) false
            else if (event.key == Key.DirectionRight && event.nativeKeyEvent.repeatCount == 0) { onClose(item.id); true }
            else event.key == Key.DirectionLeft
        },
        RoundedCornerShape(10.dp),
        // "All" is not a category: there is nothing to pin or hide.
        onLongClick = if (item.mark is RailMark.Letters && item.id != "all") ({ onLongPress(item) }) else null,
        onFocusChange = { if (it) onFocused() }, focusRequester = requester,
        ring = false, background = Color.Transparent, focusedBackground = Palette.accent,
    ) { focused ->
        val ink = if (focused) Palette.accentInk else if (isCurrent) Palette.accent else Palette.muted
        Row(Modifier.fillMaxSize().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(44.dp), contentAlignment = Alignment.CenterStart) { Mark(item.mark, ink) }
            AppText(item.label, 24, if (focused) Palette.accentInk else Palette.foreground, FontWeight.Medium, Modifier.weight(1f), maxLines = 1)
            AppText(item.count.toString(), 19, if (focused) Palette.accentInk else Palette.faint, maxLines = 1)
        }
    }
}
