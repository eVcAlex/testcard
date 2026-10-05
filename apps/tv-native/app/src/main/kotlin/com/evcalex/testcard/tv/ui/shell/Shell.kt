package com.evcalex.testcard.tv.ui.shell

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.playback.PlayItem
import com.evcalex.testcard.core.playback.PlayKind
import com.evcalex.testcard.core.sync.SyncAccount
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.AvatarDisc
import com.evcalex.testcard.tv.ui.components.Glyph
import com.evcalex.testcard.tv.ui.components.NavTab
import com.evcalex.testcard.tv.ui.components.SetupOverlay
import com.evcalex.testcard.tv.ui.components.SourcePicker
import com.evcalex.testcard.tv.ui.components.Toast
import com.evcalex.testcard.tv.ui.components.trapFocus
import com.evcalex.testcard.tv.ui.profiles.WhoIsWatching
import com.evcalex.testcard.tv.ui.signin.SignInScreen
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.delay

enum class Section(val label: String) { Home("Home"), Live("Live TV"), Movies("Movies"), Series("Series"), Search("Search"), Settings("Settings") }

/** Where the app is: the shell (Home and its sections), a detail page over it, or the player over everything. */
sealed interface Route {
    data object Shell : Route
    class Series(val id: String, val title: String) : Route
    class Movie(val id: String, val title: String) : Route
    class Play(val item: PlayItem, val seriesId: String?, val channels: List<PlayItem>?, val resume: Boolean, val returnTo: Route) : Route
}

/** What a section can ask the shell to do. */
class ShellActions(
    val openMovie: (id: String, title: String) -> Unit,
    val openSeries: (id: String, title: String) -> Unit,
    val playMovie: (id: String, title: String, resume: Boolean) -> Unit,
    val playEpisode: (episodeId: String, title: String, resume: Boolean, seriesId: String) -> Unit,
    val playChannel: (channelId: String, title: String, zap: List<Pair<String, String>>) -> Unit,
)

/** Everything a section needs from the shell: the source it is scoped to, whether it is the one showing, and the actions. */
class SectionContext(
    val app: AppController,
    val sourceId: String?,
    val active: Boolean,
    /** Bumped when Back sends the remote up to the nav bar: a landing page starts again from its top. */
    val backToTop: Int,
    val actions: ShellActions,
    /** Names for each source, when posters of more than one should say which they come from; else null. */
    val sourceNames: Map<String, String>?,
    /** Gives the shell the page's own Back: Browse and Guide use it for "Browse all" and the guide grid. */
    val browsing: Browsing,
    /** Bumped each time Search is chosen in the nav bar: the keyboard opens, ready to type. */
    val openKeyboard: Int = 0,
    /** Puts the remote on the open section's tab in the nav bar (Up from a page's top edge). */
    val focusNav: () -> Unit = {},
)

/** Movies, Series and Live open on a landing page of rows; "Browse all" swaps it for the full category list. */
class Browsing(val mode: String?, val set: (String?) -> Unit)

/** A second back press within this long leaves the app. */
private const val EXIT_WINDOW_MS = 2500L

private val SECTIONS = listOf(Section.Home, Section.Live, Section.Movies, Section.Series)

/**
 * The frame every screen plugs into (`App.tsx`): sign-in when signed out, the profile chooser, then the nav bar with its
 * sections. Detail pages and the player cover the shell rather than replace it, so Back returns to the same place.
 */
@Composable
fun Shell(app: AppController, update: UpdateState, content: ShellContent, exit: () -> Unit) {
    if (!app.ready) { Box(Modifier.fillMaxSize().background(Palette.background), contentAlignment = Alignment.Center) { AppText("testcard", 40, Palette.foreground, FontWeight.SemiBold) }; return }
    val status = app.status
    // Signed out (or the session ended): only the sign-in screen makes sense.
    if (status.account != SyncAccount.SignedIn) { SignInScreen(app); return }

    val sources = app.sources
    val pickedSource = app.sourcePick
    // The source every page shows: all of them, or one. One setting for the whole app, kept across launches, and treated as All if that source is later removed.
    val sourceId = pickedSource?.takeIf { id -> sources.any { it.id == id } }
    var picking by remember { mutableStateOf(false) }
    var section by remember { mutableStateOf(Section.Home) }
    var route by remember { mutableStateOf<Route>(Route.Shell) }
    var browsing by remember { mutableStateOf<String?>(null) }
    var backToTop by remember { mutableIntStateOf(0) }
    var searchPing by remember { mutableIntStateOf(0) }
    var exitHint by remember { mutableStateOf(false) }
    var lastBack by remember { mutableStateOf(0L) }
    // "Who's watching?": on launch when there is more than one profile, and from the profile button in the nav bar.
    var choosing by remember { mutableStateOf<String?>(if (app.profiles.size > 1) "launch" else null) }
    val holder = rememberSaveableStateHolder()

    val sourceNames = remember(sourceId, sources) {
        if (sourceId == null && sources.count { it.movies + it.series > 0 } > 1) sources.associate { it.id to it.name } else null
    }

    if (choosing != null) {
        WhoIsWatching(
            app,
            onDone = { choosing = null; route = Route.Shell; section = Section.Home; browsing = null },
            onCancel = if (choosing == "switch") ({ choosing = null }) else null,
            onExit = exit,
        )
        return
    }

    val setup = app.setup
    val settingUp = setup != null && route is Route.Shell
    val covered = route !is Route.Shell || settingUp
    val atRoot = route is Route.Shell && browsing == null

    // Each tab's focus handle, so Back can send focus to it; and whether the nav bar has focus at all.
    val tabFocus = remember { Section.entries.associateWith { FocusRequester() } }
    var navFocused by remember { mutableIntStateOf(0) }
    val onNavFocus = { focused: Boolean -> navFocused = (navFocused + if (focused) 1 else -1).coerceAtLeast(0) }

    // Back on a page goes up to the nav bar, onto the open section's tab, and the page starts again from its top, so the bar is
    // one press away however deep in the rows the viewer is. Back on the nav bar asks twice before leaving.
    BackHandler(enabled = atRoot && !settingUp && !picking) {
        if (navFocused == 0) {
            runCatching { tabFocus.getValue(section).requestFocus() }
            backToTop += 1
        } else if (nowMs() - lastBack < EXIT_WINDOW_MS) exit()
        else { lastBack = nowMs(); exitHint = true }
    }
    // The setup screen has no focusable parts; Back there also asks twice.
    BackHandler(enabled = settingUp) {
        if (nowMs() - lastBack < EXIT_WINDOW_MS) exit() else { lastBack = nowMs(); exitHint = true }
    }
    LaunchedEffect(exitHint) { if (exitHint) { delay(EXIT_WINDOW_MS); exitHint = false } }

    val actions = remember {
        ShellActions(
            openMovie = { id, title -> route = Route.Movie(id, title) },
            openSeries = { id, title -> route = Route.Series(id, title) },
            playMovie = { id, title, resume -> route = Route.Play(PlayItem(PlayKind.Movie, id, title), null, null, resume, Route.Shell) },
            playEpisode = { episodeId, title, resume, seriesId -> route = Route.Play(PlayItem(PlayKind.Episode, episodeId, title), seriesId, null, resume, Route.Shell) },
            playChannel = { id, title, zap -> route = Route.Play(PlayItem(PlayKind.Channel, id, title), null, zap.map { PlayItem(PlayKind.Channel, it.first, it.second) }, false, Route.Shell) },
        )
    }

    Box(Modifier.fillMaxSize().background(Palette.background)) {
        // The shell stays composed under the player and the detail pages, so Back returns to the same scroll position and
        // highlighted poster; it takes no focus while covered.
        Box(Modifier.fillMaxSize().then(if (covered) Modifier.focusProperties { canFocus = false } else Modifier)) {
            Box(Modifier.fillMaxSize()) {
                holder.SaveableStateProvider(section.name) {
                    content.section(section, SectionContext(app, sourceId, !covered, backToTop, actions, sourceNames, Browsing(browsing) { browsing = it }, searchPing, focusNav = { runCatching { tabFocus.getValue(section).requestFocus() } }))
                }
            }
            // The nav bar floats over the page so the Movies and Series art can run behind it.
            Row(Modifier.fillMaxWidth().padding(start = 44.dp, end = 44.dp, top = 28.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.padding(end = 40.dp)) {
                    AppText("test", 30, Palette.foreground, FontWeight.SemiBold, letterSpacing = -0.5f)
                    AppText("card", 30, Palette.accent, FontWeight.SemiBold, letterSpacing = -0.5f)
                }
                val pick = { target: Section -> section = target; browsing = null; if (target == Section.Search) searchPing += 1 }
                NavTab(section == Section.Search, { pick(Section.Search) }, glyph = Glyph.Search, focusRequester = tabFocus.getValue(Section.Search), onFocusChange = onNavFocus)
                for (entry in SECTIONS) NavTab(section == entry, { pick(entry) }, label = entry.label, focusRequester = tabFocus.getValue(entry), onFocusChange = onNavFocus)
                if (app.syncing) AppText("Syncing…", 22, Palette.faint, modifier = Modifier.padding(start = 16.dp))
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                    if (sources.size > 1 && section != Section.Settings) {
                        NavTab(picking, { picking = true }, label = sources.firstOrNull { it.id == sourceId }?.name ?: "All sources", chip = true, trailing = Glyph.ArrowDown, onFocusChange = onNavFocus)
                    }
                    if (app.profiles.size > 1) NavTab(false, { choosing = "switch" }, icon = { AvatarDisc(app.profile, 46.dp) }, onFocusChange = onNavFocus)
                    NavTab(section == Section.Settings, { pick(Section.Settings) }, glyph = Glyph.Settings, badge = update.available, focusRequester = tabFocus.getValue(Section.Settings), onFocusChange = onNavFocus)
                }
            }
            if (picking) {
                SourcePicker(sources.map { it.id to it.name }, sourceId, { app.pickSource(it); picking = false }, { picking = false })
            }
            // A new version is offered over the pages, never over the player or while a source loads.
            if (!covered) content.updatePrompt()
            if (exitHint && !settingUp) Toast("Press back again to exit", Modifier.align(Alignment.BottomCenter))
        }
        when (val current = route) {
            Route.Shell -> {}
            // A group of its own, so the remote only moves between the page on top: the shell under it is composed too, and without this
            // Down from the page picks the nearest control of the shell behind it, which cannot be seen.
            is Route.Movie, is Route.Series, is Route.Play -> Box(Modifier.fillMaxSize().trapFocus()) { content.overlay(current, actions, { route = it }, app) }
        }
        // First sync or a refresh: the shell stays composed but covered, so there is nothing to navigate to until it finishes.
        if (settingUp && setup != null) SetupOverlay(setup, if (exitHint) "Press back again to exit" else null)
    }
}

/** What the update check says (see the updater in Phase 15): only whether to badge the settings tab. */
class UpdateState(val available: Boolean)

/** The parts of the shell that other packages provide, so the shell does not depend on every screen. */
class ShellContent(
    val section: @Composable (Section, SectionContext) -> Unit,
    val overlay: @Composable (Route, ShellActions, (Route) -> Unit, AppController) -> Unit,
    val updatePrompt: @Composable () -> Unit,
)
