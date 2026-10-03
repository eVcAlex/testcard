package com.evcalex.testcard.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.core.playback.PlayItem
import com.evcalex.testcard.core.playback.PlayKind
import com.evcalex.testcard.tv.ui.detail.MovieDetailScreen
import com.evcalex.testcard.tv.ui.player.PlayerScreen
import com.evcalex.testcard.tv.ui.detail.SeriesDetailScreen
import com.evcalex.testcard.tv.ui.search.SearchScreen
import com.evcalex.testcard.tv.ui.settings.SettingsScreen
import com.evcalex.testcard.tv.ui.settings.SourceFormDialog
import com.evcalex.testcard.tv.ui.settings.UpdatePrompt
import com.evcalex.testcard.tv.ui.sections.*
import com.evcalex.testcard.tv.ui.shell.Route
import com.evcalex.testcard.tv.ui.shell.Section
import com.evcalex.testcard.tv.ui.shell.ShellContent
import com.evcalex.testcard.tv.ui.theme.Palette

/** Wires every screen into the shell. */
fun appContent(app: AppController) = ShellContent(
    section = { section, ctx ->
        when (section) {
            Section.Home -> StartSection(ctx)
            Section.Live -> LiveSection(ctx)
            Section.Movies -> MoviesSection(ctx)
            Section.Series -> SeriesSection(ctx)
            Section.Search -> SearchScreen(ctx.app, ctx.sourceId, ctx.openKeyboard, ctx.actions, ctx.active)
            Section.Settings -> SettingsScreen(ctx.app)
            else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { AppText(section.label, 40, Palette.muted) }
        }
    },
    overlay = { route, _, setRoute, controller ->
        when (route) {
            is Route.Movie -> MovieDetailScreen(
                controller, route.id,
                onPlay = { resume -> setRoute(Route.Play(PlayItem(PlayKind.Movie, route.id, route.title), null, null, resume, route)) },
                onBack = { setRoute(Route.Shell) },
                onOpenVersion = { id, title -> setRoute(Route.Movie(id, title)) },
            )
            is Route.Series -> SeriesDetailScreen(
                controller, route.id, route.title,
                onPlayEpisode = { episodeId, title, resume -> setRoute(Route.Play(PlayItem(PlayKind.Episode, episodeId, title), route.id, null, resume, route)) },
                sourceForm = { id, close -> SourceFormDialog(controller, id, close) },
                onBack = { setRoute(Route.Shell) },
                onOpenVersion = { id, title -> setRoute(Route.Series(id, title)) },
            )
            is Route.Play -> PlayerScreen(
                controller, route.item, route.seriesId, route.resume, route.channels,
                onZap = { channel -> setRoute(Route.Play(channel, null, route.channels, false, route.returnTo)) },
                onNextEpisode = { episode -> setRoute(Route.Play(episode, route.seriesId, null, false, route.returnTo)) },
                onExit = { setRoute(route.returnTo) },
                sourceForm = { id, close -> SourceFormDialog(controller, id, close) },
            )
            else -> {}
        }
    },
    updatePrompt = { UpdatePrompt(app.updates) },
)
