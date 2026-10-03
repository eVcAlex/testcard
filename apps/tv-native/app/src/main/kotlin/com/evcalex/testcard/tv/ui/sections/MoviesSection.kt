package com.evcalex.testcard.tv.ui.sections

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import com.evcalex.testcard.core.db.CategoryKind
import com.evcalex.testcard.core.db.MovieRow
import com.evcalex.testcard.core.db.browseMovies
import com.evcalex.testcard.core.db.listFavouriteMovies
import com.evcalex.testcard.core.db.listMovieCategories
import com.evcalex.testcard.core.db.listRecentMovies
import com.evcalex.testcard.core.db.toggleMovieFavourite
import com.evcalex.testcard.core.normalise.dedupeTitles
import com.evcalex.testcard.core.shouldPromptResume
import com.evcalex.testcard.tv.ui.browse.BrowseItem
import com.evcalex.testcard.tv.ui.browse.BrowseScreen
import com.evcalex.testcard.tv.ui.browse.BrowseSource
import com.evcalex.testcard.tv.ui.browse.Special
import com.evcalex.testcard.tv.ui.components.ActionGlyph
import com.evcalex.testcard.tv.ui.components.DetailAction
import com.evcalex.testcard.tv.ui.components.PrimaryAction
import com.evcalex.testcard.tv.ui.home.HeroActions
import com.evcalex.testcard.tv.ui.home.HomeRow
import com.evcalex.testcard.tv.ui.home.HomeScreen
import com.evcalex.testcard.tv.ui.home.continuingMovie
import com.evcalex.testcard.tv.ui.home.homeMovie
import com.evcalex.testcard.tv.ui.home.isContinuing
import com.evcalex.testcard.tv.ui.home.progressOf
import com.evcalex.testcard.tv.ui.home.movieShelvesFor
import com.evcalex.testcard.tv.ui.home.shelfRow
import com.evcalex.testcard.tv.ui.shell.SectionContext
import kotlinx.coroutines.launch

internal fun movieItem(movie: MovieRow) = BrowseItem(
    movie.id, movie.name, movie.posterUrl,
    progress = progressOf(movie.positionSecs, movie.durationSecs),
    resume = movie.positionSecs?.let { shouldPromptResume(it, movie.durationSecs) } == true,
    watched = movie.watched,
)

@Composable
fun MoviesSection(ctx: SectionContext) {
    val app = ctx.app
    val sourceId = ctx.sourceId
    val mode = ctx.browsing.mode
    val version = versionWhileShown(ctx)
    val tick = refreshOnShow(ctx.active)
    BackTo(mode != null) { ctx.browsing.set(null) }
    val rows = rememberRows<List<HomeRow>>(app, "movies|${sourceId ?: ""}", version, app.catalogue, sourceId, tick.intValue) {
        val shelves = app.memoByCatalogue("movies-home", sourceId) { it.movieShelvesFor(sourceId) }
        val shelfRows = shelves.map { shelfRow(it, ::homeMovie) }
        app.db.read { c ->
            fun own(movie: MovieRow) = sourceId == null || movie.sourceId == sourceId
            val continuing = c.listRecentMovies(60).filter { own(it) && it.isContinuing() }
            val myList = c.listFavouriteMovies().filter(::own)
            buildList {
                if (continuing.isNotEmpty()) add(HomeRow("continue", "Continue watching", continuing.map(::continuingMovie)))
                if (myList.isNotEmpty()) add(HomeRow("my-list", "My list", myList.take(30).map(::homeMovie)))
                addAll(shelfRows)
            }
        }
    }
    if (mode == BROWSE || (rows != null && rows.isEmpty())) { MoviesBrowse(ctx, tick.intValue); return }
    if (rows == null) { Loading(); return }
    val actions = ctx.actions
    HomeScreen(
        rows = rows,
        heroActions = { item, _ ->
            HeroActions(
                PrimaryAction(if (item.resume) "Resume" else "Play", { actions.playMovie(item.id, item.name, item.resume) }, if (item.resume) item.progress else null),
                listOf(
                    DetailAction("info", "More info", ActionGlyph.Info) { actions.openMovie(item.id, item.name) },
                    DetailAction("list", if (item.favourite) "Remove from My list" else "Add to My list", if (item.favourite) ActionGlyph.Check else ActionGlyph.Plus) {
                        app.scope.launch { app.db.write { it.toggleMovieFavourite(item.id) }; app.sync.notifyLocalChange(); tick.intValue++ }
                    },
                ),
            )
        },
        onSelect = { actions.openMovie(it.id, it.name) },
        backToTop = ctx.backToTop,
        fetchDetail = { id -> movieDetail(app, id) },
        browseAll = { ctx.browsing.set(BROWSE) },
    )
}

/** Every category the provider ships, with continue watching and my list first. */
@Composable
internal fun MoviesBrowse(ctx: SectionContext, tick: Int) {
    val app = ctx.app
    val sourceId = ctx.sourceId
    val source by produceState<BrowseSource?>(null, app.version, app.catalogue, sourceId, tick) {
        val categories = app.memoByCatalogue("movie-categories", sourceId) { it.listMovieCategories(sourceId).browsable() }
        value = app.db.read { c ->
            fun own(movie: MovieRow) = sourceId == null || movie.sourceId == sourceId
            val history = c.listRecentMovies(60).filter(::own)
            val continuing = history.filter { it.isContinuing() }
            val myList = c.listFavouriteMovies().filter(::own)
            // A title the provider files twice (another quality, a "TOP" list) shows once; the film's page offers the others.
            fun once(rows: List<MovieRow>, limit: Int) = dedupeTitles(rows, { it.name }, limit)
            BrowseSource(
                layout = "poster", noun = "movies", single = "movie",
                pinning = c.pinningFor(app, CategoryKind.Movies) { app.bump() },
                specials = listOf(
                    Special("continue", "Continue watching", continuing.size),
                    Special("my-list", "My list", myList.size),
                    Special("all", "All movies", categories.sumOf { it.count }),
                ),
                categories = categories,
                load = { selection, limit ->
                    when (selection.kind) {
                        "category" -> once(app.db.read { it.browseMovies(categoryId = selection.key, limit = limit * 2, sourceId = sourceId) }, limit)
                        "genre" -> once(app.db.read { it.browseMovies(genre = selection.key, limit = limit * 2, sourceId = sourceId) }, limit)
                        else -> when (selection.key) {
                            "continue" -> continuing
                            "my-list" -> myList.take(limit)
                            else -> once(app.db.read { it.browseMovies(limit = limit * 2, sourceId = sourceId) }, limit)
                        }
                    }.map(::movieItem)
                },
            )
        }
    }
    val current = source ?: return Padded {}
    Padded { BrowseScreen(current, if (sourceId != null) NOTHING_FROM_SOURCE else SIGN_IN_FIRST) { item, _ -> ctx.actions.openMovie(item.id, item.title) } }
}
