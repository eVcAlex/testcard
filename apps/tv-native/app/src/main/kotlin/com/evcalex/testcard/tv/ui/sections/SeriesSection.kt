package com.evcalex.testcard.tv.ui.sections

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import com.evcalex.testcard.core.db.CategoryKind
import com.evcalex.testcard.core.db.SeriesRow
import com.evcalex.testcard.core.db.browseSeries
import com.evcalex.testcard.core.db.getUpNextEpisodes
import com.evcalex.testcard.core.db.listFavouriteSeries
import com.evcalex.testcard.core.db.listRecentSeries
import com.evcalex.testcard.core.db.listSeriesCategories
import com.evcalex.testcard.core.db.removeSeriesFromRecents
import com.evcalex.testcard.core.db.toggleSeriesFavourite
import com.evcalex.testcard.core.normalise.dedupeTitles
import com.evcalex.testcard.tv.ui.browse.BrowseItem
import com.evcalex.testcard.tv.ui.browse.BrowseScreen
import com.evcalex.testcard.tv.ui.browse.BrowseSource
import com.evcalex.testcard.tv.ui.browse.Special
import com.evcalex.testcard.tv.ui.components.ActionGlyph
import com.evcalex.testcard.tv.ui.components.DetailAction
import com.evcalex.testcard.tv.ui.home.HeroActions
import com.evcalex.testcard.tv.ui.home.HomeRow
import com.evcalex.testcard.tv.ui.home.HomeScreen
import com.evcalex.testcard.tv.ui.home.continuingSeries
import com.evcalex.testcard.tv.ui.home.homeSeries
import com.evcalex.testcard.tv.ui.home.seriesShelvesFor
import com.evcalex.testcard.tv.ui.home.shelfRow
import com.evcalex.testcard.tv.ui.shell.SectionContext
import kotlinx.coroutines.launch

internal fun seriesItem(series: SeriesRow) = BrowseItem(series.id, series.name, series.posterUrl)

@Composable
fun SeriesSection(ctx: SectionContext) {
    val app = ctx.app
    val sourceId = ctx.sourceId
    val mode = ctx.browsing.mode
    val version = versionWhileShown(ctx)
    val tick = refreshOnShow(ctx.active)
    BackTo(mode != null) { ctx.browsing.set(null) }
    val rows = rememberRows<List<HomeRow>>(app, "series|${sourceId ?: ""}", version, app.catalogue, sourceId, tick.intValue) {
        val shelves = app.memoByCatalogue("series-home", sourceId) { it.seriesShelvesFor(sourceId) }
        val shelfRows = shelves.map { shelfRow(it, ::homeSeries) }
        app.db.read { c ->
            fun own(show: SeriesRow) = sourceId == null || show.sourceId == sourceId
            val recent = c.listRecentSeries(60).filter(::own).take(20)
            val myList = c.listFavouriteSeries().filter(::own)
            val upNext = c.getUpNextEpisodes(recent.map { it.id })
            buildList {
                if (recent.isNotEmpty()) add(HomeRow("recent-watched", "Recently watched", recent.map { continuingSeries(it, upNext[it.id]) }))
                if (myList.isNotEmpty()) add(HomeRow("my-list", "My list", myList.take(30).map(::homeSeries)))
                addAll(shelfRows)
            }
        }
    }
    if (mode == BROWSE || (rows != null && rows.isEmpty())) { SeriesBrowse(ctx, tick.intValue); return }
    if (rows == null) { Loading(); return }
    val actions = ctx.actions
    val recentIds = remember(rows) { rows.firstOrNull { it.key == "recent-watched" }?.items?.map { it.id }?.toSet() ?: emptySet() }
    HomeScreen(
        rows = rows,
        heroActions = { item, _ ->
            HeroActions(
                seriesPrimaryAction(app, item, actions.openSeries, actions.playEpisode),
                buildList {
                    add(DetailAction("info", "View episodes", ActionGlyph.Info) { actions.openSeries(item.id, item.name) })
                    add(DetailAction("list", if (item.favourite) "Remove from My list" else "Add to My list", if (item.favourite) ActionGlyph.Check else ActionGlyph.Plus) {
                        app.scope.launch { app.db.write { it.toggleSeriesFavourite(item.id) }; app.sync.notifyLocalChange(); tick.intValue++ }
                    })
                    if (item.id in recentIds) add(DetailAction("forget", "Remove from Recently watched", ActionGlyph.Cross) {
                        app.scope.launch { app.db.write { it.removeSeriesFromRecents(item.id) }; app.sync.notifyLocalChange(); tick.intValue++ }
                    })
                },
            )
        },
        onSelect = { actions.openSeries(it.id, it.name) },
        backToTop = ctx.backToTop,
        browseAll = { ctx.browsing.set(BROWSE) },
    )
}

/** Every category, with my list first. Selecting a poster opens its episodes. */
@Composable
internal fun SeriesBrowse(ctx: SectionContext, tick: Int) {
    val app = ctx.app
    val sourceId = ctx.sourceId
    val source by produceState<BrowseSource?>(null, app.version, app.catalogue, sourceId, tick) {
        val categories = app.memoByCatalogue("series-categories", sourceId) { it.listSeriesCategories(sourceId).browsable() }
        value = app.db.read { c ->
            val myList = c.listFavouriteSeries().filter { sourceId == null || it.sourceId == sourceId }
            fun once(rows: List<SeriesRow>, limit: Int) = dedupeTitles(rows, { it.name }, limit, undated = true)
            BrowseSource(
                layout = "poster", noun = "series", single = "series",
                pinning = c.pinningFor(app, CategoryKind.Series) { app.bump() },
                specials = listOf(
                    Special("my-list", "My list", myList.size),
                    Special("all", "All series", categories.sumOf { it.count }),
                ),
                categories = categories,
                load = { selection, limit ->
                    when (selection.kind) {
                        "category" -> once(app.db.read { it.browseSeries(categoryId = selection.key, limit = limit * 2, sourceId = sourceId) }, limit)
                        "genre" -> once(app.db.read { it.browseSeries(genre = selection.key, limit = limit * 2, sourceId = sourceId) }, limit)
                        else -> if (selection.key == "my-list") myList.take(limit) else once(app.db.read { it.browseSeries(limit = limit * 2, sourceId = sourceId) }, limit)
                    }.map(::seriesItem)
                },
            )
        }
    }
    val current = source ?: return Padded {}
    Padded { BrowseScreen(current, if (sourceId != null) NOTHING_FROM_SOURCE else SIGN_IN_FIRST) { item, _ -> ctx.actions.openSeries(item.id, item.title) } }
}
