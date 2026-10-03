package com.evcalex.testcard.core.db

import com.evcalex.testcard.core.nowMs
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import com.evcalex.testcard.core.normalise.isDatedTitle
import com.evcalex.testcard.core.normalise.jsTrim
import com.evcalex.testcard.core.normalise.splitTitle
import com.evcalex.testcard.core.normalise.titleKey
import com.evcalex.testcard.core.normalise.withoutRank

/** `vodQueries.ts`: films. SQL is verbatim. */
class MovieRow(
    val id: String,
    val sourceId: String,
    val categoryId: String,
    val name: String,
    val posterUrl: String?,
    val rating: String?,
    val plot: String?,
    val durationSecs: Double?,
    val detailsFetchedAt: Long?,
    val isFavourite: Boolean,
    val positionSecs: Double?,
    val watched: Boolean,
)

const val MOVIE_COLUMNS = """m.id, m.source_id, m.category_id, m.name, m.poster_url, m.rating, m.plot,
  COALESCE(m.duration_secs, (SELECT duration_secs FROM playback_progress pp WHERE pp.item_type = 'movie' AND pp.item_id = m.id)) AS duration_secs,
  m.details_fetched_at,
  (SELECT 1 FROM movie_favourites f WHERE f.movie_id = m.id) IS NOT NULL AS is_favourite,
  (SELECT position_secs FROM playback_progress pp WHERE pp.item_type = 'movie' AND pp.item_id = m.id) AS position_secs,
  COALESCE((SELECT watched FROM playback_progress pp WHERE pp.item_type = 'movie' AND pp.item_id = m.id), 0) AS watched"""

private fun SQLiteStatement.doubleOrNull(column: Int): Double? = if (isNull(column)) null else getDouble(column)

internal fun SQLiteStatement.movieRow() = MovieRow(
    getText(0), getText(1), getText(2), getText(3), textOrNull(4), textOrNull(5), textOrNull(6), doubleOrNull(7), longOrNull(8),
    getLong(9) != 0L, doubleOrNull(10), getLong(11) != 0L,
)

fun SQLiteConnection.searchMovies(query: String, limit: Int = 200, sourceId: String? = null): List<MovieRow> {
    val trimmed = query.jsTrim()
    if (trimmed.isEmpty()) return emptyList()
    return query(
        """SELECT $MOVIE_COLUMNS
           FROM movies_fts
           JOIN movies m ON m.rowid = movies_fts.rowid
           WHERE movies_fts MATCH ?${if (sourceId != null) " AND m.source_id = ?" else ""}
           ORDER BY rank
           LIMIT ?""",
        *listOfNotNull<Any>(prefixQuery(trimmed), sourceId, limit).toTypedArray(),
    ) { it.movieRow() }
}

/** The default poster grid: every movie, optionally narrowed to one category. Provider order. */
fun SQLiteConnection.browseMovies(categoryId: String? = null, sourceId: String? = null, genre: String? = null, limit: Int = 300, offset: Int = 0): List<MovieRow> {
    val clauses = mutableListOf(titleShown("m", CategoryKind.Movies))
    val filters = mutableListOf<Any?>()
    if (categoryId != null) { clauses += "m.category_id = ?"; filters += categoryId }
    if (sourceId != null) { clauses += "m.source_id = ?"; filters += sourceId }
    if (genre != null) { clauses += "m.category_id IN (SELECT id FROM movie_categories WHERE genre = ?)"; filters += genre }
    return query("SELECT $MOVIE_COLUMNS FROM movies m WHERE ${clauses.joinToString(" AND ")} ORDER BY m.rowid LIMIT ? OFFSET ?", *filters.toTypedArray(), limit, offset) { it.movieRow() }
}

fun SQLiteConnection.listMovieCategories(sourceId: String? = null): List<CategoryRow> = query(
    """SELECT cat.id, cat.raw_name AS name, cat.country, cat.genre, cat.language, cat.service, cat.tags, COUNT(m.id) AS movie_count
       FROM movie_categories cat
       JOIN movies m ON m.category_id = cat.id
       WHERE ${categoryShown("cat", CategoryKind.Movies)}${if (sourceId != null) " AND cat.source_id = ?" else ""}
       GROUP BY cat.id
       ORDER BY cat.rowid""",
    *listOfNotNull(sourceId).toTypedArray(),
) { CategoryRow(it.getText(0), it.getText(1), it.textOrNull(2), it.textOrNull(3), it.textOrNull(4), it.textOrNull(5), it.getText(6), it.getLong(7).toInt()) }

fun SQLiteConnection.listFavouriteMovies(): List<MovieRow> =
    query("SELECT $MOVIE_COLUMNS FROM movie_favourites f JOIN movies m ON m.id = f.movie_id ORDER BY f.added_at DESC") { it.movieRow() }

fun SQLiteConnection.listRecentMovies(limit: Int = 24): List<MovieRow> =
    query("SELECT $MOVIE_COLUMNS FROM movie_recents r JOIN movies m ON m.id = r.movie_id ORDER BY r.played_at DESC LIMIT ?", limit) { it.movieRow() }

fun SQLiteConnection.toggleMovieFavourite(movieId: String): Boolean = atomic {
    val existing = one("SELECT remote_key FROM movie_favourites WHERE movie_id = ?", movieId) { it.textOrNull(0) to true }
    if (existing != null) {
        run("DELETE FROM movie_favourites WHERE movie_id = ?", movieId)
        if (existing.first != null) run("INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) VALUES ('movie_favourites', ?, ?)", existing.first, nowMs())
        false
    } else {
        val remoteKey = one("SELECT remote_key FROM movies WHERE id = ?", movieId) { it.textOrNull(0) }
        run("INSERT INTO movie_favourites (movie_id, added_at, remote_key, updated_at) VALUES (?, ?, ?, ?)", movieId, nowMs(), remoteKey, nowMs())
        true
    }
}

fun SQLiteConnection.recordMovieRecent(movieId: String) {
    val remoteKey = one("SELECT remote_key FROM movies WHERE id = ?", movieId) { it.textOrNull(0) }
    run(
        """INSERT INTO movie_recents (movie_id, played_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(movie_id) DO UPDATE SET played_at = excluded.played_at, remote_key = excluded.remote_key, updated_at = excluded.updated_at""",
        movieId, nowMs(), remoteKey, nowMs(),
    )
}

/** Takes a movie out of Recently watched and Continue watching, and forgets its resume position. */
fun SQLiteConnection.removeMovieFromHistory(movieId: String) {
    val row = one("SELECT remote_key FROM movie_recents WHERE movie_id = ?", movieId) { it.textOrNull(0) to true }
    run("DELETE FROM movie_recents WHERE movie_id = ?", movieId)
    if (row?.first != null) run("INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) VALUES ('movie_recents', ?, ?)", row.first, nowMs())
    clearPlaybackProgress("movie", listOf(movieId))
}

fun SQLiteConnection.getMovieById(movieId: String): MovieRow? = one("SELECT $MOVIE_COLUMNS FROM movies m WHERE m.id = ?", movieId) { it.movieRow() }

class MoviePlaybackTarget(
    val movieId: String,
    val movieName: String,
    val providerStreamId: String,
    val containerExtension: String?,
    /** The catalogue's `movies.duration_secs`: null until the lazy details fetch has run. */
    val durationSecs: Double?,
    val source: SourceRef,
)

fun SQLiteConnection.getMoviePlaybackTarget(movieId: String): MoviePlaybackTarget? = one(
    """SELECT m.id AS movieId, m.name AS movieName, m.provider_stream_id AS providerStreamId, m.container_extension AS containerExtension,
              m.duration_secs AS durationSecs,
              s.id AS sourceId, s.kind AS kind, s.name AS sourceName, s.base_url AS baseUrl
       FROM movies m
       JOIN sources s ON s.id = m.source_id
       WHERE m.id = ?""",
    movieId,
) {
    val source = if (it.getText(6) == "xtream") SourceRef(it.getText(5), "xtream", it.getText(7), it.textOrNull(8) ?: "", null, null)
    else SourceRef(it.getText(5), "m3u", it.getText(7), null, "", null)
    MoviePlaybackTarget(it.getText(0), it.getText(1), it.getText(2), it.textOrNull(3), it.doubleOrNull(4), source)
}

class MovieShelf(val category: CategoryRow, val items: List<MovieRow>)

/** Category tags that mark a row as not worth a landing-page shelf (adult is still browsable by name). */
internal val HIDDEN_FROM_SHELVES = setOf("junk", "separator", "adult")

fun SQLiteConnection.movieShelves(sourceId: String? = null, shelves: Int = 12, perShelf: Int = 20, minTitles: Int = 6): List<MovieShelf> {
    val chosen = listMovieCategories(sourceId)
        .filter { it.count >= minTitles && !it.tags.split(" ").any { tag -> tag in HIDDEN_FROM_SHELVES } }
        .sortedByDescending { it.count }
        .take(shelves)
    return chosen.map { category ->
        MovieShelf(
            category,
            query(
                """SELECT $MOVIE_COLUMNS FROM movies m WHERE m.category_id = ?
                   ORDER BY (m.poster_url IS NULL OR m.poster_url = ''), CAST(m.rating AS REAL) DESC, m.rowid LIMIT ?""",
                category.id, perShelf,
            ) { it.movieRow() },
        )
    }
}

/** `title.replace(/^\d{1,3}\.\s+/, "").replace(/[%_\\]/g, ...)` of the version searches. */
internal fun likeWords(title: String): String = withoutRank(title).replace(Regex("[%_\\\\]")) { "\\${it.value}" }

/**
 * The other copies of a film: the same dated title in another quality, category or source. Empty for an undated name,
 * which is too often a show's episode to match on.
 */
fun SQLiteConnection.listMovieVersions(movieId: String): List<MovieRow> {
    val name = one("SELECT name FROM movies WHERE id = ?", movieId) { it.getText(0) } ?: return emptyList()
    if (!isDatedTitle(name)) return emptyList()
    val key = titleKey(name)
    val parts = splitTitle(name)
    return query(
        "SELECT $MOVIE_COLUMNS FROM movies m WHERE m.id != ? AND m.name LIKE ? ESCAPE '\\' AND m.name LIKE ? ORDER BY m.rowid LIMIT 40",
        movieId, "%${likeWords(parts.title)}%", "%(${parts.year})%",
    ) { it.movieRow() }.filter { titleKey(it.name) == key }
}

/** Where a copy stands when choosing which to play: a 4K copy first, then the sources in the viewer's order. */
internal fun SQLiteConnection.copyRank(): (name: String, sourceId: String) -> Pair<Int, Int> {
    val order = query("SELECT id FROM sources ORDER BY sort_order IS NULL, sort_order, created_at") { it.getText(0) }.withIndex().associate { it.value to it.index }
    return { name, sourceId -> (if (splitTitle(name).is4k) 0 else 1) to (order[sourceId] ?: Int.MAX_VALUE) }
}

/** The copies of a film to try, in turn: the best first, each next one tried when the one before will not play. */
fun SQLiteConnection.listMoviePlayOrder(movieId: String, resuming: Boolean): List<String> {
    val movie = one("SELECT id, name, source_id FROM movies WHERE id = ?", movieId) { Triple(it.getText(0), it.getText(1), it.getText(2)) } ?: return emptyList()
    val rank = copyRank()
    val copies = listOf(movie) + listMovieVersions(movieId).map { Triple(it.id, it.name, it.sourceId) }
    val sorted = copies.withIndex()
        .map { (index, row) -> Triple(row.first, rank(row.second, row.third), index) }
        .sortedWith(compareBy<Triple<String, Pair<Int, Int>, Int>>({ it.second.first }, { it.second.second }, { it.third }))
        .map { it.first }
    return if (resuming) listOf(movieId) + sorted.filter { it != movieId } else sorted
}
