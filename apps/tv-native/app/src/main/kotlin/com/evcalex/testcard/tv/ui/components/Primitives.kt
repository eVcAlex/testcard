package com.evcalex.testcard.tv.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.evcalex.testcard.core.db.Profile
import com.evcalex.testcard.core.db.avatarGlyph
import com.evcalex.testcard.core.db.profileColour
import com.evcalex.testcard.tv.ui.theme.Palette

/** The select key of a remote: the centre button or Enter. */
private fun isSelect(key: Key) = key == Key.DirectionCenter || key == Key.Enter || key == Key.NumPadEnter

/**
 * Select acts on release; holding it past the system's long-press time acts once as a long press, and the release after it
 * does nothing (`Focusable` with a long-press in the React Native app: ignore the release). A tap on a touch screen or
 * mouse does the same, so the app can be driven from a desk.
 */
fun Modifier.remoteSelect(onClick: () -> Unit, onLongClick: (() -> Unit)? = null, enabled: Boolean = true): Modifier = composed {
    val state = remember { object { var pressed = false; var long = false } }
    this
        .onKeyEvent { event ->
            if (!enabled || !isSelect(event.key)) return@onKeyEvent false
            when (event.type) {
                KeyEventType.KeyDown -> {
                    if (!state.pressed) { state.pressed = true; state.long = false }
                    if (onLongClick != null && event.nativeKeyEvent.isLongPress && !state.long) {
                        state.long = true
                        onLongClick()
                    }
                    true
                }
                KeyEventType.KeyUp -> {
                    val fire = state.pressed && !state.long
                    state.pressed = false
                    state.long = false
                    if (fire) onClick()
                    true
                }
                else -> false
            }
        }
        .pointerInput(enabled, onClick, onLongClick) {
            if (enabled) detectTapGestures(onTap = { onClick() }, onLongPress = onLongClick?.let { long -> { _ -> long() } })
        }
}

/**
 * The one interactive primitive. On a Fire TV remote there is no pointer: the D-pad moves focus between these, so every one
 * draws an obvious focus ring (`Focusable.tsx`). `content` is told whether it has focus.
 */
@Composable
fun Focusable(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(16.dp),
    onLongClick: (() -> Unit)? = null,
    onFocusChange: ((Boolean) -> Unit)? = null,
    focusRequester: FocusRequester? = null,
    ring: Boolean = true,
    enabled: Boolean = true,
    background: Color = Color.Transparent,
    focusedBackground: Color = background,
    contentAlignment: Alignment = Alignment.TopStart,
    content: @Composable BoxScope.(focused: Boolean) -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    Box(
        modifier
            .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
            .onFocusChanged { state ->
                if (state.isFocused != focused) {
                    focused = state.isFocused
                    onFocusChange?.invoke(state.isFocused)
                }
            }
            .focusable(enabled)
            .remoteSelect(onClick, onLongClick, enabled)
            .background(if (focused) focusedBackground else background, shape)
            .border(3.dp, if (focused && ring) Palette.accent else Color.Transparent, shape),
        contentAlignment = contentAlignment,
    ) { content(focused) }
}

@Composable
fun AppText(text: String, size: Int, color: Color = Palette.foreground, weight: FontWeight = FontWeight.Normal, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE, align: TextAlign? = null, letterSpacing: Float = 0f, lineHeight: Int? = null, onTextLayout: ((Int) -> Unit)? = null) {
    Text(
        text, modifier, color = color, fontSize = size.sp, fontWeight = weight, maxLines = maxLines, overflow = TextOverflow.Ellipsis, textAlign = align,
        letterSpacing = letterSpacing.sp, lineHeight = lineHeight?.sp ?: androidx.compose.ui.unit.TextUnit.Unspecified, onTextLayout = onTextLayout?.let { report -> { layout -> report(layout.lineCount) } } ?: {},
    )
}

/** A rounded button. `primary` only differs when focused: it fills bright, so it never looks selected while a sibling has focus. */
@Composable
fun AppButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, primary: Boolean = false, enabled: Boolean = true, focusRequester: FocusRequester? = null, wide: Boolean = false) {
    Focusable(
        onClick, modifier.then(if (wide) Modifier.width(560.dp) else Modifier).height(72.dp).alpha(if (enabled) 1f else 0.5f), CircleShape,
        focusRequester = focusRequester, enabled = enabled,
        background = Color(0x1FFFFFFF), focusedBackground = if (primary) Palette.foreground else Color(0x1FFFFFFF), contentAlignment = Alignment.Center,
    ) { focused ->
        AppText(label, 26, if (primary && focused) Palette.background else Palette.foreground, FontWeight.Medium, Modifier.padding(horizontal = 40.dp), maxLines = 1)
    }
}

/**
 * A text field that is also a focus stop. The field itself takes focus (and the keyboard opens) only when select is pressed,
 * so landing on a form, or moving past a field, never throws the keyboard up over it (`controls.tsx` Field on a TV).
 */
@Composable
fun AppField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    password: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    placeholder: String = "",
    imeAction: ImeAction = ImeAction.Done,
    onDone: () -> Unit = {},
    focusRequester: FocusRequester? = null,
) {
    var editing by remember { mutableStateOf(false) }
    val inner = remember { FocusRequester() }
    val outer = focusRequester ?: remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(editing) {
        if (editing) {
            inner.requestFocus()
            keyboard?.show()
        }
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AppText(label, 18, Palette.muted)
        Focusable({ editing = true }, Modifier.fillMaxWidth(), RoundedCornerShape(10.dp), focusRequester = outer, ring = !editing, background = Palette.sunken) { focused ->
            Box(
                Modifier.fillMaxWidth().border(3.dp, if (focused || editing) Palette.accent else Palette.border, RoundedCornerShape(10.dp)).padding(horizontal = 16.dp, vertical = 16.dp),
            ) {
                BasicTextField(
                    value, onChange,
                    Modifier
                        .fillMaxWidth()
                        .focusRequester(inner)
                        .focusProperties { canFocus = editing }
                        .onFocusChanged { if (!it.isFocused && editing) { editing = false } },
                    singleLine = true,
                    textStyle = androidx.compose.ui.text.TextStyle(color = Palette.foreground, fontSize = 22.sp, fontFamily = com.evcalex.testcard.tv.ui.theme.Inter),
                    cursorBrush = SolidColor(Palette.accent),
                    visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
                    keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboardType, imeAction = imeAction),
                    keyboardActions = KeyboardActions(onAny = { editing = false; keyboard?.hide(); outer.requestFocus(); onDone() }),
                    decorationBox = { inside ->
                        if (value.isEmpty() && placeholder.isNotEmpty()) AppText(placeholder, 22, Palette.faint)
                        inside()
                    },
                )
            }
        }
    }
}

/** A section tab in the top bar: grey at rest, white with an accent underline when open, a glass pill under the remote's focus. */
@Composable
fun NavTab(
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    glyph: Glyph? = null,
    icon: (@Composable (Color) -> Unit)? = null,
    badge: Boolean = false,
    chip: Boolean = false,
    trailing: Glyph? = null,
    focusRequester: FocusRequester? = null,
    onFocusChange: ((Boolean) -> Unit)? = null,
) {
    val iconOnly = label == null
    Focusable(
        onClick,
        modifier.height(60.dp).then(if (iconOnly) Modifier.width(60.dp) else Modifier),
        CircleShape,
        onFocusChange = onFocusChange,
        focusRequester = focusRequester,
        ring = false,
        focusedBackground = Color(0x1FFFFFFF),
        contentAlignment = Alignment.Center,
    ) { focused ->
        val on = focused || active
        val ink = if (on) Palette.foreground else Palette.muted
        Row(
            Modifier.then(if (iconOnly) Modifier else Modifier.padding(start = 28.dp, end = if (chip) 22.dp else 28.dp)),
            horizontalArrangement = Arrangement.spacedBy(if (chip) 6.dp else 10.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            if (glyph != null) GlyphIcon(glyph, ink, 30.dp)
            icon?.invoke(ink)
            if (label != null) AppText(label, 26, ink, if (on) FontWeight.Medium else FontWeight.Normal, maxLines = 1)
            if (trailing != null) GlyphIcon(trailing, ink, 22.dp)
        }
        if (badge) Box(Modifier.align(if (iconOnly) Alignment.TopEnd else Alignment.CenterEnd).padding(top = if (iconOnly) 10.dp else 0.dp, end = 10.dp).size(10.dp).background(Palette.accent, CircleShape))
        if (active && !focused && !chip) Box(
            Modifier.matchParentSize().drawBehind {
                val inset = (if (iconOnly) 18.dp else 28.dp).toPx()
                drawRoundRect(Palette.accent, Offset(inset, size.height - 7.dp.toPx()), Size(size.width - inset * 2, 3.dp.toPx()), CornerRadius(2.dp.toPx()))
            },
        )
    }
}

/** One choice in a horizontal row (the Live TV categories): quiet at rest, outlined when open, filled cream under focus. */
@Composable
fun Pill(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, active: Boolean = false, onFocusChange: ((Boolean) -> Unit)? = null, focusRequester: FocusRequester? = null) {
    Focusable(
        onClick, modifier.height(56.dp), CircleShape,
        onFocusChange = onFocusChange, focusRequester = focusRequester, ring = false,
        background = Palette.card, focusedBackground = Palette.accent, contentAlignment = Alignment.Center,
    ) { isFocused ->
        Box(Modifier.border(3.dp, if (isFocused) Palette.accent else if (active) Color(0x66FFFFFF) else Color.Transparent, CircleShape).padding(horizontal = 28.dp).height(56.dp), contentAlignment = Alignment.Center) {
            AppText(label, 24, if (isFocused) Palette.accentInk else if (active) Palette.foreground else Palette.muted, if (isFocused || active) FontWeight.Medium else FontWeight.Normal, maxLines = 1)
        }
    }
}

/**
 * One line of a vertical menu (the category list): idle rows are quiet grey, the open one is white with an accent tick, and
 * the remote's focus is a soft glass pill.
 */
@Composable
fun MenuRow(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    indent: Boolean = false,
    /** Present on an expandable heading: whether it is expanded. */
    open: Boolean? = null,
    onFocusChange: ((Boolean) -> Unit)? = null,
    focusRequester: FocusRequester? = null,
    onLongClick: (() -> Unit)? = null,
) {
    Focusable(
        onClick, modifier.fillMaxWidth().height(60.dp), RoundedCornerShape(16.dp),
        onLongClick = onLongClick, onFocusChange = onFocusChange, focusRequester = focusRequester, ring = false,
        focusedBackground = Color(0x1FFFFFFF), contentAlignment = Alignment.CenterStart,
    ) { focused ->
        val ink = if (focused || active) Palette.foreground else Palette.muted
        if (active && !focused) Box(Modifier.padding(start = 8.dp).width(4.dp).height(26.dp).background(Palette.accent, RoundedCornerShape(2.dp)))
        Row(Modifier.padding(start = if (indent) 52.dp else 26.dp, end = 26.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            if (open != null) GlyphIcon(Glyph.ArrowDown, ink, 22.dp, Modifier.rotate(if (open) 0f else -90f))
            AppText(label, 25, ink, if (active || focused) FontWeight.Medium else FontWeight.Normal, maxLines = 1)
        }
    }
}

/** A profile's disc: its colour and its avatar (or the first letter of its name), with a small lock when it has a PIN. */
@Composable
fun AvatarDisc(profile: Profile, size: Dp, modifier: Modifier = Modifier) {
    val glyph = avatarGlyph(profile)
    Box(modifier.size(size)) {
        Box(Modifier.size(size).background(Color(android.graphics.Color.parseColor(profileColour(profile))), CircleShape), contentAlignment = Alignment.Center) {
            if (glyph != null) Text(glyph, fontSize = (size.value * 0.56f).sp)
            else AppText(profile.name.trim().take(1).uppercase().ifEmpty { "?" }, (size.value * 0.44f).toInt(), Palette.accentInk, FontWeight.SemiBold)
        }
        if (profile.pin != null) {
            val lock = size * 0.22f
            Box(Modifier.align(Alignment.BottomEnd).size(lock * 1.8f).background(Palette.raised, CircleShape).border(2.dp, Palette.background, CircleShape), contentAlignment = Alignment.Center) {
                GlyphIcon(Glyph.Lock, Palette.foreground, lock)
            }
        }
    }
}

/** The round "back" arrow at the top left of a page: a glass disc at rest, solid white under the remote's focus. */
@Composable
fun BackArrow(onClick: () -> Unit, modifier: Modifier = Modifier, focusRequester: FocusRequester? = null) {
    Focusable(onClick, modifier.size(72.dp), CircleShape, focusRequester = focusRequester, ring = false, background = Color(0x1FFFFFFF), focusedBackground = Palette.foreground, contentAlignment = Alignment.Center) { focused ->
        GlyphIcon(Glyph.Back, if (focused) Color(0xFF0B0E10) else Palette.foreground, 32.dp)
    }
}

/** A small "Pinned" tag beside a row's title, so a category you pinned to Home reads as yours. */
@Composable
fun PinBadge(modifier: Modifier = Modifier) {
    Row(modifier.border(2.dp, Palette.accent, CircleShape).padding(horizontal = 16.dp, vertical = 5.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).background(Palette.accent, CircleShape))
        AppText("Pinned", 20, Palette.accent, FontWeight.SemiBold, letterSpacing = 0.5f)
    }
}

/** The page colour fading out from one edge: solid at the named edge, clear at the far side. */
enum class FadeFrom { Left, Top, Bottom }

@Composable
fun Fade(from: FadeFrom, modifier: Modifier = Modifier, strength: Float = 1f) {
    val solid = Color(10, 13, 17, (255 * strength).toInt())
    val soft = Color(10, 13, 17, (255 * strength * 0.55f).toInt())
    val clear = Color(10, 13, 17, 0)
    val brush = when (from) {
        FadeFrom.Left -> Brush.horizontalGradient(0f to solid, 0.45f to soft, 1f to clear)
        FadeFrom.Top -> Brush.verticalGradient(0f to solid, 0.45f to soft, 1f to clear)
        FadeFrom.Bottom -> Brush.verticalGradient(0f to clear, 0.55f to soft, 1f to solid)
    }
    Box(modifier.background(brush))
}

/** A short message over the page, bottom centre (the "press back again" hint). */
@Composable
fun Toast(text: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(bottom = 60.dp), contentAlignment = Alignment.BottomCenter) {
        AppText(text, 26, Palette.foreground, modifier = Modifier.background(Color(0xD9000000), CircleShape).padding(horizontal = 32.dp, vertical = 14.dp))
    }
}

/** 12345 -> "12,345" (`withCommas`). */
fun withCommas(n: Int): String = n.toString().replace(Regex("\\B(?=(\\d{3})+(?!\\d))"), ",")
