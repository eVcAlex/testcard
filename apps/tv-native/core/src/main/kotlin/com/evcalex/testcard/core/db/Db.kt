package com.evcalex.testcard.core.db

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import com.evcalex.testcard.core.importing.renameChannels
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext

private const val READERS = 2

/**
 * The database, off the main thread by construction: one writer connection on a single-thread dispatcher and two reader
 * connections on their own, so a long import never blocks a screen's query and two queries can overlap (WAL lets them). Every call is
 * `suspend`; nothing here can be reached from the UI thread without a coroutine hop.
 *
 * The path is asked for on the first use, inside a database thread (finding it touches the disk).
 * `assertOffMain` is a debug check the app supplies (a Looper test).
 */
class Db(private val pathOf: () -> String, private val assertOffMain: () -> Unit = {}) : AutoCloseable {
    constructor(path: String, assertOffMain: () -> Unit = {}) : this({ path }, assertOffMain)

    private val driver = BundledSQLiteDriver()
    private val writerThread = Executors.newSingleThreadExecutor { Thread(it, "db-writer") }
    private val readerThreads = List(READERS) { index -> Executors.newSingleThreadExecutor { Thread(it, "db-reader-$index") } }
    private val writerDispatcher: CoroutineDispatcher = writerThread.asCoroutineDispatcher()
    private val readerDispatchers: List<CoroutineDispatcher> = readerThreads.map { it.asCoroutineDispatcher() }

    // Opened on first use, inside the dispatcher that owns them.
    private val writer: SQLiteConnection by lazy { open().also { it.applySchema(); it.renameChannels() } }
    private val readers = List(READERS) { lazy { open() } }
    private val nextReader = AtomicInteger()
    @Volatile private var schemaReady = false

    private fun open(): SQLiteConnection = driver.open(pathOf()).also { connection ->
        connection.execSQL("PRAGMA journal_mode = WAL")
        // With WAL, NORMAL only risks the last commits on a power cut (never corruption), and saves a flush per commit.
        connection.execSQL("PRAGMA synchronous = NORMAL")
        connection.execSQL("PRAGMA temp_store = MEMORY")
        connection.execSQL("PRAGMA cache_size = -16000")
        connection.execSQL("PRAGMA foreign_keys = ON")
        connection.execSQL("PRAGMA busy_timeout = 5000")
    }

    suspend fun <T> write(block: (SQLiteConnection) -> T): T = withContext(writerDispatcher) {
        assertOffMain()
        block(writer)
    }

    /** One transaction on the writer; rolled back if `block` throws. */
    suspend fun <T> transaction(block: (SQLiteConnection) -> T): T = write { connection -> connection.atomic { block(connection) } }

    suspend fun <T> read(block: (SQLiteConnection) -> T): T {
        // The writer creates the schema; the reader waits for that on first use.
        if (!schemaReady) { write { }; schemaReady = true }
        return readOnReader(block)
    }

    private suspend fun <T> readOnReader(block: (SQLiteConnection) -> T): T {
        val index = Math.floorMod(nextReader.getAndIncrement(), READERS)
        return withContext(readerDispatchers[index]) {
            assertOffMain()
            block(readers[index].value)
        }
    }

    override fun close() {
        writerThread.submit { runCatching { writer.close() } }.get()
        readerThreads.forEachIndexed { index, thread ->
            thread.submit { if (readers[index].isInitialized()) runCatching { readers[index].value.close() } }.get()
            thread.shutdown()
        }
        writerThread.shutdown()
    }
}

/** Binds by position. A NUL in an id becomes U+0001 (SQLite's C API stops text at the first NUL), as the RN adapter does. */
fun SQLiteStatement.bindAll(args: Array<out Any?>) {
    args.forEachIndexed { index, value ->
        val at = index + 1
        when (value) {
            null -> bindNull(at)
            is String -> bindText(at, if ('\u0000' in value) value.replace('\u0000', '\u0001') else value)
            is Int -> bindLong(at, value.toLong())
            is Long -> bindLong(at, value)
            is Boolean -> bindLong(at, if (value) 1 else 0)
            is Double -> bindDouble(at, value)
            else -> error("Cannot bind ${value::class}")
        }
    }
}

/** Runs one statement that returns no rows. */
fun SQLiteConnection.run(sql: String, vararg args: Any?) {
    prepare(sql).use { statement ->
        statement.bindAll(args)
        statement.step()
    }
}

fun <T> SQLiteConnection.query(sql: String, vararg args: Any?, map: (SQLiteStatement) -> T): List<T> =
    prepare(sql).use { statement ->
        statement.bindAll(args)
        buildList { while (statement.step()) add(map(statement)) }
    }

/** The first row, or null. */
fun <T> SQLiteConnection.one(sql: String, vararg args: Any?, map: (SQLiteStatement) -> T): T? =
    prepare(sql).use { statement ->
        statement.bindAll(args)
        if (statement.step()) map(statement) else null
    }

/** Rows the last write on this connection changed (`changes()`). */
fun SQLiteConnection.changes(): Int = one("SELECT changes()") { it.getLong(0).toInt() } ?: 0

/**
 * Runs `block` in one transaction, rolled back if it throws. Inside a transaction already open on the connection (an
 * import's, a swap's) it just runs, so the TypeScript's nested `db.transaction(...)()` calls port one to one.
 */
fun <T> SQLiteConnection.atomic(block: () -> T): T {
    try {
        execSQL("BEGIN IMMEDIATE")
    } catch (error: Exception) {
        // The driver cannot say whether a transaction is open, but SQLite refuses a second one.
        if (error.message?.contains("within a transaction") == true) return block()
        throw error
    }
    try {
        return block().also { execSQL("COMMIT") }
    } catch (error: Throwable) {
        runCatching { execSQL("ROLLBACK") }
        throw error
    }
}

fun SQLiteStatement.textOrNull(column: Int): String? = if (isNull(column)) null else getText(column)

fun SQLiteStatement.longOrNull(column: Int): Long? = if (isNull(column)) null else getLong(column)

/** Runs a prepared statement once with these values and leaves it ready for the next. */
fun SQLiteStatement.exec(vararg args: Any?) {
    reset()
    clearBindings()
    bindAll(args)
    step()
    reset()
}
