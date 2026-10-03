package com.evcalex.testcard.core.importing

import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.xtream.XtreamApi
import okhttp3.OkHttpClient

/** Progress a caller may surface; movies and series are best-effort, so their failures arrive here, not as throws. */
interface CatalogueEvents {
    fun live(phase: Phase) {}
    fun vod(phase: Phase, movies: Int? = null, message: String? = null) {}
    fun series(phase: Phase, series: Int? = null, message: String? = null) {}

    enum class Phase { Fetching, Done, Error }

    object None : CatalogueEvents
}

class CatalogueResult(val categories: Int, val channels: Int, val variants: Int, val durationMs: Long, val movies: Int?, val series: Int?)

private val NO_LIVE = ImportResult(0, 0, 0, 0)

/**
 * Imports everything a source provides that is not the TV guide: live channels, movies and series, honouring the source's
 * content switches (`importCatalogue.ts`). A playlist is fetched and parsed once and split into live channels and
 * films/episodes; Xtream has a separate API per content type. A failing live import throws; movies and series are
 * best-effort (reported through `events`) so a provider without a VOD catalogue does not fail the refresh.
 */
suspend fun importCatalogue(db: Db, source: CatalogueSource, api: XtreamApi?, http: OkHttpClient, events: CatalogueEvents = CatalogueEvents.None, onLiveProgress: (done: Int, total: Int) -> Unit = { _, _ -> }): CatalogueResult {
    var vod: M3uVodCatalog? = null
    val live: ImportResult
    if (source.includeLive) events.live(CatalogueEvents.Phase.Fetching)

    if (source.kind == "m3u") {
        val startedAt = nowMs()
        val playlist = loadPlaylist(http, source.id, source.playlistUrl ?: "", onLiveProgress)
        vod = playlist.vod
        live = if (!source.includeLive) NO_LIVE else storeLivePages(db, source.id, playlist.livePages, startedAt)
    } else {
        live = if (!source.includeLive) NO_LIVE else importLive(db, checkNotNull(api) { "An Xtream source needs its login" }, source.id, onLiveProgress)
    }

    if (source.includeLive) events.live(CatalogueEvents.Phase.Done)
    var movies: Int? = null
    var series: Int? = null

    if (vod != null) {
        events.vod(CatalogueEvents.Phase.Fetching)
        removeVodFromLive(db, source.id, vod)
        val imported = importM3uVod(db, source.id, source.playlistUrl ?: "", vod, source.includeMovies, source.includeSeries)
        if (source.includeMovies) movies = imported.movies
        if (source.includeSeries) series = imported.series
    }

    if (source.kind == "xtream" && source.includeMovies) {
        events.vod(CatalogueEvents.Phase.Fetching)
        try {
            movies = importVod(db, checkNotNull(api), source).count
            events.vod(CatalogueEvents.Phase.Done, movies = movies)
        } catch (error: Exception) {
            events.vod(CatalogueEvents.Phase.Error, message = error.message?.takeIf { it.isNotEmpty() } ?: "The movie catalog could not be updated.")
        }
    }

    if (source.kind == "xtream" && source.includeSeries) {
        events.series(CatalogueEvents.Phase.Fetching)
        try {
            series = importSeries(db, checkNotNull(api), source).count
            events.series(CatalogueEvents.Phase.Done, series = series)
        } catch (error: Exception) {
            events.series(CatalogueEvents.Phase.Error, message = error.message?.takeIf { it.isNotEmpty() } ?: "The series catalog could not be updated.")
        }
    }

    // The live import stamps the refresh time; a movies/series-only source has none, so stamp it once either landed.
    if (!source.includeLive && (movies != null || series != null)) {
        db.write { it.run("UPDATE sources SET last_refreshed_at = ? WHERE id = ?", nowMs(), source.id) }
    }
    return CatalogueResult(live.categories, live.channels, live.variants, live.durationMs, movies, series)
}

