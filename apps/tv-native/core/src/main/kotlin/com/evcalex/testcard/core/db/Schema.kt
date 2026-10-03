package com.evcalex.testcard.core.db

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.execSQL

const val SCHEMA_VERSION = 15

/**
 * Builds a fresh database from `schema.sql` (generated verbatim from `SCHEMA_SQL` by the TypeScript vectors test).
 * An older database (one the React Native app left) is brought up to date by the migrations of `Migrations.kt`, in one
 * transaction (`migrateDatabase.ts`).
 */
internal fun SQLiteConnection.applySchema() {
    val hasMeta = query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'") { it.getLong(0) }.isNotEmpty()
    if (!hasMeta) {
        val sql = checkNotNull(Db::class.java.classLoader.getResource("schema.sql")) { "schema.sql is missing" }.readText()
        for (statement in splitStatements(sql)) execSQL(statement)
        run("INSERT INTO schema_meta (key, value) VALUES ('version', ?)", SCHEMA_VERSION.toString())
        return
    }
    val stored = query("SELECT value FROM schema_meta WHERE key = 'version'") { it.getText(0) }.firstOrNull()?.toIntOrNull()
    if (stored == null) {
        // schema_meta without a version row: nothing to migrate from, so stamp the current one.
        run("INSERT INTO schema_meta (key, value) VALUES ('version', ?)", SCHEMA_VERSION.toString())
        return
    }
    val pending = pendingMigrations(stored)
    if (pending.isNotEmpty()) atomic {
        for (migration in pending) migration.up(this)
        run("UPDATE schema_meta SET value = ? WHERE key = 'version'", SCHEMA_VERSION.toString())
    }
}

/**
 * Splits the schema script into statements. Statements end at a `;` that ends a line, except inside a trigger body,
 * which runs to its own `END;`. Comments are dropped first.
 */
internal fun splitStatements(script: String): List<String> {
    val statements = mutableListOf<String>()
    val current = StringBuilder()
    for (rawLine in script.lines()) {
        val line = stripComment(rawLine).trimEnd()
        if (line.isBlank()) continue
        current.append(line).append('\n')
        val inTrigger = current.trimStart().startsWith("CREATE TRIGGER", ignoreCase = true)
        val ended = if (inTrigger) line.trim().equals("END;", ignoreCase = true) else line.endsWith(";")
        if (ended) {
            statements += current.toString().trim().removeSuffix(";")
            current.clear()
        }
    }
    check(current.isBlank()) { "Schema ends in the middle of a statement" }
    return statements
}

private fun stripComment(line: String): String {
    var quotes = 0
    var index = 0
    while (index < line.length - 1) {
        if (line[index] == '\'') quotes += 1
        if (line[index] == '-' && line[index + 1] == '-' && quotes % 2 == 0) return line.substring(0, index)
        index += 1
    }
    return line
}

/** For tests in other packages that build old databases. */
fun splitStatementsForTest(script: String): List<String> = splitStatements(script)
