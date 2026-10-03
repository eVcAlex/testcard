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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.tv.platform.UpdatePhase
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.text.plainReason
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.ui.components.AppButton
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.Focusable
import com.evcalex.testcard.tv.ui.components.MenuRow
import com.evcalex.testcard.tv.ui.components.Modal
import com.evcalex.testcard.tv.ui.components.trapFocus
import com.evcalex.testcard.tv.ui.profiles.ProfileSettings
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext



/** "just now", "5 min ago", "3 hours ago", "2 days ago". */
internal fun ago(at: Long, now: Long = nowMs()): String {
    val minutes = Math.max(0L, Math.round((now - at) / 60000.0))
    if (minutes < 1) return "just now"
    if (minutes < 60) return "$minutes min ago"
    val hours = Math.round(minutes / 60.0)
    if (hours < 24) return "$hours ${if (hours == 1L) "hour" else "hours"} ago"
    val days = Math.round(hours / 24.0)
    return "$days ${if (days == 1L) "day" else "days"} ago"
}

internal enum class Pane(val label: String) { Sources("Sources"), Hidden("Hidden"), Profiles("Profiles"), Captions("Captions"), Account("Account and updates") }

/**
 * The Settings tab: a short menu down the left and the chosen pane beside it. The pane follows the remote as it moves down the
 * menu, as the category lists do; Right goes into it (`Sources.tsx`).
 */
@Composable
fun SettingsScreen(app: AppController) {
    var pane by remember { mutableStateOf(Pane.Sources) }
    Row(Modifier.fillMaxSize().padding(start = 44.dp, top = 112.dp), horizontalArrangement = Arrangement.spacedBy(40.dp)) {
        Column(Modifier.width(380.dp).padding(top = 40.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for (entry in Pane.entries) MenuRow(entry.label, { pane = entry }, active = pane == entry, onFocusChange = { if (it) pane = entry })
        }
        Box(Modifier.weight(1f).fillMaxHeight()) {
            when (pane) {
                Pane.Sources -> SourcesPane(app)
                Pane.Hidden -> HiddenPane(app)
                Pane.Profiles -> ProfileSettings(app)
                Pane.Captions -> CaptionsPane(app)
                Pane.Account -> AccountPane(app)
            }
        }
    }
}

@Composable
internal fun PaneColumn(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 8.dp, end = 44.dp, top = 40.dp, bottom = 60.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) { content() }
}

/** A lower-key button for a row of controls that isn't the page's main action: smaller than the standard button. */
@Composable
internal fun SmallButton(label: String, onClick: () -> Unit, primary: Boolean = false, muted: Boolean = false, enabled: Boolean = true) {
    Focusable(
        onClick, Modifier.alpha(if (enabled) 1f else 0.5f), CircleShape, enabled = enabled, ring = !muted,
        background = if (primary) Palette.accent else if (muted) Color.Transparent else Palette.card,
        focusedBackground = if (muted) Color(0x1AF0745C) else if (primary) Palette.accent else Palette.card,
    ) { focused ->
        Box(Modifier.then(if (muted) Modifier.border(2.dp, if (focused) Palette.fault else Palette.border, CircleShape) else Modifier).padding(horizontal = 26.dp, vertical = 14.dp)) {
            AppText(label, 22, if (primary) Palette.accentInk else if (muted) Palette.muted else Palette.foreground, FontWeight.SemiBold, maxLines = 1)
        }
    }
}

@Composable
internal fun Card(modifier: Modifier = Modifier, failed: Boolean = false, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(
        modifier.fillMaxWidth().background(Palette.raised, RoundedCornerShape(16.dp)).border(1.dp, if (failed) Color(0x59F0745C) else Palette.border, RoundedCornerShape(16.dp)).padding(24.dp),
        horizontalArrangement = Arrangement.spacedBy(32.dp), verticalAlignment = Alignment.CenterVertically,
    ) { content() }
}

// ---- Sources

// ---- The source form

@Composable
internal fun Chip(label: String, on: Boolean, onClick: () -> Unit, focusRequester: FocusRequester? = null) {
    Focusable(
        onClick, shape = CircleShape, focusRequester = focusRequester, ring = false,
        background = if (on) Palette.accentSoft else Color.Transparent, focusedBackground = Palette.foreground, contentAlignment = Alignment.Center,
    ) { focused ->
        Box(Modifier.border(2.dp, if (focused) Palette.foreground else if (on) Palette.accent else Palette.border, CircleShape).padding(horizontal = 28.dp, vertical = 14.dp)) {
            AppText(label, 24, if (focused) Palette.background else if (on) Palette.foreground else Palette.muted, FontWeight.Medium, maxLines = 1)
        }
    }
}

// ---- Hidden

// ---- Captions

// ---- Account and updates

/** Who this TV is signed in as, syncing, and the app's version and updates. */
@Composable
internal fun AccountPane(app: AppController) {
    val scope = rememberCoroutineScope()
    var confirmingSignOut by remember { mutableStateOf(false) }
    val status = app.status
    val context = androidx.compose.ui.platform.LocalContext.current
    val version = remember { runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "0" }
    PaneColumn {
        AppText("Account and updates", 40, Palette.foreground, FontWeight.Bold)
        Card {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                AppText(status.email ?: "Signed out", 26, Palette.foreground, FontWeight.Medium, maxLines = 1)
                status.lastSyncedAt?.let { AppText("✓ Synced ${ago(it)}", 22, Palette.faint) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                SmallButton("Sync now", { scope.launch { withContext(Dispatchers.Default) { app.sync.triggerNow() } } })
                SmallButton("Sign out", { confirmingSignOut = true })
            }
        }
        val update = app.updates
        Card {
            val line = when {
                update.phase == UpdatePhase.Error && update.error != null -> "Couldn't ${if (update.available != null) "update" else "check for updates"}. ${plainReason(update.error!!, "the update server")}"
                update.phase == UpdatePhase.Downloading -> "Downloading ${Math.round(update.progress * 100)}%"
                update.phase == UpdatePhase.Checking -> "Checking for updates..."
                update.available != null -> "Version ${update.available!!.versionName} is available."
                update.checked -> "You are up to date."
                else -> "Not checked yet."
            }
            AppText("Testcard $version  ·  $line", 24, if (update.phase == UpdatePhase.Error) Palette.fault else Palette.muted, modifier = Modifier.weight(1f))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                SmallButton("Check automatically: ${if (update.auto) "On" else "Off"}", { update.changeAuto(!update.auto) })
                SmallButton(
                    if (update.available != null) "Update now" else "Check for updates", { if (update.available != null) update.showPrompt() else update.check() },
                    primary = update.available != null, enabled = update.phase != UpdatePhase.Downloading && update.phase != UpdatePhase.Checking && update.phase != UpdatePhase.Installing,
                )
            }
        }
    }
    if (confirmingSignOut) {
        val stay = remember { FocusRequester() }
        LaunchedEffect(Unit) { runCatching { stay.requestFocus() } }
        Modal({ confirmingSignOut = false }) {
            Box(Modifier.fillMaxSize().background(Color(0xCC05080B)), contentAlignment = Alignment.Center) {
                Column(Modifier.width(760.dp).trapFocus().background(Palette.raised, RoundedCornerShape(18.dp)).border(1.dp, Palette.border, RoundedCornerShape(18.dp)).padding(40.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                    AppText("Sign out?", 36, Palette.foreground, FontWeight.SemiBold)
                    AppText("Syncing stops on this TV until you sign in again. You will need your account password.", 22, Palette.muted)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.End)) {
                        AppButton("Stay signed in", { confirmingSignOut = false }, primary = true, focusRequester = stay)
                        AppButton("Sign out", { confirmingSignOut = false; scope.launch { withContext(Dispatchers.Default) { app.signOut() } } })
                    }
                }
            }
        }
    }
}
