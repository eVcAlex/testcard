package com.evcalex.testcard.tv.ui.sections

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import com.evcalex.testcard.core.db.CategoryKind
import com.evcalex.testcard.core.db.removeChannelFromRecents
import com.evcalex.testcard.core.db.removeMovieFromHistory
import com.evcalex.testcard.core.db.removeSeriesFromRecents
import com.evcalex.testcard.core.db.toggleFavourite
import com.evcalex.testcard.core.db.toggleMovieFavourite
import com.evcalex.testcard.core.db.toggleSeriesFavourite
import com.evcalex.testcard.core.sync.listHomePins
import com.evcalex.testcard.core.sync.unpinCategory
import com.evcalex.testcard.tv.ui.components.ActionGlyph
import com.evcalex.testcard.tv.ui.components.DetailAction
import com.evcalex.testcard.tv.ui.components.PosterItem
import com.evcalex.testcard.tv.ui.components.PrimaryAction
import com.evcalex.testcard.tv.ui.home.HeroActions
import com.evcalex.testcard.tv.ui.home.HomeDetail
import com.evcalex.testcard.tv.ui.home.HomeItem
import com.evcalex.testcard.tv.ui.home.HomeScreen
import com.evcalex.testcard.tv.ui.home.StartRows
import com.evcalex.testcard.tv.ui.home.buildStartRows
import com.evcalex.testcard.tv.ui.home.movieShelvesFor
import com.evcalex.testcard.tv.ui.home.seriesShelvesFor
import com.evcalex.testcard.tv.ui.home.tag
import com.evcalex.testcard.tv.ui.home.untag
import com.evcalex.testcard.tv.ui.shell.SectionContext
import kotlinx.coroutines.launch

@Composable
fun StartSection(ctx: SectionContext) {
    val app = ctx.app
    val sourceId = ctx.sourceId
    val version = versionWhileShown(ctx)
    val tick = refreshOnShow(ctx.active)
    val built = rememberRows(app, "start|${sourceId ?: ""}", version, app.catalogue, sourceId, tick.intValue) {
        val movies = app.memoByCatalogue("movies-home", sourceId) { it.movieShelvesFor(sourceId) }
        val series = app.memoByCatalogue("series-home", sourceId) { it.seriesShelvesFor(sourceId) }
        app.db.read { it.buildStartRows(sourceId, movies, series) }
    }
    if (built == null) { Loading(); return }
    if (built.rows.isEmpty()) { EmptyNote("Nothing here yet. Sign in to the account your computer uses and its sources will load. Open Sources to see progress."); return }
    StartPage(ctx, built) { tick.intValue += 1 }
}

@Composable
internal fun StartPage(ctx: SectionContext, built: StartRows, refresh: () -> Unit) {
    val app = ctx.app
    val actions = ctx.actions
    val rows = built.rows
    val changed = { app.sync.notifyLocalChange(); refresh() }

    fun play(item: PosterItem) {
        val id = untag(item.id).id
        val row = rows.firstOrNull { r -> r.items.any { it.id == item.id } }
        val stepping = (row?.items ?: listOf(item)).map { untag(it.id).id to it.name }
        actions.playChannel(id, item.name, stepping)
    }

    val heroActions: suspend (HomeItem, String) -> HeroActions = { item, rowKey ->
        val (kind, id) = untag(item.id).let { it.kind to it.id }
        val listLabel = { if (item.favourite) "Remove from My list" else "Add to My list" }
        val listGlyph = if (item.favourite) ActionGlyph.Check else ActionGlyph.Plus
        val base = when (kind) {
            "movie" -> HeroActions(
                PrimaryAction(if (item.resume) "Resume" else "Play", { actions.playMovie(id, item.name, item.resume) }, if (item.resume) item.progress else null),
                listOf(
                    DetailAction("info", "More info", ActionGlyph.Info) { actions.openMovie(id, item.name) },
                    DetailAction("list", listLabel(), listGlyph) { app.scope.launch { app.db.write { it.toggleMovieFavourite(id) }; changed() } },
                ),
            )
            "series" -> HeroActions(
                // Looked up by the provider's own id, so the tag comes off first.
                seriesPrimaryAction(app, item.withId(id), actions.openSeries, actions.playEpisode),
                listOf(
                    DetailAction("info", "View episodes", ActionGlyph.Info) { actions.openSeries(id, item.name) },
                    DetailAction("list", listLabel(), listGlyph) { app.scope.launch { app.db.write { it.toggleSeriesFavourite(id) }; changed() } },
                ),
            )
            else -> HeroActions(
                PrimaryAction("Watch live", { play(item) }),
                buildList {
                    add(DetailAction("favourite", if (item.favourite) "Remove from Favourites" else "Add to Favourites", listGlyph) { app.scope.launch { app.db.write { it.toggleFavourite(id) }; changed() } })
                    if (id in built.recentChannelIds) add(DetailAction("forget", "Remove from Recently watched", ActionGlyph.Cross) { app.scope.launch { app.db.write { it.removeChannelFromRecents(id) }; refresh() } })
                },
            )
        }
        val extra = ArrayList<DetailAction>()
        if (rowKey == "continue" && kind != "channel") {
            extra += DetailAction("forget-continue", "Remove from Continue watching", ActionGlyph.Cross) {
                app.scope.launch { app.db.write { if (kind == "movie") it.removeMovieFromHistory(id) else it.removeSeriesFromRecents(id) }; changed() }
            }
        }
        if (kind == "channel") extra += channelExtras(app, id, item.name, rowKey == "favourite-channels", refresh)
        if (rowKey.startsWith("pin:")) {
            val pin = app.db.read { c -> c.listHomePins().firstOrNull { "pin:${it.sourceId}:${it.kind}:${it.key}" == rowKey } }
            val categoryId = pin?.categoryId
            if (pin != null && categoryId != null) {
                extra += DetailAction("unpin", "Remove this row from Home", ActionGlyph.Cross) {
                    app.scope.launch { app.db.write { it.unpinCategory(com.evcalex.testcard.core.db.CategoryKind.of(pin.kind), categoryId) }; changed() }
                }
            }
        }
        if (extra.isEmpty()) base else HeroActions(base.primary, base.actions + extra)
    }

    val fetchDetail: suspend (String) -> HomeDetail? = { tagged ->
        val (kind, id) = untag(tagged).let { it.kind to it.id }
        when (kind) {
            "movie" -> movieDetail(app, id)
            // Shown as a now/next block under the title; null (no guide) is kept too, so the hero can say so.
            "channel" -> HomeDetail(null, null, app.guides.fetchGuide(id), isGuide = true)
            else -> null
        }
    }

    HomeScreen(
        rows = rows,
        heroActions = heroActions,
        onSelect = { item ->
            val (kind, id) = untag(item.id).let { it.kind to it.id }
            when (kind) {
                "movie" -> actions.openMovie(id, item.name)
                "series" -> actions.openSeries(id, item.name)
                else -> play(item)
            }
        },
        backToTop = ctx.backToTop,
        fetchDetail = fetchDetail,
    )
}
