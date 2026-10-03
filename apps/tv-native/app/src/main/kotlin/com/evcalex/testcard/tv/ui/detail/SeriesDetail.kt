package com.evcalex.testcard.tv.ui.detail

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.db.EpisodeRow
import com.evcalex.testcard.core.db.SeasonWithEpisodes
import com.evcalex.testcard.core.db.SeriesDetail
import com.evcalex.testcard.core.db.SeriesRow
import com.evcalex.testcard.core.db.getSeriesDetail
import com.evcalex.testcard.core.db.getSeriesSource
import com.evcalex.testcard.core.db.listSeriesVersions
import com.evcalex.testcard.core.db.removeSeriesFromRecents
import com.evcalex.testcard.core.db.setWatched
import com.evcalex.testcard.core.db.toggleSeriesFavourite
import com.evcalex.testcard.core.db.upNextIn
import com.evcalex.testcard.core.db.withBorrowedSeasons
import com.evcalex.testcard.core.importing.ensureSeriesEpisodes
import com.evcalex.testcard.core.normalise.splitTitle
import com.evcalex.testcard.core.sync.unreachable
import com.evcalex.testcard.core.text.episodeTitle
import com.evcalex.testcard.core.text.plainReason
import com.evcalex.testcard.core.text.seriesTitle
import com.evcalex.testcard.core.text.serverGone
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.ui.components.ActionGlyph
import com.evcalex.testcard.tv.ui.components.AppButton
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.ArtImage
import com.evcalex.testcard.tv.ui.components.BackArrow
import com.evcalex.testcard.tv.ui.components.Backdrop
import com.evcalex.testcard.tv.ui.components.DetailAction
import com.evcalex.testcard.tv.ui.components.DetailActions
import com.evcalex.testcard.tv.ui.components.Facts
import com.evcalex.testcard.tv.ui.components.OptionsSheet
import com.evcalex.testcard.tv.ui.components.Pill
import com.evcalex.testcard.tv.ui.components.PrimaryAction
import com.evcalex.testcard.tv.ui.components.SheetOption
import com.evcalex.testcard.tv.ui.home.progressOf
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext



/** How many other copies of a series are asked for the seasons this one is missing. */
internal const val MAX_DONORS = 3
internal const val GRID_GAP = 28
internal const val MIN_CARD = 340

/** "42m" / "1h 5m" from seconds. */
internal fun episodeRuntime(secs: Double): String {
    val minutes = Math.max(1, Math.round(secs / 60).toInt())
    return if (minutes >= 60) "${minutes / 60}h ${minutes % 60}m" else "${minutes}m"
}

/** Fetches (or re-reads, once a day) a series' episode list from its provider; a no-op for a source with no such API. */
private suspend fun fetchEpisodes(app: AppController, seriesId: String) = withContext(Dispatchers.Default) {
    val source = app.db.read { it.getSeriesSource(seriesId) } ?: return@withContext
    if (source.kind == "xtream") ensureSeriesEpisodes(app.db, app.api(source.id), source.baseUrl ?: "", seriesId)
}

internal class Failure(val text: String, val gone: Boolean)

internal class SeriesState(val detail: SeriesDetail?)

internal class Versions(val rows: List<SeriesRow>, val sourceId: String?)

/** The year, how many seasons and episodes, and the rating, for the Facts row like the other detail pages. */
internal fun factsOf(detail: SeriesDetail?): List<String> {
    if (detail == null) return emptyList()
    val year = splitTitle(detail.series.name).year
    val episodeCount = detail.seasons.sumOf { it.episodes.size }
    val seasons = detail.seasons.size
    return listOfNotNull(
        year?.takeIf { it.isNotEmpty() },
        if (seasons > 0) "$seasons ${if (seasons == 1) "season" else "seasons"}" else null,
        if (episodeCount > 0) "$episodeCount episodes" else null,
        ratingFact(detail.series.rating),
    )
}

/**
 * A series: poster and what you can do with it, seasons across the top, episodes below as a grid of cards. Xtream episode lists
 * are fetched on first open. Holding select on an episode lists what can be done with it (`SeriesDetail.tsx`).
 */
@Composable
fun SeriesDetailScreen(
    app: AppController,
    seriesId: String,
    title: String,
    onPlayEpisode: (episodeId: String, title: String, resume: Boolean) -> Unit,
    onBack: () -> Unit,
    onOpenVersion: (id: String, title: String) -> Unit,
    /** Draws the source's form over the page, to put a moved server address right. Absent where there is none. */
    sourceForm: (@Composable (sourceId: String, onClose: () -> Unit) -> Unit)? = null,
) {
    BackHandler(onBack = onBack)
    var tick by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<Failure?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    val serverTried = remember { booleanArrayOf(false) }
    var editing by remember { mutableStateOf(false) }
    var choosingVersion by remember { mutableStateOf(false) }
    var seasonId by remember { mutableStateOf<String?>(null) }
    var optionsFor by remember { mutableStateOf<Pair<Int, EpisodeRow>?>(null) }
    var donorsIn by remember { mutableIntStateOf(0) }

    // The same series from another source (or in 4K): picked here, and the way round a source that is down.
    val versionState by produceState<Versions?>(null, seriesId) {
        value = app.db.read { Versions(it.listSeriesVersions(seriesId), it.getSeriesSource(seriesId)?.id) }
    }
    val versions = versionState?.rows ?: emptyList()
    val sourceId = versionState?.sourceId

    LaunchedEffect(seriesId, retry) {
        error = null
        loading = true
        try {
            fetchEpisodes(app, seriesId)
        } catch (failure: Exception) {
            if (failure is kotlinx.coroutines.CancellationException) throw failure
            val message = failure.message ?: ""
            // The provider's server not answering: its other addresses are tried once, and the episodes asked for again.
            val source = app.db.read { it.getSeriesSource(seriesId) }
            if (!serverTried[0] && source != null && unreachable(message) && app.servers.hasBackups(source.id)) {
                serverTried[0] = true
                if (withContext(Dispatchers.Default) { runCatching { app.servers.pickServer(source.id) }.getOrDefault(false) }) { retry++; return@LaunchedEffect }
            }
            // A daily re-read that fails leaves the episodes already here on screen, rather than an error over them.
            if ((app.db.read { it.getSeriesDetail(seriesId)?.seasons?.size } ?: 0) == 0) error = Failure("The episodes didn't load. ${plainReason(message)}".trim(), serverGone(message))
        }
        loading = false
    }

    // A season this copy lists empty, or lacks, is filled from another copy of the show: the same quality first, at most a few of
    // them. Their episode lists are fetched once this one's is in, in the background, and kept for a day like any other.
    val donors = remember(versions, title) {
        val is4k = splitTitle(title).is4k
        versions.sortedBy { if (splitTitle(it.name).is4k != is4k) 1 else 0 }.take(MAX_DONORS)
    }
    LaunchedEffect(donors, loading) {
        if (loading || donors.isEmpty()) return@LaunchedEffect
        for (donor in donors) {
            // A copy that will not load just lends nothing.
            runCatching { fetchEpisodes(app, donor.id) }.onFailure { if (it is kotlinx.coroutines.CancellationException) throw it }
            donorsIn++
        }
    }

    // Read straight away, not after the episode fetch: the poster, plot and rating are already stored, so the page shows them
    // while the episodes load (and re-reads once they have).
    val state by produceState<SeriesState?>(null, seriesId, app.version, tick, loading, donors, donorsIn) {
        value = app.db.read { c -> SeriesState(c.getSeriesDetail(seriesId)?.let { c.withBorrowedSeasons(it, donors.map { d -> d.id }) }) }
    }
    val detail = state?.detail
    val seasons = detail?.seasons ?: emptyList()
    val series = detail?.series
    // The big button: carry on with what you were watching, else the first episode you have not seen.
    val upNext = remember(loading, detail) { if (loading || detail == null) null else upNextIn(detail) }
    val upNextResume = upNext?.resume ?: false
    // Opens on the season Resume points to, so the highlighted pill always agrees with the big button.
    val active: SeasonWithEpisodes? = seasons.firstOrNull { it.season.id == seasonId } ?: seasons.firstOrNull { it.season.id == upNext?.season?.id } ?: seasons.firstOrNull()
    val episodes = active?.episodes ?: emptyList()
    val nextIndex = Math.max(0, episodes.indexOfFirst { !it.watched })
    fun seasonLabel(season: SeasonWithEpisodes) = season.season.name ?: "Season ${season.seasonNumber}"
    // Providers often send no still for some episodes (or a dead link): those borrow the season's, else the show's, poster.
    val fallbackArt = remember(active?.season?.posterUrl, series?.posterUrl) { listOfNotNull(active?.season?.posterUrl, series?.posterUrl).filter { it.isNotEmpty() } }
    val seasonWatched = episodes.isNotEmpty() && episodes.all { it.watched }
    val fullTitle = seriesTitle(title)
    fun playTitle(episode: EpisodeRow) = "$fullTitle · ${episodeTitle(episode.name)}"
    val change = { app.sync.notifyLocalChange(); tick++ }
    // Marking by hand: a whole season from the action row, or one episode (or everything before it) from the sheet that holding select on it opens.
    fun markWatched(ids: List<String>, watched: Boolean) { app.scope.launch { app.db.write { it.setWatched("episode", ids, watched) }; change() } }

    val primaryFocus = remember { FocusRequester() }
    val activePill = remember { FocusRequester() }
    LaunchedEffect(upNext == null) { if (upNext != null) runCatching { primaryFocus.requestFocus() } }

    Box(Modifier.fillMaxSize().background(Palette.background)) {
        Backdrop(series?.posterUrl)
        Column(Modifier.fillMaxSize().padding(start = 120.dp, end = 120.dp, top = 44.dp), verticalArrangement = Arrangement.spacedBy(34.dp)) {
            Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(56.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(360.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(20.dp)).background(Palette.raised)) {
                    if (!series?.posterUrl.isNullOrEmpty()) ArtImage(series!!.posterUrl!!, Modifier.fillMaxSize(), large = true)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    AppText(fullTitle, 56, Palette.foreground, FontWeight.SemiBold, maxLines = 2, letterSpacing = -1f)
                    Facts(factsOf(detail))
                    if (!series?.plot.isNullOrEmpty()) AppText(series!!.plot!!, 26, Palette.muted, modifier = Modifier.width(1000.dp), maxLines = 3, lineHeight = 38)
                    if (upNext != null && series != null) {
                        DetailActions(
                            primary = PrimaryAction(
                                "${if (upNextResume) "Resume" else "Play"} S${upNext.season.seasonNumber} E${upNext.episode.episodeNumber}",
                                { onPlayEpisode(upNext.episode.id, playTitle(upNext.episode), upNextResume) },
                                if (upNextResume) progressOf(upNext.episode.positionSecs, upNext.episode.durationSecs) else null,
                            ),
                            actions = buildList {
                                if (upNextResume) add(DetailAction("restart", "Start over", ActionGlyph.Restart) { onPlayEpisode(upNext.episode.id, playTitle(upNext.episode), false) })
                                add(DetailAction("list", if (series.isFavourite) "Remove from My list" else "Add to My list", if (series.isFavourite) ActionGlyph.Check else ActionGlyph.Plus) {
                                    app.scope.launch { app.db.write { it.toggleSeriesFavourite(seriesId) }; change() }
                                })
                                if (active != null && episodes.isNotEmpty()) {
                                    add(DetailAction("season-watched", if (seasonWatched) "Mark ${seasonLabel(active)} as unwatched" else "Mark ${seasonLabel(active)} as watched", if (seasonWatched) ActionGlyph.Unwatched else ActionGlyph.Watched) {
                                        markWatched(episodes.map { it.id }, !seasonWatched)
                                    })
                                }
                                if (versions.isNotEmpty()) add(DetailAction("versions", "Other versions (${versions.size})", ActionGlyph.Versions) { choosingVersion = true })
                                add(DetailAction("remove", "Remove from Continue watching", ActionGlyph.Cross) {
                                    app.scope.launch { app.db.write { it.removeSeriesFromRecents(seriesId) }; app.sync.notifyLocalChange(); app.bump(); onBack() }
                                })
                            },
                            primaryFocus = primaryFocus,
                        )
                    } else if (loading && error == null) ActionsSkeleton()
                }
            }
            val failure = error
            when {
                failure != null && seasons.isEmpty() -> Column(Modifier.width(1400.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                    AppText(failure.text, 28, Palette.fault)
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        if (failure.gone && sourceId != null && sourceForm != null) AppButton("Edit source", { editing = true }, primary = true)
                        AppButton("Try again", { retry++ }, primary = !(failure.gone && sourceForm != null))
                        if (versions.isNotEmpty()) AppButton("Try another version", { choosingVersion = true })
                    }
                }
                loading -> EpisodesSkeleton()
                seasons.isEmpty() -> AppText("This series has no episodes.", 28, Palette.muted)
                else -> Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(28.dp), verticalAlignment = Alignment.CenterVertically) {
                        // Coming up or down into the pills lands on the one last used (first time: the open season), not whichever sits above the card the remote left.
                        if (seasons.size > 1) LazyRow(Modifier.weight(1f, fill = false).focusRestorer(activePill), horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(vertical = 4.dp)) {
                            items(seasons, key = { it.season.id }) { season ->
                                val isActive = season.season.id == active?.season?.id
                                Pill(seasonLabel(season), { seasonId = season.season.id }, active = isActive, focusRequester = if (isActive) activePill else null)
                            }
                        }
                        AppText("Hold select on an episode for more", 20, Palette.faint)
                    }
                    EpisodeGrid(
                        episodes, fallbackArt, nextIndex, key = active?.season?.id ?: "",
                        onPlay = { episode, started -> onPlayEpisode(episode.id, playTitle(episode), started) },
                        onOptions = { index, episode -> optionsFor = index to episode },
                    )
                }
            }
        }
        BackArrow(onBack, Modifier.padding(start = 24.dp, top = 44.dp))
        if (editing && sourceId != null && sourceForm != null) sourceForm(sourceId) { editing = false; retry++ }
        if (choosingVersion) {
            OptionsSheet(
                title = "Other versions of $fullTitle",
                options = versions.map { SheetOption(it.id, listOfNotNull(if (splitTitle(it.name).is4k) "4K" else "HD", app.sources.firstOrNull { s -> s.id == it.sourceId }?.name).filter { part -> part.isNotEmpty() }.joinToString("  ·  ")) },
                onChoose = { id -> versions.firstOrNull { it.id == id }?.let { onOpenVersion(it.id, it.name) } },
                onClose = { choosingVersion = false },
            )
        }
        optionsFor?.let { (index, episode) ->
            OptionsSheet(
                title = "E${episode.episodeNumber} · ${episodeTitle(episode.name)}",
                options = buildList {
                    add(if (episode.watched) SheetOption("unwatched", "Mark as unwatched") else SheetOption("watched", "Mark as watched"))
                    if (index > 0) add(SheetOption("before", "Mark watched up to here"))
                    add(SheetOption("start", "Play from the start"))
                },
                onChoose = { id ->
                    when (id) {
                        "watched", "unwatched" -> markWatched(listOf(episode.id), id == "watched")
                        "before" -> markWatched(episodes.take(index + 1).map { it.id }, true)
                        else -> onPlayEpisode(episode.id, playTitle(episode), false)
                    }
                },
                onClose = { optionsFor = null },
            )
        }
    }
}
