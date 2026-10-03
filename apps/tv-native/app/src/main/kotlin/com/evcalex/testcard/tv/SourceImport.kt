package com.evcalex.testcard.tv

import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.guide.GuideImporter
import com.evcalex.testcard.core.importing.CatalogueEvents
import com.evcalex.testcard.core.importing.CatalogueSource
import com.evcalex.testcard.core.importing.importCatalogue
import com.evcalex.testcard.core.setup.ContentKind
import com.evcalex.testcard.core.setup.ImportProgress
import com.evcalex.testcard.core.setup.ImportStage
import com.evcalex.testcard.core.setup.Wants
import com.evcalex.testcard.core.sync.SourceDraft
import com.evcalex.testcard.core.sync.removeSourceRows
import com.evcalex.testcard.core.sync.saveSource
import com.evcalex.testcard.core.xtream.XtreamApi
import java.util.UUID
import kotlinx.coroutines.async
import kotlinx.coroutines.launch

private fun AppController.stage(sourceId: String, at: ImportStage) {
    val entry = progress[sourceId] ?: return
    if (entry.at == at) return
    progress = progress + (sourceId to ImportProgress(entry.name, entry.wants, entry.shows, at))
}

private suspend fun AppController.importSource(sourceId: String) {
    class Row(val source: CatalogueSource, val lastRefreshedAt: Long?, val held: Map<ContentKind, Int>)
    val row = db.read { c ->
        c.one(
            """SELECT id, kind, name, base_url, playlist_url, epg_url, include_live, include_movies, include_series, last_refreshed_at,
                      (SELECT COUNT(*) FROM channels WHERE source_id = sources.id),
                      (SELECT COUNT(*) FROM movies WHERE source_id = sources.id),
                      (SELECT COUNT(*) FROM series WHERE source_id = sources.id)
               FROM sources WHERE id = ?""",
            sourceId,
        ) {
            Row(
                CatalogueSource(it.getText(0), it.getText(1), it.getText(2), if (it.isNull(3)) null else it.getText(3), if (it.isNull(4)) null else it.getText(4), if (it.isNull(5)) null else it.getText(5), it.getLong(6) != 0L, it.getLong(7) != 0L, it.getLong(8) != 0L),
                if (it.isNull(9)) null else it.getLong(9),
                mapOf(ContentKind.Live to it.getLong(10).toInt(), ContentKind.Movies to it.getLong(11).toInt(), ContentKind.Series to it.getLong(12).toInt()),
            )
        }
    } ?: return
    val source = row.source
    val wants = Wants(source.includeLive, source.includeMovies, source.includeSeries)
    // Described by what it held last time: a playlist set to import films that has never had any is live-only. A
    // playlist's first load cannot know; an Xtream source's lists are fetched separately, so its settings say.
    val kinds = ContentKind.entries.filter { wants.of(it) }
    val shows = if (row.lastRefreshedAt != null) kinds.filter { (row.held[it] ?: 0) > 0 } else if (source.kind == "xtream") kinds else null
    progress = progress + (sourceId to ImportProgress(source.name, wants, shows, if (wants.live) ImportStage.Live else if (wants.movies) ImportStage.Movies else if (wants.series) ImportStage.Series else ImportStage.Saving))
    refreshing = refreshing + sourceId
    errors = errors - sourceId
    // Movies and series are best-effort (the import carries on without them), so their failures arrive as events
    // rather than a throw. Kept on the row, or a VOD-only source just reads "Nothing loaded yet".
    fun failed(part: String, message: String) {
        errors = errors + (sourceId to (errors[sourceId].orEmpty() + SourceFailure(part, message)))
    }
    try {
        // A provider with more than one address: the one that answers is used for the import.
        if (servers.hasBackups(sourceId)) runCatching { servers.pickServer(sourceId) }
        val api = if (source.kind == "xtream") XtreamApi({ logins.current(sourceId) }, http) else null
        val afterLive = if (wants.movies) ImportStage.Movies else if (wants.series) ImportStage.Series else ImportStage.Saving
        importCatalogue(db, source, api, http, object : CatalogueEvents {
            override fun live(phase: CatalogueEvents.Phase) { if (phase == CatalogueEvents.Phase.Done) stage(sourceId, afterLive) }
            override fun vod(phase: CatalogueEvents.Phase, movies: Int?, message: String?) {
                if (phase == CatalogueEvents.Phase.Error) failed("movies", message ?: "The provider sent nothing back.")
                stage(sourceId, if (phase == CatalogueEvents.Phase.Fetching) ImportStage.Movies else if (wants.series) ImportStage.Series else ImportStage.Saving)
            }
            override fun series(phase: CatalogueEvents.Phase, series: Int?, message: String?) {
                if (phase == CatalogueEvents.Phase.Error) failed("series", message ?: "The provider sent nothing back.")
                stage(sourceId, if (phase == CatalogueEvents.Phase.Fetching) ImportStage.Series else ImportStage.Saving)
            }
        })
        // Favourites, recents and progress that point at titles not imported yet were held back by the sync until they
        // exist. Now they do: sync straight away, so the app opens with its history in place.
        stage(sourceId, ImportStage.History)
        runCatching { sync.triggerNow() }
        // The TV guide comes after, in the background: the app does not wait on it.
        guideImporter.refresh(listOf(sourceId))
    } catch (error: Exception) {
        if (error is kotlinx.coroutines.CancellationException) throw error
        errors = errors + (sourceId to listOf(SourceFailure("all", error.message?.takeIf { it.isNotEmpty() } ?: "The import failed.")))
    } finally {
        // Kept, ticked, until every source importing alongside it is done; then the setup screen goes.
        val entry = progress[sourceId]
        val next = if (entry == null) progress else progress + (sourceId to ImportProgress(entry.name, entry.wants, entry.shows, ImportStage.Done))
        progress = if (next.values.all { it.at == ImportStage.Done }) emptyMap() else next
        refreshing = refreshing - sourceId
        bump()
    }
}

/** One import per source at a time: a second request for a source that is importing waits on the first. */
suspend fun AppController.refreshSource(sourceId: String) {
    val running = synchronized(inFlight) {
        inFlight[sourceId] ?: scope.async(start = kotlinx.coroutines.CoroutineStart.LAZY) { importSource(sourceId) }.also { run ->
            inFlight[sourceId] = run
            run.invokeOnCompletion { synchronized(inFlight) { inFlight.remove(sourceId) } }
            run.start()
        }
    }
    running.await()
}

/** Refreshes every source, one after the other (a failure is kept on its own source and does not stop the rest). */
suspend fun AppController.refreshAll() {
    for (id in sources.map { it.id }) try { refreshSource(id) } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error }
}

/** Takes a source off this device and, through sync, off the user's others. */
suspend fun AppController.removeSource(sourceId: String) {
    // Removed mid-import, the import's next write would hit a source that is gone and report a failure.
    synchronized(inFlight) { inFlight[sourceId] }?.let { runCatching { it.await() } }
    db.write { it.removeSourceRows(sourceId, recordTombstone = true) }
    logins.delete(sourceId)
    sync.notifyLocalChange()
    bump()
}

/** Adds a source (null id) or changes one, once the provider has accepted it; synced. Throws a message to show. */
suspend fun AppController.saveSource(sourceId: String?, draft: SourceDraft) {
    if (sourceId != null) synchronized(inFlight) { inFlight[sourceId] }?.let { runCatching { it.await() } }
    val saved = saveSource(db, logins, http, sourceId, draft) { UUID.randomUUID().toString() }
    sync.notifyLocalChange()
    bump()
    // A new guide address is read straight away (see GuideImporter's staleness).
    if (saved.reload) scope.launch { refreshSource(saved.id) } else guideImporter.refresh()
}
