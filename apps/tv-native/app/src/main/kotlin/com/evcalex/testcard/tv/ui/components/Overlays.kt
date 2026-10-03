package com.evcalex.testcard.tv.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.setup.SetupProgress
import com.evcalex.testcard.core.setup.StepState
import com.evcalex.testcard.tv.ui.theme.Palette
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.google.zxing.qrcode.encoder.Encoder

/**
 * A full-screen modal in its own window, as a React Native `Modal` is: focus cannot leave it, and Back (or `onClose`) closes it.
 * The window's own dimming is switched off; the content draws its own scrim.
 */
@Composable
fun Modal(onClose: () -> Unit, content: @Composable () -> Unit) {
    // A dialog is a window of its own and provides the system density again, so the app's (1dp = 1 design pixel) is carried in.
    val density = androidx.compose.ui.platform.LocalDensity.current
    Dialog(onDismissRequest = onClose, properties = DialogProperties(dismissOnBackPress = true, dismissOnClickOutside = false, usePlatformDefaultWidth = false)) {
        (LocalView.current.parent as? DialogWindowProvider)?.window?.setDimAmount(0f)
        androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalDensity provides density) { content() }
    }
}

/** Keeps D-pad focus inside a modal panel: every direction that leaves the group is cancelled. */
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
fun Modifier.trapFocus(): Modifier = this.focusProperties { exit = { FocusRequester.Cancel } }.focusGroup()

class SheetOption(val id: String, val label: String)

/**
 * A short list of things to do with one title, opened by holding select on it. Choosing one runs it and closes the sheet;
 * Back closes it too. Focus is held inside while it is open, on `preferredId` or else the first option. A long list
 * scrolls. `aside` is drawn beside the list (a preview of the option `onFocusId` last reported).
 */
@Composable
fun OptionsSheet(
    title: String,
    options: List<SheetOption>,
    onChoose: (String) -> Unit,
    onClose: () -> Unit,
    preferredId: String? = null,
    aside: (@Composable () -> Unit)? = null,
    onFocusId: ((String) -> Unit)? = null,
) {
    val first = remember { FocusRequester() }
    val preferredIndex = options.indexOfFirst { it.id == preferredId }.takeIf { it >= 0 } ?: 0
    LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
    Modal(onClose) {
    Row(Modifier.fillMaxSize().background(Color(0xA6000000)), horizontalArrangement = Arrangement.spacedBy(48.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        aside?.invoke()
        Column(
            Modifier.width(640.dp).trapFocus().background(Palette.raised, RoundedCornerShape(24.dp)).border(1.dp, Palette.border, RoundedCornerShape(24.dp)).padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            AppText(title, 20, Palette.faint, FontWeight.Medium, Modifier.padding(start = 26.dp, end = 26.dp, top = 8.dp, bottom = 10.dp), maxLines = 1)
            LazyColumn(Modifier.heightIn(max = 780.dp)) {
                itemsIndexed(options, key = { _, option -> option.id }) { index, option ->
                    MenuRow(
                        option.label, { onClose(); onChoose(option.id) }, active = option.id == preferredId,
                        focusRequester = if (index == preferredIndex) first else null,
                        onFocusChange = { if (it) onFocusId?.invoke(option.id) },
                    )
                }
            }
        }
    }
    }
}

/**
 * The one place the app's source is chosen: "All sources" or one of them, for every page at once. Opens under the Source
 * button in the nav bar; choosing closes it, and so does Back. Focus is held inside while it is open.
 */
@Composable
fun SourcePicker(sources: List<Pair<String, String>>, picked: String?, onPick: (String?) -> Unit, onClose: () -> Unit) {
    val start = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { start.requestFocus() } }
    Modal(onClose) {
    Box(Modifier.fillMaxSize().background(Color(0x80000000)), contentAlignment = Alignment.TopEnd) {
        Column(
            Modifier.padding(top = 104.dp, end = 44.dp).width(520.dp).trapFocus().background(Palette.raised, RoundedCornerShape(24.dp)).border(1.dp, Palette.border, RoundedCornerShape(24.dp)).padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            AppText("Show content from", 20, Palette.faint, FontWeight.Medium, Modifier.padding(start = 26.dp, end = 26.dp, top = 8.dp, bottom = 10.dp))
            MenuRow("All sources", { onPick(null) }, active = picked == null, focusRequester = if (picked == null) start else null)
            for ((id, name) in sources) MenuRow(name, { onPick(id) }, active = picked == id, focusRequester = if (picked == id) start else null)
        }
    }
    }
}

const val PIN_LENGTH = 4

private val PAD_KEYS = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("", "0", "erase"))

/**
 * Four digits typed on an on-screen pad (a Fire TV remote has no number keys). Once the fourth is in, `onEntered` says
 * whether it was right (false clears the dots and shows `wrong`). Back closes it.
 */
@Composable
fun PinPad(title: String, onEntered: (String) -> Boolean, onClose: () -> Unit, note: String? = null, wrong: String = "That's not the PIN. Try again.") {
    var digits by remember(title) { mutableStateOf("") }
    var failed by remember(title) { mutableStateOf(false) }
    val five = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { five.requestFocus() } }
    fun press(key: String) {
        if (key == "erase") { digits = digits.dropLast(1); return }
        val next = (digits + key).take(PIN_LENGTH)
        failed = false
        if (next.length < PIN_LENGTH) { digits = next; return }
        digits = ""
        if (!onEntered(next)) failed = true
    }
    Modal(onClose) {
    Box(Modifier.fillMaxSize().background(Color(0xC7000000)), contentAlignment = Alignment.Center) {
        Column(
            Modifier.width(620.dp).trapFocus().background(Palette.raised, RoundedCornerShape(28.dp)).border(1.dp, Palette.border, RoundedCornerShape(28.dp)).padding(horizontal = 40.dp, vertical = 44.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            AppText(title, 34, Palette.foreground, FontWeight.SemiBold, align = TextAlign.Center)
            AppText(if (failed) wrong else (note ?: " "), 22, if (failed) Palette.fault else Palette.muted, align = TextAlign.Center, modifier = Modifier.heightIn(min = 30.dp))
            Row(Modifier.padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                repeat(PIN_LENGTH) { index ->
                    val filled = index < digits.length
                    Box(Modifier.size(22.dp).background(if (filled) Palette.foreground else Color.Transparent, CircleShape).border(3.dp, if (filled) Palette.foreground else Palette.muted, CircleShape))
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                for (row in PAD_KEYS) Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    for (key in row) {
                        if (key == "") Box(Modifier.size(112.dp, 88.dp))
                        else Focusable(
                            { press(key) }, Modifier.size(112.dp, 88.dp), RoundedCornerShape(20.dp), focusRequester = if (key == "5") five else null, ring = false,
                            background = Color(0x12FFFFFF), focusedBackground = Palette.foreground, contentAlignment = Alignment.Center,
                        ) { focused ->
                            if (key == "erase") GlyphIcon(Glyph.Erase, if (focused) Palette.background else Palette.muted, 34.dp)
                            else AppText(key, 36, if (focused) Palette.background else Palette.foreground, FontWeight.Medium)
                        }
                    }
                }
            }
        }
    }
    }
}

/**
 * A QR code drawn from plain rectangles: dark runs on a white square with the quiet border a scanner needs. Nothing is
 * fetched and nothing is sent anywhere; the text is turned into modules right here.
 */
@Composable
fun QrCode(text: String, size: Dp, modifier: Modifier = Modifier) {
    val matrix = remember(text) { Encoder.encode(text, ErrorCorrectionLevel.M, mapOf<com.google.zxing.EncodeHintType, Any>()).matrix }
    Canvas(modifier.size(size).clip(RoundedCornerShape(16.dp)).background(Color.White)) {
        val quiet = 4
        val cell = this.size.width / (matrix.width + quiet * 2)
        for (y in 0 until matrix.height) {
            var start = -1
            for (x in 0..matrix.width) {
                val dark = x < matrix.width && matrix.get(x, y).toInt() == 1
                if (dark && start < 0) start = x
                if (!dark && start >= 0) {
                    drawRect(Color.Black, Offset((start + quiet) * cell, (y + quiet) * cell), Size((x - start) * cell + 0.5f, cell + 0.5f))
                    start = -1
                }
            }
        }
    }
}

/** Bar length in design units. */
private val BAR = 1200.dp

/**
 * The screen the app shows while it fetches your data for the first time or refreshes a source. The rest of the app is not
 * drawn behind it, so there is nothing to navigate to until it is done.
 */
@Composable
fun SetupOverlay(setup: SetupProgress, hint: String?) {
    val fill by animateFloatAsState(setup.fraction.toFloat(), tween(500), label = "fill")
    val sweep by rememberInfiniteTransition(label = "sweep").animateFloat(0f, 1f, infiniteRepeatable(tween(1600, easing = LinearEasing), RepeatMode.Restart), label = "glint")
    Box(Modifier.fillMaxSize().background(Palette.background)) {
        Row(Modifier.padding(start = 120.dp, top = 90.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(14.dp).background(Palette.accent, CircleShape))
            AppText("SETTING UP", 22, Palette.muted, FontWeight.Medium, letterSpacing = 3f)
        }
        Column(Modifier.fillMaxSize().padding(start = 120.dp, end = 120.dp, bottom = 120.dp), verticalArrangement = Arrangement.spacedBy(28.dp, Alignment.CenterVertically)) {
            AppText("Getting Testcard ready...", 68, Palette.foreground, FontWeight.SemiBold, letterSpacing = -1.5f)
            Box(Modifier.width(BAR).height(8.dp).clip(CircleShape).background(Palette.cardActive)) {
                Box(Modifier.fillMaxHeight().width(BAR * fill).background(Palette.accent, CircleShape))
                Box(Modifier.fillMaxHeight().width(160.dp).graphicsLayer { translationX = (-160f + (1200f + 160f) * sweep) * density }.background(Color(0x40FFFFFF)))
            }
            Row(Modifier.width(BAR), horizontalArrangement = Arrangement.SpaceBetween) {
                AppText(setup.detail, 26, Palette.muted, maxLines = 1, modifier = Modifier.weight(1f))
                AppText("${Math.round(setup.fraction * 100)} %", 26, Palette.muted)
            }
            Column(Modifier.padding(top = 24.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
                for (step in setup.steps) Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(44.dp).border(3.dp, if (step.state == StepState.Waiting) Palette.cardActive else Palette.accent, CircleShape), contentAlignment = Alignment.Center) {
                        if (step.state == StepState.Done) GlyphIcon(Glyph.Check, Palette.accent, 26.dp)
                    }
                    AppText(step.label, 32, if (step.state == StepState.Waiting) Palette.faint else Palette.foreground)
                    if (step.note != null) AppText(step.note!!, 24, Palette.faint)
                }
            }
            AppText("You can use the app as soon as this finishes.", 24, Palette.faint, modifier = Modifier.padding(top = 24.dp))
        }
        if (hint != null) Toast(hint, Modifier.align(Alignment.BottomCenter))
    }
}

