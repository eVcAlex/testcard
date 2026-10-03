package com.evcalex.testcard.tv.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.sp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Typography
import androidx.tv.material3.darkColorScheme
import com.evcalex.testcard.tv.R

/** The tokens of `apps/mobile/src/theme.ts`. Dark only, sized for a TV. */
object Palette {
    val background = Color(0xFF0A0D11)
    val sunken = Color(0xFF07090C)
    val raised = Color(0xFF12161B)
    val card = Color(0xFF171C22)
    val cardActive = Color(0xFF232A32)
    val border = Color(0xFF252C34)
    val foreground = Color(0xFFF2EEE7)
    val muted = Color(0xFFA4A9AF)
    val faint = Color(0xFF737A82)
    val accent = Color(0xFFE7D2AD)
    val accentInk = Color(0xFF1D160A)
    val accentSoft = Color(0x26E7D2AD)
    val fault = Color(0xFFF0745C)
    val live = Color(0xFFE8402A)
}

val Inter = FontFamily(
    Font(R.font.inter_400, FontWeight.Normal),
    Font(R.font.inter_500, FontWeight.Medium),
    Font(R.font.inter_600, FontWeight.SemiBold),
)

private const val DESIGN_WIDTH = 1920f

/**
 * Every size is written for a 1920 px wide screen, as in the React Native app. A 1080p Fire TV reports 960 dp, so the
 * density is set to (screen width / 1920), clamped to the same 0.4..1.5 as `uiScale`; a `dp` is then one design pixel.
 */
@Composable
fun TestcardTheme(content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val configuration = LocalConfiguration.current
    val widestPx = maxOf(configuration.screenWidthDp, configuration.screenHeightDp) * density.density
    val scale = (widestPx / DESIGN_WIDTH).coerceIn(0.4f, 1.5f)
    val base = TextStyle(fontFamily = Inter, color = Palette.foreground)
    val typography = Typography(
        displayMedium = base.copy(fontSize = 40.sp, fontWeight = FontWeight.SemiBold),
        bodyLarge = base.copy(fontSize = 22.sp),
        bodyMedium = base.copy(fontSize = 18.sp),
    )
    CompositionLocalProvider(LocalDensity provides Density(scale, density.fontScale)) {
        MaterialTheme(
            colorScheme = darkColorScheme(
                background = Palette.background,
                surface = Palette.card,
                onBackground = Palette.foreground,
                onSurface = Palette.foreground,
                primary = Palette.accent,
                onPrimary = Palette.accentInk,
                error = Palette.fault,
            ),
            typography = typography,
            content = content,
        )
    }
}
