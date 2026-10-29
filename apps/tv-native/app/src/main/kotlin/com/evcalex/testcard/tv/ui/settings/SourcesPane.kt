package com.evcalex.testcard.tv.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.sync.LinkExpiredException
import com.evcalex.testcard.core.sync.LinkSecrets
import com.evcalex.testcard.core.sync.LinkSetup
import com.evcalex.testcard.core.sync.SetupLinkException
import com.evcalex.testcard.core.sync.SetupProfile
import com.evcalex.testcard.core.sync.claimSetupLink
import com.evcalex.testcard.core.sync.formatLinkCode
import com.evcalex.testcard.core.sync.parseSetupFragment
import com.evcalex.testcard.core.sync.startLinkSession
import com.evcalex.testcard.core.sync.SourceDraft
import com.evcalex.testcard.core.sync.SyncAccount
import com.evcalex.testcard.core.sync.emptyDraft
import com.evcalex.testcard.core.sync.readDraft
import com.evcalex.testcard.core.text.plainReason
import com.evcalex.testcard.core.xtream.describeAccount
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.BuildConfig
import com.evcalex.testcard.tv.ui.signin.SharedSourceOffer
import com.evcalex.testcard.tv.saveSource
import com.evcalex.testcard.tv.removeSource
import com.evcalex.testcard.tv.refreshSource
import com.evcalex.testcard.tv.refreshAll
import com.evcalex.testcard.tv.SourceSummary
import com.evcalex.testcard.tv.ui.components.AppButton
import com.evcalex.testcard.tv.ui.components.AppField
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.Glyph
import com.evcalex.testcard.tv.ui.components.GlyphIcon
import com.evcalex.testcard.tv.ui.components.Modal
import com.evcalex.testcard.tv.ui.components.trapFocus
import com.evcalex.testcard.tv.ui.components.withCommas
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** Only the kinds of content a source actually has: a live-only provider does not say "0 movies". */
internal fun counts(channels: Int, movies: Int, series: Int): String {
    val parts = listOfNotNull(
        if (channels > 0) "${withCommas(channels)} channels" else null,
        if (movies > 0) "${withCommas(movies)} movies" else null,
        if (series > 0) "${withCommas(series)} series" else null,
    )
    return if (parts.isNotEmpty()) parts.joinToString(", ") else "Nothing loaded yet"
}

@Composable
internal fun SourcesPane(app: AppController) {
    val scope = rememberCoroutineScope()
    // Removing is permanent (and reaches the other devices), so it takes a second press.
    var confirming by remember { mutableStateOf<String?>(null) }
    // The source being edited: an id, "new" for one being added, or nothing.
    var editing by remember { mutableStateOf<String?>(null) }
    val signedIn = app.status.account == SyncAccount.SignedIn
    // Without an account, sources still load and live on this TV alone.
    val usable = signedIn || app.localMode
    var receiving by remember { mutableStateOf(false) }
    PaneColumn {
        Row(horizontalArrangement = Arrangement.spacedBy(32.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                AppText("Sources", 40, Palette.foreground, FontWeight.Bold)
                AppText(if (signedIn) "Adding, editing or removing a source here changes it on all your devices." else if (app.localMode) "These sources are on this TV only. Sign in from Account and updates to keep them on all your devices." else "Sign in to load your sources.", 22, Palette.muted)
            }
            if (usable) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (app.sources.size > 1) SmallButton(if (app.sources.any { it.refreshing }) "Refreshing all" else "Refresh all", { scope.launch { app.refreshAll() } }, enabled = app.sources.none { it.refreshing })
                SmallButton("Add with a code", { receiving = true })
                SmallButton("Add source", { editing = "new" }, primary = true)
            }
        }
        app.status.lastError?.let { AppText(it, 22, Palette.fault) }
        if (app.sources.isEmpty()) AppText("No sources have arrived yet. Sync runs every minute, or press Sync now in Account and updates.", 22, Palette.muted)
        for (source in app.sources) {
            Card(failed = source.failures.isNotEmpty() && !source.refreshing) {
                Column(Modifier.width(500.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        AppText(source.name, 28, Palette.foreground, FontWeight.SemiBold, Modifier.weight(1f, fill = false), maxLines = 1)
                        AppText(if (source.kind == "xtream") "Xtream" else "M3U", 22, Palette.faint, FontWeight.Medium)
                    }
                    AppText(if (source.refreshing) "Loading..." else counts(source.channels, source.movies, source.series), 22, Palette.muted)
                    AccountLine(app, source)
                    app.logins.serverFor(source.id)?.let { AppText("Main server not answering. Using ${it.replace(Regex("^https?://"), "")}", 22, Palette.fault, maxLines = 1) }
                }
                Box(Modifier.weight(1f)) {
                    if (source.refreshing) AppText("Refreshing...", 22, Palette.accent)
                    else if (source.failures.isNotEmpty()) Problem(source)
                    else source.lastRefreshedAt?.let { AppText("✓ Synced ${ago(it)}", 22, Palette.accent) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    SmallButton(if (source.refreshing) "Refreshing" else if (source.failures.isNotEmpty()) "Try again" else "Refresh", { scope.launch { app.refreshSource(source.id) } }, enabled = !source.refreshing)
                    SmallButton("Edit", { editing = source.id }, enabled = !source.refreshing)
                    SmallButton(
                        if (confirming == source.id) "Press again to remove" else "Remove",
                        { if (confirming == source.id) { confirming = null; scope.launch { app.removeSource(source.id) } } else confirming = source.id },
                        muted = true,
                    )
                }
            }
        }
    }
    editing?.let { id -> SourceFormDialog(app, if (id == "new") null else id) { editing = null } }
    if (receiving) SetupByCodeDialog(app) { receiving = false }
}

/**
 * What went wrong with a source's last import, in two lines: what did not load, then why and what is left.
 * Each reason is said once, in plain words.
 */
@Composable
internal fun Problem(source: SourceSummary) {
    val parts = source.failures.map { it.part }.toSet()
    val title = if ("all" in parts) "Couldn't refresh this source"
    else if ("movies" in parts && "series" in parts) "Movies and series didn't load"
    else if ("movies" in parts) "Movies didn't load" else "Series didn't load"
    val reasons = source.failures.map { plainReason(it.message) }.distinct().filter { it != "" }
    val kept = if ("all" in parts) source.channels + source.movies + source.series > 0 else ("movies" in parts && source.movies > 0) || ("series" in parts && source.series > 0)
    val detail = (reasons + listOfNotNull(if (kept) "What loaded last time is still here." else null)).joinToString(" ")
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        GlyphIcon(Glyph.Warning, Palette.fault, 30.dp)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            AppText(title, 22, Palette.fault, FontWeight.SemiBold, maxLines = 1)
            if (detail != "") AppText(detail, 22, Palette.muted, maxLines = 2)
        }
    }
}

/** When an Xtream account ends and how many of its streams are in use, from the provider. Nothing for a playlist. */
@Composable
internal fun AccountLine(app: AppController, source: SourceSummary) {
    if (source.kind != "xtream") return
    val account by produceState<com.evcalex.testcard.core.xtream.XtreamAccount?>(null, source.id) {
        value = withContext(Dispatchers.Default) { runCatching { app.accounts.account(source.id) }.getOrNull() }
    }
    val line = account?.let { describeAccount(it) } ?: return
    AppText(line.text, 22, if (line.warn) Palette.fault else Palette.muted, maxLines = 1)
}

internal val CONTENT = listOf("live" to "Live TV", "movies" to "Movies", "series" to "Series")

/**
 * Add a source (`sourceId` null) or change one: its name, login or playlist link, TV guide address, and which kinds of content it
 * loads. The provider is asked before anything is kept; the change reaches the other devices (`SourceForm.tsx`).
 */
@Composable
fun SourceFormDialog(app: AppController, sourceId: String?, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf<SourceDraft?>(if (sourceId == null) emptyDraft("xtream") else null) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(sourceId) {
        if (sourceId == null) return@LaunchedEffect
        val found = withContext(Dispatchers.Default) { readDraft(app.db, app.logins, sourceId) }
        if (found == null) onClose() else draft = found
    }
    fun change(next: SourceDraft) { error = null; draft = next }
    fun save() {
        val current = draft ?: return
        if (saving) return
        saving = true; error = null
        scope.launch {
            try {
                withContext(Dispatchers.Default) { app.saveSource(sourceId, current) }
                onClose()
            } catch (failure: Exception) {
                saving = false
                error = failure.message ?: "That didn't save."
            }
        }
    }
    val adding = sourceId == null
    val first = remember { FocusRequester() }
    LaunchedEffect(draft == null) { if (draft != null) runCatching { first.requestFocus() } }
    Modal(onClose) {
        Box(Modifier.fillMaxSize().background(Color(0xD905080B)), contentAlignment = Alignment.Center) {
            Column(
                Modifier.width(1080.dp).heightIn(max = 1000.dp).trapFocus().background(Palette.raised, RoundedCornerShape(18.dp)).border(1.dp, Palette.border, RoundedCornerShape(18.dp)).padding(40.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                AppText(if (adding) "Add a source" else "Edit ${draft?.name ?: "source"}", 36, Palette.foreground, FontWeight.SemiBold)
                val shown = draft
                if (shown == null) AppText("Loading...", 22, Palette.faint)
                else Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    if (adding) Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Chip("Xtream login", shown.kind == "xtream", { change(shown.copy(kind = "xtream")) }, first)
                        Chip("Playlist link (M3U)", shown.kind == "m3u", { change(shown.copy(kind = "m3u")) })
                    }
                    AppField("Name", shown.name, { change(shown.copy(name = it)) }, placeholder = "What to call it", focusRequester = if (adding) null else first)
                    if (shown.kind == "xtream") {
                        AppField("Server address", shown.server, { change(shown.copy(server = it)) }, keyboardType = KeyboardType.Uri, placeholder = "http://provider.example:8080")
                        AppField("Username", shown.username, { change(shown.copy(username = it)) })
                        AppField("Password", shown.password, { change(shown.copy(password = it)) }, password = true, placeholder = if (adding) "" else "Unchanged")
                        AppField("Backup server addresses (optional)", shown.backupUrls, { change(shown.copy(backupUrls = it)) }, keyboardType = KeyboardType.Uri, placeholder = "Other addresses for the same login, separated by commas")
                    } else {
                        AppField(
                            if (adding) "Playlist link (an Xtream get.php link works too)" else "Playlist link", shown.playlistUrl, { change(shown.copy(playlistUrl = it)) },
                            keyboardType = KeyboardType.Uri, placeholder = "http://...",
                        )
                    }
                    AppField("TV guide address (optional)", shown.epgUrl, { change(shown.copy(epgUrl = it)) }, keyboardType = KeyboardType.Uri, placeholder = "Empty uses the source's own guide")
                    Chip((if (shown.epgOptimise) "✓  " else "○  ") + "Improve TV guide matching", shown.epgOptimise, { change(shown.copy(epgOptimise = !shown.epgOptimise)) })
                    AppText("Finds the guide for channels the playlist doesn't link to one. Your channels and streams are not changed.", 20, Palette.faint)
                    AppText("Load", 22, Palette.muted, modifier = Modifier.padding(top = 8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        for ((key, label) in CONTENT) {
                            val on = when (key) { "live" -> shown.content.live; "movies" -> shown.content.movies; else -> shown.content.series }
                            Chip((if (on) "✓  " else "○  ") + label, on, {
                                val content = shown.content
                                change(shown.copy(content = com.evcalex.testcard.core.sync.SourceContent(live = if (key == "live") !on else content.live, movies = if (key == "movies") !on else content.movies, series = if (key == "series") !on else content.series)))
                            })
                        }
                    }
                }
                AppText(error ?: if (saving) "Checking with the provider..." else "Changes reach your other devices when they next sync.", 22, if (error != null) Palette.fault else Palette.faint, maxLines = 2)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.End)) {
                    AppButton("Cancel", onClose)
                    AppButton(if (saving) "Checking..." else if (adding) "Add source" else "Save", { save() }, primary = true, enabled = !saving && draft != null)
                }
            }
        }
    }
}

/**
 * Add a source someone shared by link, without typing anything: the TV shows a code, the person opens the setup link on a phone and
 * types the code there, and the TV claims the source itself and asks before adding it. A sign-in sent to this code is not used here.
 */
@Composable
fun SetupByCodeDialog(app: AppController, onClose: () -> Unit) {
    var offer by remember { mutableStateOf<Pair<String, Long>?>(null) }
    var offered by remember { mutableStateOf<SetupProfile?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var round by remember { mutableStateOf(0) }
    var secondsLeft by remember { mutableStateOf(0) }
    val close = remember { FocusRequester() }
    LaunchedEffect(offered) { if (offered == null) runCatching { close.requestFocus() } }
    LaunchedEffect(round) {
        offer = null; offered = null; message = null
        try {
            withContext(Dispatchers.Default) {
                val session = startLinkSession(BuildConfig.SYNC_URL, app.http)
                offer = session.code to session.expiresAt
                when (val outcome = session.waitForApproval()) {
                    is LinkSecrets -> message = "That was a sign-in, not a setup link. To sign in, use Account and updates."
                    is LinkSetup -> {
                        val link = parseSetupFragment(outcome.link) ?: throw SetupLinkException("This link is damaged or incomplete. Ask whoever sent it for a new one.")
                        offered = claimSetupLink(link, BuildConfig.SYNC_URL, app.http)
                    }
                }
            }
        } catch (failure: Exception) {
            if (failure is kotlinx.coroutines.CancellationException) throw failure
            if (failure is LinkExpiredException) { round += 1; return@LaunchedEffect }
            message = failure.message ?: "That didn't work."
        }
    }
    LaunchedEffect(offer) {
        val expires = offer?.second ?: return@LaunchedEffect
        while (true) {
            secondsLeft = maxOf(0L, Math.round((expires - nowMs()) / 1000.0)).toInt()
            delay(1000)
        }
    }
    Modal(onClose) {
        Box(Modifier.fillMaxSize().background(Color(0xD905080B)), contentAlignment = Alignment.Center) {
            Column(
                Modifier.width(1000.dp).trapFocus().background(Palette.raised, RoundedCornerShape(18.dp)).border(1.dp, Palette.border, RoundedCornerShape(18.dp)).padding(40.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                val shared = offered
                if (shared != null) SharedSourceOffer(app, shared) { added -> if (added) onClose() else round += 1 }
                else {
                    AppText("Add with a code", 36, Palette.foreground, FontWeight.SemiBold)
                    AppText("On your phone, open the setup link you were sent and enter this code:", 22, Palette.muted)
                    AppText(offer?.let { formatLinkCode(it.first) } ?: "........", 80, Palette.foreground, FontWeight.SemiBold, letterSpacing = 8f)
                    AppText(message ?: if (offer == null) "Getting a code..." else "Waiting for you. The code lasts ${secondsLeft / 60}:${(secondsLeft % 60).toString().padStart(2, '0')} more.", 22, if (message != null) Palette.fault else Palette.muted)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.End)) {
                        if (message != null) AppButton("Try again", { round += 1 })
                        AppButton("Cancel", onClose, primary = true, focusRequester = close)
                    }
                }
            }
        }
    }
}
