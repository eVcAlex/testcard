package com.evcalex.testcard.tv.ui.sections

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableIntState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.CategoryKind
import com.evcalex.testcard.core.db.CategoryRow
import com.evcalex.testcard.core.db.getMovieById
import com.evcalex.testcard.core.db.getMoviePlaybackTarget
import com.evcalex.testcard.core.db.getUpNextEpisode
import com.evcalex.testcard.core.db.hideCategory
import com.evcalex.testcard.core.db.hideChannel
import com.evcalex.testcard.core.db.listFavouriteChannels
import com.evcalex.testcard.core.db.moveFavourite
import com.evcalex.testcard.core.importing.ensureMovieDetails
import com.evcalex.testcard.core.normalise.displayName
import com.evcalex.testcard.core.sync.pinCategory
import com.evcalex.testcard.core.sync.pinnedCategoryIds
import com.evcalex.testcard.core.sync.unpinCategory
import com.evcalex.testcard.core.text.episodeTitle
import com.evcalex.testcard.core.text.seriesTitle
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.ui.browse.BrowseCategory
import com.evcalex.testcard.tv.ui.browse.Pinning
import com.evcalex.testcard.tv.ui.components.ActionGlyph
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.DetailAction
import com.evcalex.testcard.tv.ui.components.HomeSkeleton
import com.evcalex.testcard.tv.ui.components.PrimaryAction
import com.evcalex.testcard.tv.ui.home.HomeDetail
import com.evcalex.testcard.tv.ui.home.HomeItem
import com.evcalex.testcard.tv.ui.home.progressOf
import com.evcalex.testcard.tv.ui.shell.SectionContext
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.launch

/**
 * The remembered rows straight away when there are some, otherwise null until they have been built. `keys` change when the
 * data does; when they do, the old rows stay up while the new ones are built (blanking the page would flash a loading screen
 * and throw the viewer back to the top).
 */
@Composable
fun <T : Any> rememberRows(app: AppController, cacheKey: String, vararg keys: Any?, build: suspend () -> T): T? {
    @Suppress("UNCHECKED_CAST")
    val initial = app.rowsCache[cacheKey] as T?
    val state = produceState(initial, *keys) {
        val built = build()
        app.rowsCache[cacheKey] = built
        value = built
    }
    return state.value
}

/** The category browser and empty states sit under the nav bar, which floats over the landing page's art. */
@Composable
fun Padded(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().padding(horizontal = 44.dp).padding(top = 112.dp)) { content() }
}

@Composable
fun Loading() = HomeSkeleton()

@Composable
fun EmptyNote(text: String) {
    Box(Modifier.fillMaxSize().padding(horizontal = 200.dp), contentAlignment = Alignment.Center) { AppText(text, 22, Palette.muted, align = androidx.compose.ui.text.style.TextAlign.Center) }
}

/** Back from the category browser returns to the landing page instead of leaving the section. */
@Composable
fun BackTo(enabled: Boolean, back: () -> Unit) = BackHandler(enabled = enabled, onBack = back)

/** Category tags that are dividers or decoration rather than something to browse (adult ones stay out of the way too). */
fun hiddenTags(tags: String) = tags.split(" ").any { it == "junk" || it == "separator" || it == "adult" }

/** What a category browser needs to offer "Pin to Home" and "Hide" for one kind of content. Every change is synced. */
fun SQLiteConnection.pinningFor(app: AppController, kind: CategoryKind, changed: () -> Unit) = Pinning(
    pinned = pinnedCategoryIds(kind),
    toggle = { id, label ->
        app.scope.launch {
            app.db.write { c -> if (id in c.pinnedCategoryIds(kind)) c.unpinCategory(kind, id) else c.pinCategory(kind, id, label) }
            app.sync.notifyLocalChange()
        }
    },
    hide = { id, label ->
        app.scope.launch {
            app.db.write { c ->
                if (id in c.pinnedCategoryIds(kind)) c.unpinCategory(kind, id)
                c.hideCategory(kind, id, label)
            }
            app.sync.notifyLocalChange()
            changed()
        }
    },
)


/** The plot and length a film's list did not carry (films only get them from the provider one at a time). */
suspend fun movieDetail(app: AppController, id: String): HomeDetail? {
    val target = app.db.read { it.getMoviePlaybackTarget(id) } ?: return null
    if (target.source.kind != "xtream") return null
    ensureMovieDetails(app.db, app.api(target.source.id), id)
    val movie = app.db.read { it.getMovieById(id) } ?: return null
    return HomeDetail(movie.plot, movie.durationSecs)
}

/**
 * A series row's primary action: resume or play the episode you were on, falling back to "View episodes" for a series nothing
 * has been watched of yet. Shared by every screen with a series row so pressing one actually starts playing.
 */
suspend fun seriesPrimaryAction(app: AppController, item: HomeItem, onOpenSeries: (String, String) -> Unit, onPlayEpisode: (String, String, Boolean, String) -> Unit): PrimaryAction {
    val upNext = app.db.read { it.getUpNextEpisode(item.id) } ?: return PrimaryAction("View episodes", { onOpenSeries(item.id, item.name) })
    val episode = upNext.episode
    return PrimaryAction(
        if (upNext.resume) "Resume" else "Play",
        { onPlayEpisode(episode.id, "${seriesTitle(item.name)} · ${episodeTitle(episode.name)}", upNext.resume, item.id) },
        if (upNext.resume) progressOf(episode.positionSecs, episode.durationSecs) else null,
    )
}

/**
 * What a channel's card offers beyond playing and favouriting: moving it along the Favourites row (from that row), and hiding
 * it. The order is this TV's own, as favourite channels are; hiding is synced.
 */
suspend fun channelExtras(app: AppController, channelId: String, name: String, inFavouritesRow: Boolean, changed: () -> Unit): List<DetailAction> {
    val actions = ArrayList<DetailAction>()
    if (inFavouritesRow) {
        val order = app.db.read { c -> c.listFavouriteChannels().map { it.id } }
        val at = order.indexOf(channelId)
        if (at > 0) actions += DetailAction("earlier", "Move earlier in Favourites", ActionGlyph.Earlier) { app.scope.launch { if (app.db.write { it.moveFavourite(channelId, -1) }) { app.sync.notifyLocalChange(); changed() } } }
        if (at >= 0 && at < order.size - 1) actions += DetailAction("later", "Move later in Favourites", ActionGlyph.Later) { app.scope.launch { if (app.db.write { it.moveFavourite(channelId, 1) }) { app.sync.notifyLocalChange(); changed() } } }
    }
    actions += DetailAction("hide", "Hide this channel", ActionGlyph.Hide) {
        app.scope.launch {
            if (!app.db.write { it.hideChannel(channelId, name) }) return@launch
            app.sync.notifyLocalChange()
            changed()
        }
    }
    return actions
}

/** A hidden section keeps the data version it last showed with, so a sync does not re-run its queries behind the page on screen. */
@Composable
internal fun versionWhileShown(ctx: SectionContext): Int {
    val held = remember { intArrayOf(ctx.app.version) }
    if (ctx.active) held[0] = ctx.app.version
    return held[0]
}

/** Bumped each time the section is brought back to the front, so what changed elsewhere (watched, pinned, favourited) is read again. */
@Composable
internal fun refreshOnShow(active: Boolean): MutableIntState {
    val tick = remember { mutableIntStateOf(0) }
    val was = remember { booleanArrayOf(active) }
    LaunchedEffect(active) {
        if (active && !was[0]) tick.intValue++
        was[0] = active
    }
    return tick
}

internal fun categoryOf(row: CategoryRow) = BrowseCategory(row.id, displayName(row.name), row.count, row.genre)

internal fun List<CategoryRow>.browsable() = filter { !hiddenTags(it.tags) }.map(::categoryOf)

internal const val BROWSE = "browse"
internal const val NOTHING_FROM_SOURCE = "Nothing from this source. Use the Source button at the top right to switch."
internal const val SIGN_IN_FIRST = "Sign in to the account your computer uses and its sources will load here. Open Sources to see progress."



/** How many categories get a row on the landing page; the rest are one press away under Browse all. */
internal const val CATEGORY_ROWS = 10
internal const val ROW_SIZE = 24
