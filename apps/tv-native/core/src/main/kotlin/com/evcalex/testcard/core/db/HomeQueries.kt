package com.evcalex.testcard.core.db

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import com.evcalex.testcard.core.normalise.GENRE_LABELS
import com.evcalex.testcard.core.normalise.titleKey

/** One row on the Movies or Series landing page. */
class HomeShelf<T>(val key: String, val label: String, val items: List<T>)

class HomeOptions(
    val sourceId: String? = null,
    /** Titles per row. */
    val perShelf: Int = 16,
    /** How many genre rows follow "Top rated". */
    val genres: Int = 8,
    /** A row with fewer titles than this (after de-duplication) is left out. */
    val minTitles: Int = 6,
    /** The viewer's language, ISO 639-1 ("en"). Categories labelled with a different language stay off the page. */
    val language: String? = null,
    /** The current year. Enables the "this year" rows, which go by the year in each title, newest first. */
    val year: Int? = null,
)

/**
 * Regions the landing page steers away from: categories whose name says they are Asian catalogues. This is only the
 * shop window. Browse all still lists every category.
 */
private val AVOID_NAMES = listOf("asia", "chinese", "korean", "japan", "bollywood", "hindi", "thai", "anime", "crunchyroll")

private class Kind(val table: String, val alias: String, val categories: String, val columns: String, val kind: CategoryKind)

private val MOVIES = Kind("movies", "m", "movie_categories", MOVIE_COLUMNS, CategoryKind.Movies)
private val SERIES = Kind("series", "sr", "series_categories", SERIES_COLUMNS, CategoryKind.Series)

/** Over-fetch by this much, since duplicates (quality variants of one title) are dropped afterwards. */
private const val SPARE = 5

private fun <T> SQLiteConnection.build(kind: Kind, opts: HomeOptions, nameOf: (T) -> String, read: (SQLiteStatement) -> T): List<HomeShelf<T>> {
    val perShelf = opts.perShelf
    val a = kind.alias
    // Only titles with a poster, and never divider, junk or adult categories: this page is the shop window.
    val clean = buildList {
        add("$a.poster_url IS NOT NULL AND $a.poster_url != ''")
        add("(' ' || c.tags || ' ') NOT LIKE '% adult %' AND (' ' || c.tags || ' ') NOT LIKE '% junk %' AND (' ' || c.tags || ' ') NOT LIKE '% separator %'")
        addAll(AVOID_NAMES.map { word -> "lower(c.raw_name) NOT LIKE '%$word%'" })
        add(categoryShown("c", kind.kind))
        if (opts.language != null) add("(c.language IS NULL OR c.language = 'multi' OR c.language = ?)")
        if (opts.sourceId != null) add("$a.source_id = ?")
    }
    // Named parameters of the TypeScript become positional here; they appear in this order wherever `clean` is used.
    val params = listOfNotNull(opts.language, opts.sourceId)
    val from = "FROM ${kind.table} $a JOIN ${kind.categories} c ON c.id = $a.category_id"
    // A perfect 10 is almost always a title with a single vote, so it says nothing about quality.
    val rated = "CAST($a.rating AS REAL) > 0 AND CAST($a.rating AS REAL) < 9.9"

    // One title shows once on the whole page, so the genre rows do not repeat what Top rated already showed.
    val seen = HashSet<String>()
    fun take(rows: List<T>): List<T> {
        val out = ArrayList<T>()
        for (row in rows) {
            if (!seen.add(titleKey(nameOf(row)))) continue
            out += row
            if (out.size == perShelf) break
        }
        return out
    }
    val shelves = ArrayList<HomeShelf<T>>()
    fun add(key: String, label: String, rows: List<T>) {
        val items = take(rows)
        if (items.size >= opts.minTitles) shelves += HomeShelf(key, label, items)
        else items.forEach { seen.remove(titleKey(nameOf(it))) }
    }
    val limit = perShelf * SPARE

    val ratedOrder = "CAST($a.rating AS REAL) DESC, $a.rowid"
    // Providers put the release year in the title, "Heat (2025)". That is what "new" means here.
    val years = if (opts.year != null) listOf(opts.year, opts.year - 1) else emptyList()
    val inYears = "(${years.joinToString(" OR ") { year -> "$a.name LIKE '%($year)%'" }})"
    val newestFirst = "CASE ${years.withIndex().joinToString(" ") { (index, year) -> "WHEN $a.name LIKE '%($year)%' THEN ${years.size - index}" }} ELSE 0 END DESC, $a.first_seen_at DESC, $a.rowid DESC"
    fun pick(extra: List<String>, order: String): List<T> =
        query("SELECT ${kind.columns} $from WHERE ${(clean + extra).joinToString(" AND ")} ORDER BY $order LIMIT $limit", *params.toTypedArray()) { read(it) }

    if (years.isNotEmpty()) {
        add("top", "Top 10 this year", pick(listOf(rated, inYears), ratedOrder))
        add("new", "New releases", pick(listOf(inYears), newestFirst))
        add("rated", "Top rated", pick(listOf(rated), ratedOrder))
    } else {
        add("top", "Top rated", pick(listOf(rated), ratedOrder))
    }

    val genres = query(
        "SELECT c.genre AS genre, COUNT(*) AS n $from WHERE ${(clean + "c.genre IS NOT NULL").joinToString(" AND ")} GROUP BY c.genre ORDER BY n DESC",
        *params.toTypedArray(),
    ) { it.getText(0) }
    var genreShelves = 0
    for (genre in genres) {
        val label = GENRE_LABELS[genre] ?: continue
        if (genreShelves == opts.genres) break
        val before = shelves.size
        add(
            "genre:$genre",
            label,
            query(
                "SELECT ${kind.columns} $from WHERE ${(clean + "c.genre = ?").joinToString(" AND ")} ORDER BY (CAST($a.rating AS REAL) > 0) DESC, CAST($a.rating AS REAL) DESC, $a.rowid LIMIT $limit",
                *params.toTypedArray(), genre,
            ) { read(it) },
        )
        if (shelves.size > before) genreShelves += 1
    }
    return shelves
}

/** The Movies landing page's rows: Top rated, then a row per genre. Cheap enough to run once per sync. */
fun SQLiteConnection.movieHome(opts: HomeOptions = HomeOptions()): List<HomeShelf<MovieRow>> = build(MOVIES, opts, { it.name }) { it.movieRow() }

/** The Series landing page's rows; see `movieHome`. */
fun SQLiteConnection.seriesHome(opts: HomeOptions = HomeOptions()): List<HomeShelf<SeriesRow>> = build(SERIES, opts, { it.name }) { it.seriesRow() }

class ContinueEntry(val kind: String, val id: String, val playedAt: Long)

/** Everything watched lately, films and shows together, the most recent first. */
fun SQLiteConnection.listWatchedLately(limit: Int = 60): List<ContinueEntry> = query(
    """SELECT kind, id, playedAt FROM (
         SELECT 'movie' AS kind, r.movie_id AS id, r.played_at AS playedAt FROM movie_recents r JOIN movies m ON m.id = r.movie_id
         UNION ALL
         SELECT 'series' AS kind, r.series_id AS id, r.played_at AS playedAt FROM series_recents r JOIN series s ON s.id = r.series_id
       ) ORDER BY playedAt DESC LIMIT ?""",
    limit,
) { ContinueEntry(it.getText(0), it.getText(1), it.getLong(2)) }
