package com.evcalex.testcard.core.db

import com.evcalex.testcard.core.nowMs
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import com.evcalex.testcard.core.normalise.isDatedTitle
import com.evcalex.testcard.core.normalise.jsTrim
import com.evcalex.testcard.core.normalise.splitTitle
import com.evcalex.testcard.core.normalise.titleKey
import com.evcalex.testcard.core.shouldPromptResume

/** `seriesQueries.ts`: shows, seasons and episodes. SQL is verbatim. */
class SeriesRow(
    val id: String,
    val sourceId: String,
    val categoryId: String,
    val name: String,
    val posterUrl: String?,
    val rating: String?,
    val plot: String?,
    val episodesFetchedAt: Long?,
    val isFavourite: Boolean,
)

const val SERIES_COLUMNS = """sr.id, sr.source_id, sr.category_id, sr.name, sr.poster_url, sr.rating, sr.plot, sr.episodes_fetched_at,
  (SELECT 1 FROM series_favourites f WHERE f.series_id = sr.id) IS NOT NULL AS is_favourite"""

internal fun SQLiteStatement.seriesRow() = SeriesRow(getText(0), getText(1), getText(2), getText(3), textOrNull(4), textOrNull(5), textOrNull(6), longOrNull(7), getLong(8) != 0L)

fun SQLiteConnection.searchSeries(query: String, limit: Int = 200, sourceId: String? = null): List<SeriesRow> {
    val trimmed = query.jsTrim()
    if (trimmed.isEmpty()) return emptyList()
    return query(
        """SELECT $SERIES_COLUMNS
           FROM series_fts
           JOIN series sr ON sr.rowid = series_fts.rowid
           WHERE series_fts MATCH ?${if (sourceId != null) " AND sr.source_id = ?" else ""}
           ORDER BY rank
           LIMIT ?""",
        *listOfNotNull<Any>(prefixQuery(trimmed), sourceId, limit).toTypedArray(),
    ) { it.seriesRow() }
}

fun SQLiteConnection.browseSeries(categoryId: String? = null, sourceId: String? = null, genre: String? = null, limit: Int = 300, offset: Int = 0): List<SeriesRow> {
    val clauses = mutableListOf(titleShown("sr", CategoryKind.Series))
    val filters = mutableListOf<Any?>()
    if (categoryId != null) { clauses += "sr.category_id = ?"; filters += categoryId }
    if (sourceId != null) { clauses += "sr.source_id = ?"; filters += sourceId }
    if (genre != null) { clauses += "sr.category_id IN (SELECT id FROM series_categories WHERE genre = ?)"; filters += genre }
    return query("SELECT $SERIES_COLUMNS FROM series sr WHERE ${clauses.joinToString(" AND ")} ORDER BY sr.rowid LIMIT ? OFFSET ?", *filters.toTypedArray(), limit, offset) { it.seriesRow() }
}

fun SQLiteConnection.listSeriesCategories(sourceId: String? = null): List<CategoryRow> = query(
    """SELECT cat.id, cat.raw_name AS name, cat.country, cat.genre, cat.language, cat.service, cat.tags, COUNT(sr.id) AS series_count
       FROM series_categories cat
       JOIN series sr ON sr.category_id = cat.id
       WHERE ${categoryShown("cat", CategoryKind.Series)}${if (sourceId != null) " AND cat.source_id = ?" else ""}
       GROUP BY cat.id
       ORDER BY cat.rowid""",
    *listOfNotNull(sourceId).toTypedArray(),
) { CategoryRow(it.getText(0), it.getText(1), it.textOrNull(2), it.textOrNull(3), it.textOrNull(4), it.textOrNull(5), it.getText(6), it.getLong(7).toInt()) }

fun SQLiteConnection.listFavouriteSeries(): List<SeriesRow> =
    query("SELECT $SERIES_COLUMNS FROM series_favourites f JOIN series sr ON sr.id = f.series_id ORDER BY f.added_at DESC") { it.seriesRow() }

fun SQLiteConnection.listRecentSeries(limit: Int = 24): List<SeriesRow> =
    query("SELECT $SERIES_COLUMNS FROM series_recents r JOIN series sr ON sr.id = r.series_id ORDER BY r.played_at DESC LIMIT ?", limit) { it.seriesRow() }

private fun SQLiteConnection.recentKey(seriesId: String): Pair<String?, Boolean> =
    one("SELECT remote_key FROM series_recents WHERE series_id = ?", seriesId) { it.textOrNull(0) }.let { it to (one("SELECT 1 FROM series_recents WHERE series_id = ?", seriesId) { r -> r.getLong(0) } != null) }

/** Takes a series out of Recently watched. Synced, so the removal follows to the user's other devices. */
fun SQLiteConnection.removeSeriesFromRecents(seriesId: String) {
    val (key, exists) = recentKey(seriesId)
    if (!exists) return
    run("DELETE FROM series_recents WHERE series_id = ?", seriesId)
    if (key != null) run("INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) VALUES ('series_recents', ?, ?)", key, nowMs())
}

fun SQLiteConnection.toggleSeriesFavourite(seriesId: String): Boolean = atomic {
    val existing = one("SELECT remote_key FROM series_favourites WHERE series_id = ?", seriesId) { it.textOrNull(0) to true }
    if (existing != null) {
        run("DELETE FROM series_favourites WHERE series_id = ?", seriesId)
        if (existing.first != null) run("INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) VALUES ('series_favourites', ?, ?)", existing.first, nowMs())
        false
    } else {
        val remoteKey = one("SELECT remote_key FROM series WHERE id = ?", seriesId) { it.textOrNull(0) }
        run("INSERT INTO series_favourites (series_id, added_at, remote_key, updated_at) VALUES (?, ?, ?, ?)", seriesId, nowMs(), remoteKey, nowMs())
        true
    }
}

/** Bumped on any episode play, not just a series-level action (there isn't one). */
fun SQLiteConnection.recordSeriesRecent(seriesId: String) {
    val remoteKey = one("SELECT remote_key FROM series WHERE id = ?", seriesId) { it.textOrNull(0) }
    run(
        """INSERT INTO series_recents (series_id, played_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(series_id) DO UPDATE SET played_at = excluded.played_at, remote_key = excluded.remote_key, updated_at = excluded.updated_at""",
        seriesId, nowMs(), remoteKey, nowMs(),
    )
}

/** Takes a series out of Recently watched and forgets its episodes' resume positions and watched marks. */
fun SQLiteConnection.removeSeriesFromHistory(seriesId: String) {
    val (key, _) = recentKey(seriesId)
    run("DELETE FROM series_recents WHERE series_id = ?", seriesId)
    if (key != null) run("INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) VALUES ('series_recents', ?, ?)", key, nowMs())
    clearPlaybackProgress("episode", query("SELECT id FROM episodes WHERE series_id = ?", seriesId) { it.getText(0) })
}

class SeasonRow(val id: String, val seriesId: String, val seasonNumber: Int, val name: String?, val posterUrl: String?)

class EpisodeRow(
    val id: String,
    val seasonId: String,
    val seriesId: String,
    val episodeNumber: Int,
    val name: String,
    val containerExtension: String?,
    val durationSecs: Double?,
    val plot: String?,
    val imageUrl: String?,
    val positionSecs: Double?,
    val watched: Boolean,
)

class SeasonWithEpisodes(val season: SeasonRow, val episodes: List<EpisodeRow>) {
    val seasonNumber get() = season.seasonNumber
}

class SeriesDetail(val series: SeriesRow, val seasons: List<SeasonWithEpisodes>)

private const val EPISODE_COLUMNS = """e.id, e.season_id, e.series_id, e.episode_number, e.name, e.container_extension,
  COALESCE(e.duration_secs, (SELECT duration_secs FROM playback_progress pp WHERE pp.item_type = 'episode' AND pp.item_id = e.id)) AS duration_secs,
  e.plot, e.image_url,
  (SELECT position_secs FROM playback_progress pp WHERE pp.item_type = 'episode' AND pp.item_id = e.id) AS position_secs,
  COALESCE((SELECT watched FROM playback_progress pp WHERE pp.item_type = 'episode' AND pp.item_id = e.id), 0) AS watched"""

private fun SQLiteStatement.episodeRow() = EpisodeRow(
    getText(0), getText(1), getText(2), getLong(3).toInt(), getText(4), textOrNull(5), if (isNull(6)) null else getDouble(6), textOrNull(7), textOrNull(8),
    if (isNull(9)) null else getDouble(9), getLong(10) != 0L,
)

/** A series with its seasons and episodes, nested for direct rendering. Run `ensureSeriesEpisodes` first for a series opened for the first time. */
fun SQLiteConnection.getSeriesDetail(seriesId: String): SeriesDetail? {
    val series = one("SELECT $SERIES_COLUMNS FROM series sr WHERE sr.id = ?", seriesId) { it.seriesRow() } ?: return null
    val seasons = query("SELECT id, series_id, season_number, name, poster_url FROM seasons WHERE series_id = ? ORDER BY season_number", seriesId) {
        SeasonRow(it.getText(0), it.getText(1), it.getLong(2).toInt(), it.textOrNull(3), it.textOrNull(4))
    }
    return SeriesDetail(series, seasons.map { season -> SeasonWithEpisodes(season, query("SELECT $EPISODE_COLUMNS FROM episodes e WHERE e.season_id = ? ORDER BY e.episode_number", season.id) { it.episodeRow() }) })
}

/**
 * A series' seasons with the gaps filled from other copies of the same show: a season this copy lists with no episodes,
 * or does not list at all, is taken from the first of `versionIds` that has episodes for it. A borrowed season keeps its
 * own ids, so its episodes play (and keep their progress) from the copy they belong to.
 */
fun SQLiteConnection.withBorrowedSeasons(detail: SeriesDetail, versionIds: List<String>): SeriesDetail {
    val seasons = detail.seasons.filter { it.episodes.isNotEmpty() }
    val have = seasons.map { it.seasonNumber }.toMutableSet()
    val borrowed = mutableListOf<SeasonWithEpisodes>()
    for (id in versionIds) {
        val other = getSeriesDetail(id) ?: continue
        for (season in other.seasons) {
            if (season.episodes.isEmpty() || season.seasonNumber in have) continue
            have += season.seasonNumber
            borrowed += season
        }
    }
    if (borrowed.isEmpty() && seasons.size == detail.seasons.size) return detail
    return SeriesDetail(detail.series, (seasons + borrowed).sortedBy { it.seasonNumber })
}

class UpNextEpisode(val episode: EpisodeRow, val season: SeasonRow, val resume: Boolean)

fun SQLiteConnection.getUpNextEpisode(seriesId: String): UpNextEpisode? = getSeriesDetail(seriesId)?.let(::upNextIn)

/** The choice of `getUpNextEpisode`, over a detail already read (one with borrowed seasons, say). */
fun upNextIn(detail: SeriesDetail): UpNextEpisode? {
    val all = detail.seasons.flatMap { season -> season.episodes.map { it to season.season } }
    val pick = all.firstOrNull { (e, _) -> e.positionSecs != null && !e.watched && shouldPromptResume(e.positionSecs, e.durationSecs) }
        ?: all.firstOrNull { (e, _) -> !e.watched } ?: all.firstOrNull() ?: return null
    val resume = pick.first.positionSecs != null && shouldPromptResume(pick.first.positionSecs!!, pick.first.durationSecs)
    return UpNextEpisode(pick.first, pick.second, resume)
}

/** Where a series carries on from, in brief: enough to label a poster, not to play it. */
class UpNextSummary(val seasonNumber: Int, val episodeNumber: Int, val positionSecs: Double?, val durationSecs: Double?, val resume: Boolean)

/** `getUpNextEpisode` for many series in one read, for the rows that label every poster with its next episode. */
fun SQLiteConnection.getUpNextEpisodes(seriesIds: List<String>): Map<String, UpNextSummary> {
    class Row(val seriesId: String, val seasonNumber: Int, val episodeNumber: Int, val positionSecs: Double?, val durationSecs: Double?, val watched: Boolean)
    val out = LinkedHashMap<String, UpNextSummary>()
    for (ids in seriesIds.chunked(500)) {
        val rows = query(
            """SELECT e.series_id AS seriesId, s.season_number AS seasonNumber, e.episode_number AS episodeNumber,
                      pp.position_secs AS positionSecs, COALESCE(e.duration_secs, pp.duration_secs) AS durationSecs, COALESCE(pp.watched, 0) AS watched
               FROM episodes e
               JOIN seasons s ON s.id = e.season_id
               LEFT JOIN playback_progress pp ON pp.item_type = 'episode' AND pp.item_id = e.id
               WHERE e.series_id IN (${ids.joinToString(",") { "?" }})
               ORDER BY e.series_id, s.season_number, e.episode_number""",
            *ids.toTypedArray(),
        ) { Row(it.getText(0), it.getLong(1).toInt(), it.getLong(2).toInt(), if (it.isNull(3)) null else it.getDouble(3), if (it.isNull(4)) null else it.getDouble(4), it.getLong(5) != 0L) }
        for ((seriesId, all) in rows.groupBy { it.seriesId }) {
            val pick = all.firstOrNull { it.positionSecs != null && !it.watched && shouldPromptResume(it.positionSecs, it.durationSecs) }
                ?: all.firstOrNull { !it.watched } ?: all.firstOrNull() ?: continue
            out[seriesId] = UpNextSummary(pick.seasonNumber, pick.episodeNumber, pick.positionSecs, pick.durationSecs, pick.positionSecs != null && shouldPromptResume(pick.positionSecs, pick.durationSecs))
        }
    }
    return out
}

fun SQLiteConnection.getSeriesSource(seriesId: String): SourceRef? = one(
    """SELECT s.id, s.kind, s.name, s.base_url AS baseUrl
       FROM sources s
       JOIN series sr ON sr.source_id = s.id
       WHERE sr.id = ?""",
    seriesId,
) { if (it.getText(1) == "xtream") SourceRef(it.getText(0), "xtream", it.getText(2), it.textOrNull(3) ?: "", null, null) else SourceRef(it.getText(0), "m3u", it.getText(2), null, "", null) }

class EpisodePlaybackTarget(
    val episodeId: String,
    val episodeName: String,
    val seriesId: String,
    val providerEpisodeId: String,
    val containerExtension: String?,
    val durationSecs: Double?,
    val source: SourceRef,
)

fun SQLiteConnection.getEpisodePlaybackTarget(episodeId: String): EpisodePlaybackTarget? = one(
    """SELECT e.id AS episodeId, e.name AS episodeName, e.series_id AS seriesId, e.provider_episode_id AS providerEpisodeId,
              e.container_extension AS containerExtension, e.duration_secs AS durationSecs,
              s.id AS sourceId, s.kind AS kind, s.name AS sourceName, s.base_url AS baseUrl
       FROM episodes e
       JOIN series sr ON sr.id = e.series_id
       JOIN sources s ON s.id = sr.source_id
       WHERE e.id = ?""",
    episodeId,
) {
    val source = if (it.getText(7) == "xtream") SourceRef(it.getText(6), "xtream", it.getText(8), it.textOrNull(9) ?: "", null, null) else SourceRef(it.getText(6), "m3u", it.getText(8), null, "", null)
    EpisodePlaybackTarget(it.getText(0), it.getText(1), it.getText(2), it.getText(3), it.textOrNull(4), if (it.isNull(5)) null else it.getDouble(5), source)
}

class SeriesShelf(val category: CategoryRow, val items: List<SeriesRow>)

fun SQLiteConnection.seriesShelves(sourceId: String? = null, shelves: Int = 12, perShelf: Int = 20, minTitles: Int = 6): List<SeriesShelf> {
    val chosen = listSeriesCategories(sourceId)
        .filter { it.count >= minTitles && !it.tags.split(" ").any { tag -> tag in HIDDEN_FROM_SHELVES } }
        .sortedByDescending { it.count }
        .take(shelves)
    return chosen.map { category ->
        SeriesShelf(
            category,
            query(
                """SELECT $SERIES_COLUMNS FROM series sr WHERE sr.category_id = ?
                   ORDER BY (sr.poster_url IS NULL OR sr.poster_url = ''), CAST(sr.rating AS REAL) DESC, sr.rowid LIMIT ?""",
                category.id, perShelf,
            ) { it.seriesRow() },
        )
    }
}

class NextEpisode(val id: String, val name: String, val seasonNumber: Int, val episodeNumber: Int)

/** The episode after this one in its series: the next in the season, or the first of the next season. Null at the end. */
fun SQLiteConnection.findNextEpisode(episodeId: String): NextEpisode? {
    val current = one(
        "SELECT e.series_id AS seriesId, s.season_number AS seasonNumber, e.episode_number AS episodeNumber FROM episodes e JOIN seasons s ON s.id = e.season_id WHERE e.id = ?",
        episodeId,
    ) { Triple(it.getText(0), it.getLong(1), it.getLong(2)) } ?: return null
    return one(
        """SELECT e.id, e.name, s.season_number AS seasonNumber, e.episode_number AS episodeNumber
           FROM episodes e JOIN seasons s ON s.id = e.season_id
           WHERE e.series_id = ? AND (s.season_number > ? OR (s.season_number = ? AND e.episode_number > ?))
           ORDER BY s.season_number, e.episode_number LIMIT 1""",
        current.first, current.second, current.second, current.third,
    ) { NextEpisode(it.getText(0), it.getText(1), it.getLong(2).toInt(), it.getLong(3).toInt()) }
}

class SkipWindow(val fromSecs: Int, val toSecs: Int)

fun SQLiteConnection.getSkipWindow(seriesId: String): SkipWindow? =
    one("SELECT from_secs AS fromSecs, to_secs AS toSecs FROM series_skip WHERE series_id = ?", seriesId) { SkipWindow(it.getLong(0).toInt(), it.getLong(1).toInt()) }

/** Remembers a skip at the start of an episode so the same stretch is offered in the next ones. */
fun SQLiteConnection.saveSkipWindow(seriesId: String, fromSecs: Double, toSecs: Double) {
    // The source is marked as edited so the skip is pushed to the account with it.
    run("UPDATE sources SET sync_updated_at = MAX(?, COALESCE(sync_updated_at, 0) + 1) WHERE id = (SELECT source_id FROM series WHERE id = ?)", nowMs(), seriesId)
    run(
        """INSERT INTO series_skip (series_id, from_secs, to_secs, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(series_id) DO UPDATE SET from_secs = excluded.from_secs, to_secs = excluded.to_secs, updated_at = excluded.updated_at""",
        seriesId, Math.round(fromSecs), Math.round(toSecs), nowMs(),
    )
}

fun SQLiteConnection.clearSkipWindow(seriesId: String) = run("DELETE FROM series_skip WHERE series_id = ?", seriesId)

/** The other copies of a series: the same dated title in another quality, category or source. Empty for an undated name. */
fun SQLiteConnection.listSeriesVersions(seriesId: String): List<SeriesRow> {
    val name = one("SELECT name FROM series WHERE id = ?", seriesId) { it.getText(0) } ?: return emptyList()
    if (!isDatedTitle(name)) return emptyList()
    val key = titleKey(name)
    val parts = splitTitle(name)
    return query(
        "SELECT $SERIES_COLUMNS FROM series sr WHERE sr.id != ? AND sr.name LIKE ? ESCAPE '\\' AND sr.name LIKE ? ORDER BY sr.rowid LIMIT 40",
        seriesId, "%${likeWords(parts.title)}%", "%(${parts.year})%",
    ) { it.seriesRow() }.filter { titleKey(it.name) == key }
}
