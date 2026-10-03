package com.evcalex.testcard.core.sync

import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.db.textOrNull
import com.evcalex.testcard.core.xtream.probeXtream
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient

/**
 * A provider often gives more than one address for the same account, and moves between them (`state/hosts.ts`). A source
 * keeps its main address (the one its history is matched by across devices) and any backups; when the main one cannot be
 * reached, the first backup that answers is used for everything (lists, streams, the guide) until the main one is back.
 */
class ServerPicker(private val db: Db, private val logins: SourceLogins, private val http: OkHttpClient) {
    private fun metaKey(sourceId: String) = "server:$sourceId"

    private suspend fun backupsOf(sourceId: String): List<String> {
        val row = db.read { it.one("SELECT kind, backup_urls FROM sources WHERE id = ?", sourceId) { r -> r.getText(0) to r.textOrNull(1) } }
        return if (row?.first == "xtream") parseBackupUrls(row.second) else emptyList()
    }

    suspend fun hasBackups(sourceId: String) = backupsOf(sourceId).isNotEmpty()

    /** Ids of every source with backup addresses. */
    suspend fun sourcesWithBackups(): List<String> =
        db.read { it.query("SELECT id FROM sources WHERE backup_urls IS NOT NULL AND backup_urls <> '[]'") { r -> r.getText(0) } }

    private suspend fun answers(login: XtreamLogin): Boolean = try {
        withTimeoutOrNull(ANSWER_WITHIN_MS) { probeXtream(login, http) } ?: false
    } catch (error: Exception) {
        if (error is CancellationException) throw error
        false
    }

    /** Takes up, at launch, the backup each source was on last time (asked again the next time it is checked). */
    suspend fun loadServersInUse() {
        val rows = db.read { it.query("SELECT key, value FROM schema_meta WHERE key LIKE 'server:%'") { r -> r.getText(0) to r.getText(1) } }
        for ((key, value) in rows) {
            val sourceId = key.removePrefix("server:")
            if (value in backupsOf(sourceId)) logins.setServerInUse(sourceId, value)
            else db.write { it.run("DELETE FROM schema_meta WHERE key = ?", key) }
        }
    }

    /**
     * Finds the address that answers, the main one first, and uses it from now on. Returns whether a different one is in
     * use than before (so a failed request is worth trying again). A source with no backups is left alone.
     */
    suspend fun pickServer(sourceId: String): Boolean {
        val backups = backupsOf(sourceId)
        if (backups.isEmpty()) return false
        val stored = runCatching { logins.stored(sourceId) }.getOrNull() ?: return false
        val before = logins.serverFor(sourceId) ?: stored.baseUrl
        for (server in listOf(stored.baseUrl) + backups) {
            if (!answers(stored.copy(baseUrl = server))) continue
            val backup = if (server == stored.baseUrl) null else server
            logins.setServerInUse(sourceId, backup)
            db.write {
                if (backup == null) it.run("DELETE FROM schema_meta WHERE key = ?", metaKey(sourceId))
                else it.run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)", metaKey(sourceId), backup)
            }
            return server != before
        }
        return false
    }

    private companion object {
        /** How long one address is given to answer before the next is tried. */
        const val ANSWER_WITHIN_MS = 8000L
    }
}

private val UNREACHABLE = Regex("UnknownHost|resolve host|ENOTFOUND|No address associated|Unable to connect|ConnectException|ECONNREFUSED|Network request failed|timed? ?out|SocketTimeout|did not respond", RegexOption.IGNORE_CASE)

/** Whether a failure means the server could not be reached at all (worth another address), not a refusal. */
fun unreachable(message: String) = UNREACHABLE.containsMatchIn(message)
