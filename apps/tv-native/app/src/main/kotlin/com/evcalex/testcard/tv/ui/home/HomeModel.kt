package com.evcalex.testcard.tv.ui.home

import androidx.compose.runtime.Immutable
import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.CategoryKind
import com.evcalex.testcard.core.db.ChannelRow
import com.evcalex.testcard.core.db.HomeOptions
import com.evcalex.testcard.core.db.HomeShelf
import com.evcalex.testcard.core.db.MovieRow
import com.evcalex.testcard.core.db.SeriesRow
import com.evcalex.testcard.core.db.UpNextSummary
import com.evcalex.testcard.core.db.browseChannels
import com.evcalex.testcard.core.db.browseMovies
import com.evcalex.testcard.core.db.browseSeries
import com.evcalex.testcard.core.db.getUpNextEpisodes
import com.evcalex.testcard.core.db.listFavouriteChannels
import com.evcalex.testcard.core.db.listFavouriteMovies
import com.evcalex.testcard.core.db.listFavouriteSeries
import com.evcalex.testcard.core.db.listRecentChannels
import com.evcalex.testcard.core.db.listRecentMovies
import com.evcalex.testcard.core.db.listRecentSeries
import com.evcalex.testcard.core.db.listWatchedLately
import com.evcalex.testcard.core.db.movieHome
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.seriesHome
import com.evcalex.testcard.core.guide.ChannelGuide
import com.evcalex.testcard.core.normalise.displayName
import com.evcalex.testcard.core.shouldPromptResume
import com.evcalex.testcard.core.sync.listHomePins
import com.evcalex.testcard.tv.ui.components.DetailAction
import com.evcalex.testcard.tv.ui.components.PosterItem
import com.evcalex.testcard.tv.ui.components.PrimaryAction
import java.util.Calendar
import java.util.Locale

/** A poster on the landing page, with what the hero shows when the remote rests on it. */
@Immutable
class HomeItem(
    id: String,
    name: String,
    posterUrl: String?,
    progress: Float?,
    watched: Boolean,
    note: String?,
    channelNumber: Int?,
    isChannel: Boolean,
    val rating: String?,
    val plot: String?,
    val durationSecs: Double?,
    val favourite: Boolean,
    /** Started and worth resuming: the hero's button says Resume. */
    val resume: Boolean,
) : PosterItem(id, name, posterUrl, progress, watched, note, channelNumber, isChannel) {
    fun withId(newId: String) = HomeItem(newId, name, posterUrl, progress, watched, note, channelNumber, isChannel, rating, plot, durationSecs, favourite, resume)
    fun withNote(newNote: String?, newProgress: Float? = progress) = HomeItem(id, name, posterUrl, newProgress, watched, newNote, channelNumber, isChannel, rating, plot, durationSecs, favourite, resume)
}

@Immutable
class HomeRow(
    val key: String,
    val label: String,
    val items: List<HomeItem>,
    /** Draw big rank numbers beside the posters (a top 10). */
    val ranked: Boolean = false,
    /** Landscape logo cards instead of posters (Live TV). */
    val channels: Boolean = false,
    /** A category the viewer pinned to Home: the row says so. */
    val pinned: Boolean = false,
)

/** What can be done with a title: OK on its card does `onSelect`; holding OK lists these. */
class HeroActions(val primary: PrimaryAction, val actions: List<DetailAction>)

/** What the provider only tells us when asked about one title. */
class HomeDetail(val plot: String?, val durationSecs: Double?, /** A channel's guide; null (with [hasGuide]) when it has none at all. */ val guide: ChannelGuide? = null, val isGuide: Boolean = false)

/** "1h 36m" / "42m". */
fun runtimeLabel(secs: Double): String {
    val minutes = Math.round(secs / 60).toInt()
    return if (minutes >= 60) "${minutes / 60}h ${minutes % 60}m" else "${minutes}m"
}

/** How far through, 0 to 1, or null when either is unknown. */
fun progressOf(position: Double?, duration: Double?): Float? = if (position != null && duration != null && duration > 0) (position / duration).toFloat() else null

fun homeMovie(movie: MovieRow) = HomeItem(
    movie.id, movie.name, movie.posterUrl, progressOf(movie.positionSecs, movie.durationSecs), movie.watched, null, null, false,
    movie.rating, movie.plot, movie.durationSecs, movie.isFavourite, movie.positionSecs?.let { shouldPromptResume(it, movie.durationSecs) } == true,
)

/** A film on a Continue watching row: how long it has left under the title. */
fun continuingMovie(movie: MovieRow): HomeItem {
    val item = homeMovie(movie)
    val position = movie.positionSecs
    val duration = movie.durationSecs
    val left = if (position != null && duration != null) duration - position else 0.0
    return if (left >= 60) item.withNote("${runtimeLabel(left)} left") else item
}

fun homeSeries(series: SeriesRow) = HomeItem(series.id, series.name, series.posterUrl, null, false, null, null, false, series.rating, series.plot, null, series.isFavourite, false)

/** A show on a Continue watching or Recently watched row: the episode it carries on from, and how far into it. */
fun continuingSeries(series: SeriesRow, upNext: UpNextSummary?): HomeItem {
    val item = homeSeries(series)
    if (upNext == null) return item
    val where = "S${upNext.seasonNumber} E${upNext.episodeNumber}"
    val into = if (upNext.resume) progressOf(upNext.positionSecs, upNext.durationSecs) else null
    return item.withNote(if (upNext.resume) where else "Next · $where", into)
}

fun toHomeItem(channel: ChannelRow) = HomeItem(
    channel.id, channel.normalisedName, channel.logoUrl, null, false, null, channel.channelNumber, true,
    null, null, null, channel.isFavourite, false,
)

/** A landing row from a built shelf. The top shelf becomes a numbered top 10. */
fun <T> shelfRow(shelf: HomeShelf<T>, toItem: (T) -> HomeItem): HomeRow =
    if (shelf.key == "top") HomeRow(shelf.key, shelf.label, shelf.items.take(10).map(toItem), ranked = true)
    else HomeRow(shelf.key, shelf.label, shelf.items.map(toItem))

/** The device's language ("en"), so the landing page leans towards titles the viewer can follow. */
private val deviceLanguage: String? = Locale.getDefault().language.lowercase(Locale.ROOT).ifEmpty { null }

fun homeOptions(sourceId: String?) = HomeOptions(sourceId = sourceId, language = deviceLanguage, year = Calendar.getInstance().get(Calendar.YEAR))

/** Where a pinned category's own name is kept, by the kind of pin. */
private fun pinTable(kind: CategoryKind) = kind.table

/** What the Home tab draws (`Start.tsx`): where you left off and what is new, across Movies, Series and Live TV. */
class StartRows(val rows: List<HomeRow>, val recentChannelIds: Set<String>)

private const val TAG_SEPARATOR = "|"

/** Movies, series and channels share one page, and their ids are only unique within their own kind, so each is tagged with its kind here. */
fun tag(kind: String, item: HomeItem) = item.withId("$kind$TAG_SEPARATOR${item.id}")

class Tagged(val kind: String, val id: String)

fun untag(tagged: String): Tagged {
    val at = tagged.indexOf(TAG_SEPARATOR)
    return Tagged(tagged.substring(0, at), tagged.substring(at + 1))
}

fun SQLiteConnection.buildStartRows(sourceId: String?, movieShelves: List<HomeShelf<MovieRow>>, seriesShelves: List<HomeShelf<SeriesRow>>): StartRows {
    fun asMovie(movie: MovieRow) = tag("movie", homeMovie(movie))
    fun asSeries(series: SeriesRow) = tag("series", homeSeries(series))
    fun own(rowSource: String) = sourceId == null || rowSource == sourceId
    // One row for what you were last watching, films and shows together, the most recent first: films only while unfinished.
    val recentMovies = listRecentMovies(60).filter { own(it.sourceId) }.associateBy { it.id }
    val recentSeries = listRecentSeries(60).filter { own(it.sourceId) }.associateBy { it.id }
    val continuing = ArrayList<HomeItem>()
    val lately = listWatchedLately(60)
    val upNext = getUpNextEpisodes(lately.filter { it.kind != "movie" && it.id in recentSeries }.map { it.id })
    for (entry in lately) {
        if (entry.kind == "movie") {
            val movie = recentMovies[entry.id]
            if (movie != null && movie.isContinuing()) continuing += tag("movie", continuingMovie(movie))
        } else {
            val show = recentSeries[entry.id]
            if (show != null) continuing += tag("series", continuingSeries(show, upNext[show.id]))
        }
    }
    val recentChannels = listRecentChannels(60).filter { own(it.sourceId) }.take(30)
    val myList = (listFavouriteMovies().filter { own(it.sourceId) }.map(::asMovie) + listFavouriteSeries().filter { own(it.sourceId) }.map(::asSeries)).take(30)
    val favouriteChannels = listFavouriteChannels().filter { own(it.sourceId) }.take(30)
    val list = ArrayList<HomeRow>()
    fun add(key: String, label: String, items: List<HomeItem>, channels: Boolean = false, pinned: Boolean = false) {
        if (items.isNotEmpty()) list += HomeRow(key, label, items, channels = channels, pinned = pinned)
    }
    add("continue", "Continue watching", continuing.take(30))
    add("recent-channels", "Recently watched channels", recentChannels.map { tag("channel", toHomeItem(it)) }, channels = true)
    add("my-list", "My list", myList)
    add("favourite-channels", "Favourite channels", favouriteChannels.map { tag("channel", toHomeItem(it)) }, channels = true)
    // Categories pinned from Browse all, in the order they were pinned. A pin whose category is not here yet (a fresh import) waits.
    for (pin in listHomePins()) {
        val categoryId = pin.categoryId ?: continue
        if (sourceId != null && pin.sourceId != sourceId) continue
        val key = "pin:${pin.sourceId}:${pin.kind}:${pin.key}"
        val kind = CategoryKind.of(pin.kind)
        // Titled from the category as it is now, through the same tidying as everywhere else, not from the label saved when it was pinned.
        val rawName = one("SELECT raw_name FROM ${pinTable(kind)} WHERE id = ?", categoryId) { it.getText(0) }
        val label = if (rawName != null) displayName(rawName) else pin.label
        when (kind) {
            CategoryKind.Live -> add(key, label, browseChannels(categoryId = categoryId, limit = 24).map { tag("channel", toHomeItem(it)) }, channels = true, pinned = true)
            CategoryKind.Movies -> add(key, label, browseMovies(categoryId = categoryId, limit = 30).map(::asMovie), pinned = true)
            CategoryKind.Series -> add(key, label, browseSeries(categoryId = categoryId, limit = 30).map(::asSeries), pinned = true)
        }
    }
    movieShelves.firstOrNull { it.key == "new" }?.let { shelf -> shelfRow(shelf, ::asMovie).let { list += HomeRow("new-movies", "New movies", it.items, it.ranked) } }
    seriesShelves.firstOrNull { it.key == "new" }?.let { shelf -> shelfRow(shelf, ::asSeries).let { list += HomeRow("new-series", "New series", it.items, it.ranked) } }
    movieShelves.firstOrNull { it.key == "top" }?.let { shelf -> shelfRow(shelf, ::asMovie).let { list += HomeRow("top-movies", shelf.label.replace("Top 10 this year", "Top 10 movies this year"), it.items, it.ranked) } }
    return StartRows(list, recentChannels.map { it.id }.toSet())
}

fun SQLiteConnection.movieShelvesFor(sourceId: String?) = movieHome(homeOptions(sourceId))

fun SQLiteConnection.seriesShelvesFor(sourceId: String?) = seriesHome(homeOptions(sourceId))


/** Started, not finished, and worth resuming. */
fun MovieRow.isContinuing(): Boolean { val position = positionSecs ?: return false; return !watched && shouldPromptResume(position, durationSecs) }
