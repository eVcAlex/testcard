package com.evcalex.testcard.tv.ui.detail

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.db.MovieRow
import com.evcalex.testcard.core.db.getMovieById
import com.evcalex.testcard.core.db.listMovieVersions
import com.evcalex.testcard.core.db.removeMovieFromHistory
import com.evcalex.testcard.core.db.setWatched
import com.evcalex.testcard.core.db.toggleMovieFavourite
import com.evcalex.testcard.core.normalise.splitTitle
import com.evcalex.testcard.core.shouldPromptResume
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.ui.components.ActionGlyph
import com.evcalex.testcard.tv.ui.components.AppButton
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.ArtImage
import com.evcalex.testcard.tv.ui.components.Backdrop
import com.evcalex.testcard.tv.ui.components.BackArrow
import com.evcalex.testcard.tv.ui.components.DetailAction
import com.evcalex.testcard.tv.ui.components.DetailActions
import com.evcalex.testcard.tv.ui.components.Facts
import com.evcalex.testcard.tv.ui.components.OptionsSheet
import com.evcalex.testcard.tv.ui.components.PrimaryAction
import com.evcalex.testcard.tv.ui.components.SheetOption
import com.evcalex.testcard.tv.ui.home.progressOf
import com.evcalex.testcard.tv.ui.home.runtimeLabel
import com.evcalex.testcard.tv.ui.sections.movieDetail
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.launch

/** "1:23:45" / "23:45" from seconds. */
fun positionLabel(secs: Double): String {
    val total = Math.max(0, Math.floor(secs).toInt())
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = (total % 60).toString().padStart(2, '0')
    return if (h > 0) "$h:${m.toString().padStart(2, '0')}:$s" else "$m:$s"
}

/** "5.0 rating" only for a rating that means something (the provider sends 0 and 10 for unknown). */
fun ratingFact(rating: String?): String? {
    val value = rating?.trim()?.toDoubleOrNull() ?: return null
    return if (value > 0 && value < 10) "${"%.1f".format(java.util.Locale.ROOT, value)} rating" else null
}

private val VERSION_TAG = Regex("^(.{1,12}?)\\s+-\\s+")

private class MovieState(val movie: MovieRow?, val versions: List<MovieRow>)

/**
 * A film's own page: poster, what it is, and what you can do with it (play, resume, start over, add to My list). Its plot and
 * length are fetched from the provider the first time it is opened (`MovieDetail.tsx`).
 */
@Composable
fun MovieDetailScreen(app: AppController, movieId: String, onPlay: (resume: Boolean) -> Unit, onBack: () -> Unit, onOpenVersion: (id: String, title: String) -> Unit) {
    var tick by remember { mutableIntStateOf(0) }
    var choosingVersion by remember { mutableStateOf(false) }
    BackHandler(onBack = onBack)
    val state by produceState<MovieState?>(null, movieId, app.version, tick) {
        value = app.db.read { MovieState(it.getMovieById(movieId), it.listMovieVersions(movieId)) }
    }
    val loaded = state ?: return Box(Modifier.fillMaxSize().background(Palette.background))
    val movie = loaded.movie
    val needsDetails = movie != null && movie.detailsFetchedAt == null
    LaunchedEffect(movieId, needsDetails) {
        if (!needsDetails) return@LaunchedEffect
        // The page works without a plot.
        runCatching { movieDetail(app, movieId) }.onSuccess { tick++ }
    }
    val primaryFocus = remember { FocusRequester() }
    LaunchedEffect(movie == null) { runCatching { primaryFocus.requestFocus() } }

    if (movie == null) {
        Column(Modifier.fillMaxSize().background(Palette.background).padding(120.dp), verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically)) {
            AppText("That movie is no longer in your library.", 28, Palette.muted)
            AppButton("Back", onBack, primary = true, focusRequester = primaryFocus)
        }
        return
    }

    val parts = splitTitle(movie.name)
    val position = movie.positionSecs
    val resume = position != null && shouldPromptResume(position, movie.durationSecs)
    val facts = listOfNotNull(
        parts.year?.takeIf { it.isNotEmpty() },
        movie.durationSecs?.takeIf { it > 0 }?.let { runtimeLabel(it) },
        ratingFact(movie.rating),
    )
    val versions = loaded.versions
    // Named only when the copies come from more than one source; otherwise every line would say the same thing.
    val mixed = versions.any { it.sourceId != movie.sourceId }
    fun versionLabel(row: MovieRow): String {
        val tag = VERSION_TAG.find(row.name.trim())?.groupValues?.get(1)
        val source = if (mixed) app.sources.firstOrNull { it.id == row.sourceId }?.name else null
        return listOfNotNull(
            if (splitTitle(row.name).is4k) "4K" else "HD",
            tag?.takeIf { it != "4K" }?.replace(Regex("^4K-?"), ""),
            source,
        ).filter { it.isNotEmpty() }.joinToString("  ·  ")
    }
    val change = { app.sync.notifyLocalChange(); tick++ }

    Box(Modifier.fillMaxSize().background(Palette.background)) {
        Backdrop(movie.posterUrl)
        BackArrow(onBack, Modifier.padding(start = 24.dp, top = 44.dp))
        Row(Modifier.fillMaxSize().padding(horizontal = 120.dp), horizontalArrangement = Arrangement.spacedBy(72.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(460.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(20.dp)).background(Palette.raised)) {
                if (!movie.posterUrl.isNullOrEmpty()) ArtImage(movie.posterUrl!!, Modifier.fillMaxSize(), large = true)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                AppText(parts.title, 72, Palette.foreground, FontWeight.SemiBold, maxLines = 3, letterSpacing = -1.5f)
                Facts(facts)
                if (!movie.plot.isNullOrEmpty()) AppText(movie.plot!!, 28, Palette.muted, modifier = Modifier.width(1000.dp), maxLines = 4, lineHeight = 42)
                DetailActions(
                    primary = PrimaryAction(if (resume && position != null) "Resume from ${positionLabel(position)}" else "Play", { onPlay(resume) }, if (resume) progressOf(position, movie.durationSecs) else null),
                    actions = buildList {
                        if (resume) add(DetailAction("restart", "Start over", ActionGlyph.Restart) { onPlay(false) })
                        add(DetailAction("list", if (movie.isFavourite) "Remove from My list" else "Add to My list", if (movie.isFavourite) ActionGlyph.Check else ActionGlyph.Plus) {
                            app.scope.launch { app.db.write { it.toggleMovieFavourite(movieId) }; change() }
                        })
                        add(DetailAction("watched", if (movie.watched) "Mark as unwatched" else "Mark as watched", if (movie.watched) ActionGlyph.Unwatched else ActionGlyph.Watched) {
                            app.scope.launch { app.db.write { it.setWatched("movie", listOf(movieId), !movie.watched) }; change() }
                        })
                        if (versions.isNotEmpty()) add(DetailAction("versions", "Other versions (${versions.size})", ActionGlyph.Versions) { choosingVersion = true })
                        if (resume) add(DetailAction("remove", "Remove from Continue watching", ActionGlyph.Cross) {
                            app.scope.launch { app.db.write { it.removeMovieFromHistory(movieId) }; app.sync.notifyLocalChange(); app.bump(); onBack() }
                        })
                    },
                    primaryFocus = primaryFocus,
                )
            }
        }
        if (choosingVersion) {
            OptionsSheet(
                title = "Other versions of ${parts.title}",
                options = versions.map { SheetOption(it.id, versionLabel(it)) },
                onChoose = { id -> versions.firstOrNull { it.id == id }?.let { onOpenVersion(it.id, it.name) } },
                onClose = { choosingVersion = false },
            )
        }
    }
}
