package com.evcalex.testcard.tv.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.playback.CAPTION_SETTINGS
import com.evcalex.testcard.core.playback.CAPTION_TEXT_FRACTION
import com.evcalex.testcard.core.playback.CaptionPrefs
import com.evcalex.testcard.core.playback.CaptionSetting
import com.evcalex.testcard.core.playback.captionLook
import com.evcalex.testcard.core.playback.settingLabel
import com.evcalex.testcard.core.playback.settingValue
import com.evcalex.testcard.core.playback.withSetting
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.Focusable
import com.evcalex.testcard.tv.ui.components.Glyph
import com.evcalex.testcard.tv.ui.components.GlyphIcon
import com.evcalex.testcard.tv.ui.components.OptionsSheet
import com.evcalex.testcard.tv.ui.components.SheetOption
import com.evcalex.testcard.tv.ui.theme.Palette

internal const val PREVIEW_WIDTH = 720
internal const val PREVIEW_HEIGHT = 405

/** How captions will look: two lines of dialogue at the chosen size, colour, background and edge, on a dark frame. */
@Composable
internal fun CaptionPreview(prefs: CaptionPrefs) {
    val look = captionLook(prefs)
    val size = Math.round(PREVIEW_HEIGHT * CAPTION_TEXT_FRACTION * look.textScale)
    val fill = if (look.background == 0) Color.Transparent else Color(look.background)
    val shadow = if (look.edge == "shadow") androidx.compose.ui.graphics.Shadow(Color.Black, androidx.compose.ui.geometry.Offset(size * 0.08f, size * 0.08f), size * 0.12f)
    else if (look.edge == "outline") androidx.compose.ui.graphics.Shadow(Color.Black, androidx.compose.ui.geometry.Offset.Zero, size * 0.2f) else null
    Box(Modifier.size(PREVIEW_WIDTH.dp, PREVIEW_HEIGHT.dp).background(Color(0xFF16191D), RoundedCornerShape(14.dp))) {
        Column(Modifier.align(Alignment.BottomCenter).padding(bottom = (PREVIEW_HEIGHT * 0.08f).dp), horizontalAlignment = Alignment.CenterHorizontally) {
            for (line in listOf(" I told you we'd make it back ", " before it got dark. ")) {
                androidx.compose.foundation.text.BasicText(
                    line, Modifier.background(fill),
                    style = androidx.compose.ui.text.TextStyle(color = Color(look.color), fontSize = size.sp(), fontWeight = FontWeight.Medium, shadow = shadow, lineHeight = (size * 1.3f).sp()),
                )
            }
        }
    }
}

internal fun Int.sp() = androidx.compose.ui.unit.TextUnit(this.toFloat(), androidx.compose.ui.unit.TextUnitType.Sp)
internal fun Float.sp() = androidx.compose.ui.unit.TextUnit(this, androidx.compose.ui.unit.TextUnitType.Sp)

internal val CAPTION_GROUPS = listOf("When" to listOf("always", "language"), "Look" to listOf("size", "color", "background", "edge"))

/** Whether films and episodes start with captions on and in which language, and how they look, beside a preview (`CaptionSettings.tsx`). */
@Composable
internal fun CaptionsPane(app: AppController) {
    val captions = app.captions
    var open by remember { mutableStateOf<CaptionSetting?>(null) }
    // The choice highlighted in the open list, previewed before it is picked.
    var trying by remember { mutableStateOf<String?>(null) }
    PaneColumn {
        AppText("Captions", 40, Palette.foreground, FontWeight.Bold)
        AppText("Films and episodes, on this TV.", 22, Palette.muted)
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(44.dp)) {
            Column(Modifier.width(560.dp), verticalArrangement = Arrangement.spacedBy(40.dp)) {
                for ((title, keys) in CAPTION_GROUPS) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        AppText(title.uppercase(), 18, Palette.faint, FontWeight.SemiBold, Modifier.padding(start = 4.dp, bottom = 4.dp), letterSpacing = 2f)
                        for (key in keys) {
                            val setting = CAPTION_SETTINGS.first { it.key == key }
                            val idle = key == "language" && !captions.always
                            Focusable({ open = setting }, Modifier.fillMaxWidth().height72(), RoundedCornerShape(14.dp), ring = false, background = Palette.raised, focusedBackground = Palette.foreground) { focused ->
                                Row(Modifier.fillMaxSize().padding(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                    AppText(setting.label, 24, if (focused) Palette.background else Palette.foreground, FontWeight.Medium, Modifier.weight(1f))
                                    AppText(settingLabel(captions, setting), 24, if (focused) Palette.background else if (idle) Palette.faint else Palette.muted, maxLines = 1)
                                    GlyphIcon(Glyph.ChevronRight, if (focused) Palette.background else Palette.faint, 24.dp)
                                }
                            }
                        }
                    }
                }
            }
            Column(Modifier.padding(top = 34.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                CaptionPreview(captions)
                AppText(if (captions.always) "On by themselves, in ${settingLabel(captions, CAPTION_SETTINGS[1])}" else "Off until you turn them on with the CC button", 22, Palette.faint)
            }
        }
    }
    open?.let { setting ->
        // Whether and in which language they come on is not something a picture shows.
        val looks = setting.key != "always" && setting.key != "language"
        OptionsSheet(
            setting.label, setting.values.map { SheetOption(it.id, it.label) }, { app.changeCaptions(withSetting(captions, setting.key, it)) },
            { open = null; trying = null }, preferredId = settingValue(captions, setting.key),
            aside = if (looks) ({ CaptionPreview(withSetting(captions, setting.key, trying ?: settingValue(captions, setting.key))) }) else null,
            onFocusId = { trying = it },
        )
    }
}

internal fun Modifier.height72() = this.then(Modifier.heightIn(min = 72.dp, max = 72.dp))
