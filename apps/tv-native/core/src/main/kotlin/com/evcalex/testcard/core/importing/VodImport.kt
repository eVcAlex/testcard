package com.evcalex.testcard.core.importing

import com.evcalex.testcard.core.nowMs
import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.crypto.sha1Hex
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.changes
import com.evcalex.testcard.core.db.exec
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.db.textOrNull
import com.evcalex.testcard.core.m3u.movieKey
import com.evcalex.testcard.core.m3u.seriesKey
import com.evcalex.testcard.core.sync.normalizeProviderHost
import com.evcalex.testcard.core.sync.remoteKeyForPlaylistItem
import com.evcalex.testcard.core.xtream.XCategory
import com.evcalex.testcard.core.xtream.XMovie
import com.evcalex.testcard.core.xtream.XSeries
import com.evcalex.testcard.core.xtream.XtreamApi
import com.evcalex.testcard.core.xtream.fetchMovies
import com.evcalex.testcard.core.xtream.fetchSeriesCategories
import com.evcalex.testcard.core.xtream.fetchSeriesDetails
import com.evcalex.testcard.core.xtream.fetchSeriesList
import com.evcalex.testcard.core.xtream.fetchVodCategories
import com.evcalex.testcard.core.xtream.fetchVodDetails
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The key on the account of each title in a refresh (a digest of the provider's host and the title's id). Titles this
 * device already has keep the key stored with them: working out tens of thousands again on every refresh took most of its
 * time on a Fire TV. Those are trusted only if one of them, worked out afresh, still matches (the source's identity host
 * has not changed since); otherwise every key is worked out again (`storedKeys.ts`).
 */
internal suspend fun keysFor(db: Db, table: String, sourceId: String, providerHost: String, pages: List<List<Pair<String, String>>>): Map<String, String> {
    // A NUL in an id is stored as U+0001; ids here are compared as the importer writes them.
    val stored = HashMap<String, String>()
    db.read { connection ->
        connection.query("SELECT id, remote_key FROM $table WHERE source_id = ? AND remote_key IS NOT NULL", sourceId) { stored[it.getText(0).replace('\u0001', '\u0000')] = it.getText(1) }
    }
    val host = normalizeProviderHost(providerHost)
    fun keyOf(providerId: String) = sha1Hex("$host|$providerId")
    val sample = pages.asSequence().flatten().firstOrNull { it.first in stored }
    val trusted = sample != null && keyOf(sample.second) == stored[sample.first]

    val keys = HashMap<String, String>()
    withContext(Dispatchers.Default) {
        for (page in pages) {
            for ((id, providerId) in page) {
                val kept = if (trusted) stored[id] else null
                keys[id] = kept ?: keyOf(providerId)
            }
        }
    }
    return keys
}

/** A source row with its content switches, as `sources` stores them. */
class CatalogueSource(
    val id: String,
    val kind: String,
    val name: String,
    val baseUrl: String?,
    val playlistUrl: String?,
    val epgUrl: String?,
    val includeLive: Boolean,
    val includeMovies: Boolean,
    val includeSeries: Boolean,
) {
    /** The address history is matched by: the Xtream source's identity host, or "". */
    val providerHost get() = if (kind == "xtream") baseUrl ?: "" else ""
}

fun SQLiteConnection.loadCatalogueSource(sourceId: String): CatalogueSource? = one(
    "SELECT id, kind, name, base_url, playlist_url, epg_url, include_live, include_movies, include_series FROM sources WHERE id = ?",
    sourceId,
) { CatalogueSource(it.getText(0), it.getText(1), it.getText(2), it.textOrNull(3), it.textOrNull(4), it.textOrNull(5), it.getLong(6) != 0L, it.getLong(7) != 0L, it.getLong(8) != 0L) }

private fun categoryUpsert(table: String, replaceAlways: Boolean = false) =
    """INSERT INTO $table (id, source_id, provider_id, raw_name, country, genre, language, service, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET raw_name = excluded.raw_name, country = excluded.country,
         genre = excluded.genre, language = excluded.language, service = excluded.service, tags = excluded.tags
       ${if (replaceAlways) "" else "WHERE $table.raw_name IS NOT excluded.raw_name OR $table.tags IS NOT excluded.tags"}"""

private const val UPSERT_MOVIE = """INSERT INTO movies (
      id, source_id, category_id, provider_stream_id, name, poster_url,
      container_extension, rating, first_seen_at, last_seen_at, remote_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      category_id          = excluded.category_id,
      provider_stream_id   = excluded.provider_stream_id,
      name                 = excluded.name,
      poster_url           = excluded.poster_url,
      container_extension  = excluded.container_extension,
      rating               = excluded.rating,
      details_fetched_at   = NULL,
      last_seen_at         = excluded.last_seen_at,
      remote_key            = excluded.remote_key
    WHERE movies.category_id IS NOT excluded.category_id OR movies.provider_stream_id IS NOT excluded.provider_stream_id
      OR movies.name IS NOT excluded.name OR movies.poster_url IS NOT excluded.poster_url
      OR movies.container_extension IS NOT excluded.container_extension OR movies.rating IS NOT excluded.rating
      OR movies.remote_key IS NOT excluded.remote_key"""

private const val UPSERT_SERIES = """INSERT INTO series (
      id, source_id, category_id, provider_series_id, name, poster_url,
      rating, plot, first_seen_at, last_seen_at, remote_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      category_id         = excluded.category_id,
      provider_series_id  = excluded.provider_series_id,
      name                = excluded.name,
      poster_url          = excluded.poster_url,
      rating              = excluded.rating,
      plot                = excluded.plot,
      episodes_fetched_at = NULL,
      last_seen_at        = excluded.last_seen_at,
      remote_key           = excluded.remote_key
    WHERE series.category_id IS NOT excluded.category_id OR series.provider_series_id IS NOT excluded.provider_series_id
      OR series.name IS NOT excluded.name OR series.poster_url IS NOT excluded.poster_url
      OR series.rating IS NOT excluded.rating OR series.plot IS NOT excluded.plot
      OR series.remote_key IS NOT excluded.remote_key"""

class VodResult(val categories: Int, val count: Int, val durationMs: Long)

/**
 * Imports (or re-imports) an Xtream source's movie catalogue: `get_vod_categories` + `get_vod_streams` per category.
 * Diff-and-merge by stable id, never destructive. Only a film that changed is written; it has `details_fetched_at`
 * reset to NULL, so its lazily fetched plot and duration are fetched again next time it is opened.
 */
suspend fun importVod(db: Db, api: XtreamApi, source: CatalogueSource): VodResult {
    val startedAt = nowMs()
    val now = startedAt
    val categories = api.fetchVodCategories(source.id)
    val pages = fetchAll(categories) { category -> category to api.fetchMovies(source.id, category) }
    val remoteKeys = keysFor(db, "movies", source.id, source.providerHost, pages.map { (_, movies) -> movies.map { it.id to it.providerStreamId } })
    var count = 0
    db.applyInSlices(pages, { it.second.size }) { connection, (category, movies) ->
        connection.run(categoryUpsert("movie_categories"), category.id, category.sourceId, category.providerId, category.rawName, *categoryColumns(category.rawName))
        connection.prepare(UPSERT_MOVIE).use { statement ->
            for (movie: XMovie in movies) {
                statement.exec(movie.id, movie.sourceId, movie.categoryId, movie.providerStreamId, movie.name, movie.posterUrl, movie.containerExtension, movie.rating, now, now, remoteKeys.getValue(movie.id))
                count += 1
            }
        }
    }
    // Not deleting movies absent from this refresh: last_seen_at records presence without ever silently dropping a favourite.
    return VodResult(categories.size, count, nowMs() - startedAt)
}

/** An Xtream source's series catalogue; same diff-and-merge shape as `importVod`. An unchanged series keeps its episode list until it is a day old. */
suspend fun importSeries(db: Db, api: XtreamApi, source: CatalogueSource): VodResult {
    val startedAt = nowMs()
    val now = startedAt
    val categories = api.fetchSeriesCategories(source.id)
    val pages = fetchAll(categories) { category -> category to api.fetchSeriesList(source.id, category) }
    val remoteKeys = keysFor(db, "series", source.id, source.providerHost, pages.map { (_, series) -> series.map { it.id to it.providerSeriesId } })
    var count = 0
    db.applyInSlices(pages, { it.second.size }) { connection, (category, series) ->
        connection.run(categoryUpsert("series_categories"), category.id, category.sourceId, category.providerId, category.rawName, *categoryColumns(category.rawName))
        connection.prepare(UPSERT_SERIES).use { statement ->
            for (show: XSeries in series) {
                statement.exec(show.id, show.sourceId, show.categoryId, show.providerSeriesId, show.name, show.posterUrl, show.rating, show.plot, now, now, remoteKeys.getValue(show.id))
                count += 1
            }
        }
    }
    return VodResult(categories.size, count, nowMs() - startedAt)
}

/**
 * Lazily fetches (and caches) a movie's plot and duration via `get_vod_info`: a no-op if already fetched. Also backfills
 * `container_extension` when the cheap bulk import did not supply one (`importVodDetails.ts`).
 */
suspend fun ensureMovieDetails(db: Db, api: XtreamApi, movieId: String) {
    val row = db.read { it.one("SELECT provider_stream_id, details_fetched_at FROM movies WHERE id = ?", movieId) { r -> r.getText(0) to (if (r.isNull(1)) null else r.getLong(1)) } } ?: return
    if (row.second != null) return
    val details = api.fetchVodDetails(row.first)
    db.write {
        it.run(
            """UPDATE movies SET
                 plot                = COALESCE(?, plot),
                 duration_secs       = COALESCE(?, duration_secs),
                 container_extension = COALESCE(?, container_extension),
                 details_fetched_at  = ?
               WHERE id = ?""",
            details.plot, details.durationSecs, details.containerExtension, nowMs(), movieId,
        )
    }
}

/** A series' episode list older than a day is fetched again on the next open, so a running series' new episodes turn up. */
const val EPISODES_FRESH_MS = 24L * 60 * 60 * 1000

/**
 * Lazily fetches (and caches) a series' seasons and episodes via `get_series_info`: a no-op if already fetched. Replaces
 * them wholesale (delete-then-insert) rather than diffing.
 */
suspend fun ensureSeriesEpisodes(db: Db, api: XtreamApi, providerHost: String, seriesId: String) {
    class Row(val id: String, val sourceId: String, val categoryId: String, val providerSeriesId: String, val name: String, val fetchedAt: Long?)
    val row = db.read {
        it.one("SELECT id, source_id, category_id, provider_series_id, name, episodes_fetched_at FROM series WHERE id = ?", seriesId) { r ->
            Row(r.getText(0), r.getText(1), r.getText(2), r.getText(3), r.getText(4), if (r.isNull(5)) null else r.getLong(5))
        }
    } ?: return
    if (row.fetchedAt != null && nowMs() - row.fetchedAt < EPISODES_FRESH_MS) return
    val series = XSeries(row.id, row.sourceId, row.categoryId, row.providerSeriesId, row.name, null, null, null)
    val details = api.fetchSeriesDetails(series)
    val host = normalizeProviderHost(providerHost)
    val episodeKeys = withContext(Dispatchers.Default) { details.episodes.associate { it.id to sha1Hex("$host|${it.providerEpisodeId}") } }
    db.transaction { connection ->
        connection.run("DELETE FROM episodes WHERE series_id = ?", seriesId)
        connection.run("DELETE FROM seasons WHERE series_id = ?", seriesId)
        for (season in details.seasons) {
            connection.run("INSERT INTO seasons (id, series_id, season_number, name, poster_url) VALUES (?, ?, ?, ?, ?)", season.id, season.seriesId, season.seasonNumber, season.name, season.posterUrl)
        }
        for (episode in details.episodes) {
            connection.run(
                """INSERT INTO episodes (id, season_id, series_id, provider_episode_id, episode_number, name, container_extension, duration_secs, plot, image_url, remote_key)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                episode.id, episode.seasonId, episode.seriesId, episode.providerEpisodeId, episode.episodeNumber, episode.name, episode.containerExtension,
                episode.durationSecs, episode.plot, episode.imageUrl, episodeKeys[episode.id],
            )
        }
        connection.run("UPDATE series SET episodes_fetched_at = ? WHERE id = ?", nowMs(), seriesId)
    }
}

// -------------------------------------------------------------------------------------------------
// Films and episodes found in an M3U playlist (importM3UVod.ts)

private class PreparedMovie(val id: String, val categoryId: String, val title: String, val url: String, val poster: String?, val extension: String?, val key: String)
private class PreparedShow(val id: String, val categoryId: String, val title: String, val poster: String?, val key: String)
private class PreparedSeason(val id: String, val seriesId: String, val number: Int)
private class PreparedEpisode(val id: String, val seasonId: String, val seriesId: String, val url: String, val number: Int, val name: String, val extension: String?, val key: String)

class M3uVodResult(val movies: Int, val series: Int, val episodes: Int)

/**
 * Imports the films and episodes found in a playlist into the same tables Xtream VOD uses. There is no catalogue API and
 * no lazy detail call: seasons and episodes are written here (with `episodes_fetched_at` set, which keeps
 * `ensureSeriesEpisodes` out of it) and `provider_stream_id` / `provider_episode_id` are the URL itself. Ids come from the
 * title, not the URL, so favourites and progress survive a provider rotating tokens.
 */
suspend fun importM3uVod(db: Db, sourceId: String, playlistUrl: String, catalog: M3uVodCatalog, includeMovies: Boolean, includeSeries: Boolean): M3uVodResult {
    val now = nowMs()
    val movieCategories = LinkedHashMap<String, String>()
    val movies = LinkedHashMap<String, PreparedMovie>()
    val seriesCategories = LinkedHashMap<String, String>()
    val series = LinkedHashMap<String, PreparedShow>()
    val seasons = LinkedHashMap<String, PreparedSeason>()
    val episodes = LinkedHashMap<String, PreparedEpisode>()

    if (includeMovies) {
        for (item in catalog.movies) {
            val key = movieKey(item.title)
            if (key == "") continue
            val id = "$sourceId:m:$key"
            if (id in movies) continue // the same film listed twice: the first wins
            val categoryId = "$sourceId:mcat:${item.group}"
            movieCategories[categoryId] = item.group
            movies[id] = PreparedMovie(id, categoryId, item.title, item.url, item.posterUrl, item.extension, key)
        }
    }
    if (includeSeries) {
        for (item in catalog.episodes) {
            val showKey = seriesKey(item.series)
            if (showKey == "") continue
            val seriesId = "$sourceId:s:$showKey"
            if (seriesId !in series) {
                val categoryId = "$sourceId:scat:${item.group}"
                seriesCategories[categoryId] = item.group
                series[seriesId] = PreparedShow(seriesId, categoryId, item.series, item.posterUrl, showKey)
            }
            val seasonId = "$seriesId:${item.season}"
            seasons[seasonId] = PreparedSeason(seasonId, seriesId, item.season)
            val episodeId = "$seasonId:e${item.episode}"
            if (episodeId in episodes) continue // duplicate S01E01 (another quality): the first wins
            episodes[episodeId] = PreparedEpisode(
                episodeId, seasonId, seriesId, item.url, item.episode, item.title.ifEmpty { "Episode ${item.episode}" }, item.extension, "$showKey|s${item.season}e${item.episode}",
            )
        }
    }

    val movieKeys = withContext(Dispatchers.Default) { movies.values.associate { it.id to remoteKeyForPlaylistItem(playlistUrl, "movie|${it.key}") } }
    val seriesKeys = withContext(Dispatchers.Default) { series.values.associate { it.id to remoteKeyForPlaylistItem(playlistUrl, "series|${it.key}") } }
    val episodeKeys = withContext(Dispatchers.Default) { episodes.values.associate { it.id to remoteKeyForPlaylistItem(playlistUrl, "episode|${it.key}") } }

    val upsertMovieCategory = categoryUpsert("movie_categories", replaceAlways = true)
    val upsertSeriesCategory = categoryUpsert("series_categories", replaceAlways = true)
    // Parents go before children (categories, then titles, then seasons, then episodes), so every slice's rows have what they point at.
    db.transaction { connection ->
        for ((id, rawName) in movieCategories) connection.run(upsertMovieCategory, id, sourceId, rawName, rawName, *categoryColumns(rawName))
        for ((id, rawName) in seriesCategories) connection.run(upsertSeriesCategory, id, sourceId, rawName, rawName, *categoryColumns(rawName))
    }
    db.applyInSlices(movies.values.toList()) { connection, movie ->
        connection.run(
            """INSERT INTO movies (id, source_id, category_id, provider_stream_id, name, poster_url, container_extension,
                                   details_fetched_at, first_seen_at, last_seen_at, remote_key)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, provider_stream_id = excluded.provider_stream_id,
                 name = excluded.name, poster_url = excluded.poster_url, container_extension = excluded.container_extension,
                 last_seen_at = excluded.last_seen_at, remote_key = excluded.remote_key""",
            movie.id, sourceId, movie.categoryId, movie.url, movie.title, movie.poster, movie.extension, now, now, now, movieKeys[movie.id],
        )
    }
    db.applyInSlices(series.values.toList()) { connection, show ->
        connection.run(
            """INSERT INTO series (id, source_id, category_id, provider_series_id, name, poster_url, episodes_fetched_at,
                                   first_seen_at, last_seen_at, remote_key)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, name = excluded.name,
                 poster_url = COALESCE(excluded.poster_url, poster_url), episodes_fetched_at = excluded.episodes_fetched_at,
                 last_seen_at = excluded.last_seen_at, remote_key = excluded.remote_key""",
            show.id, sourceId, show.categoryId, show.key, show.title, show.poster, now, now, now, seriesKeys[show.id],
        )
    }
    db.applyInSlices(seasons.values.toList()) { connection, season ->
        connection.run("INSERT INTO seasons (id, series_id, season_number) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING", season.id, season.seriesId, season.number)
    }
    db.applyInSlices(episodes.values.toList()) { connection, episode ->
        connection.run(
            """INSERT INTO episodes (id, season_id, series_id, provider_episode_id, episode_number, name, container_extension, remote_key)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET provider_episode_id = excluded.provider_episode_id, episode_number = excluded.episode_number,
                 name = excluded.name, container_extension = excluded.container_extension, remote_key = excluded.remote_key""",
            episode.id, episode.seasonId, episode.seriesId, episode.url, episode.number, episode.name, episode.extension, episodeKeys[episode.id],
        )
    }
    return M3uVodResult(movies.size, series.size, episodes.size)
}

/**
 * Before playlists were split, every entry (films included) was imported as a live channel, and imports never delete.
 * This removes those leftover channels, and any live category they emptied, for entries now recognised as films or
 * episodes. Idempotent: a no-op once they are gone.
 */
suspend fun removeVodFromLive(db: Db, sourceId: String, catalog: M3uVodCatalog): Int {
    val urls = catalog.movies.map { it.url } + catalog.episodes.map { it.url }
    if (urls.isEmpty()) return 0
    return db.transaction { connection ->
        var removed = 0
        // Chunked to stay under SQLite's bound-parameter limit.
        for (chunk in urls.chunked(500)) {
            connection.run(
                "DELETE FROM channels WHERE source_id = ? AND id IN (SELECT channel_id FROM channel_variants WHERE provider_stream_id IN (${chunk.joinToString(",") { "?" }}))",
                sourceId, *chunk.toTypedArray(),
            )
            removed += connection.changes()
        }
        if (removed > 0) connection.run("DELETE FROM categories WHERE source_id = ? AND id NOT IN (SELECT category_id FROM channels WHERE source_id = ?)", sourceId, sourceId)
        removed
    }
}

