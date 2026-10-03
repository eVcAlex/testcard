package com.evcalex.testcard.tv.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.tv.platform.UpdatePhase
import com.evcalex.testcard.tv.platform.Updater
import com.evcalex.testcard.tv.ui.components.AppButton
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.Modal
import com.evcalex.testcard.tv.ui.components.trapFocus
import com.evcalex.testcard.tv.ui.theme.Palette

/**
 * "A new version is ready": what changed since the installed build, and Update now or Later. Update now downloads it here,
 * with its progress, then Android asks once to install it; nothing else to open or download by hand (`UpdatePrompt.tsx`).
 */
@Composable
fun UpdatePrompt(updater: Updater) {
    val info = updater.available
    if (!updater.prompting || info == null) return
    val working = updater.phase == UpdatePhase.Downloading || updater.phase == UpdatePhase.Installing
    val changes = info.notes.flatMap { it.changes }
    val status = when {
        updater.phase == UpdatePhase.Downloading -> "Downloading ${Math.round(updater.progress * 100)}%"
        updater.phase == UpdatePhase.Installing -> "Opening the installer..."
        updater.phase == UpdatePhase.Permission -> "Android needs your OK first: allow Testcard to install unknown apps. Settings opens; turn Testcard on, then come back and the update carries on."
        updater.phase == UpdatePhase.Error && updater.error != null -> updater.error
        else -> null
    }
    val first = remember { FocusRequester() }
    LaunchedEffect(updater.phase) { delay(50); runCatching { first.requestFocus() } }
    Modal({ if (!working) updater.later() }) {
        Box(Modifier.fillMaxSize().background(Color(0xD905080B)), contentAlignment = Alignment.Center) {
            Column(
                Modifier.width(900.dp).heightIn(max = 900.dp).trapFocus().background(Palette.raised, RoundedCornerShape(18.dp)).border(1.dp, Palette.border, RoundedCornerShape(18.dp)).padding(40.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                AppText("Testcard ${info.versionName} is ready", 36, Palette.foreground, FontWeight.SemiBold)
                AppText("You have ${updater.installedName}.", 22, Palette.muted)
                if (changes.isNotEmpty()) {
                    Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (change in changes.take(12)) AppText("•  $change", 26, Palette.foreground)
                    }
                } else AppText("Fixes and improvements.", 26, Palette.foreground)
                if (updater.phase == UpdatePhase.Downloading) {
                    Box(Modifier.fillMaxWidth().height(8.dp).background(Palette.card, RoundedCornerShape(4.dp))) {
                        Box(Modifier.fillMaxHeight().fillMaxWidth(updater.progress.coerceIn(0f, 1f)).background(Palette.accent, RoundedCornerShape(4.dp)))
                    }
                }
                if (status != null) AppText(status, 22, if (updater.phase == UpdatePhase.Error) Palette.fault else Palette.muted)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.End)) {
                    AppButton("Later", { updater.later() }, enabled = !working)
                    if (updater.phase == UpdatePhase.Permission) AppButton("Open settings", { updater.openInstallSetting() }, primary = true, focusRequester = first)
                    else AppButton(if (updater.phase == UpdatePhase.Error) "Try again" else if (working) "Updating..." else "Update now", { updater.install() }, primary = true, enabled = !working, focusRequester = first)
                }
            }
        }
    }
}
