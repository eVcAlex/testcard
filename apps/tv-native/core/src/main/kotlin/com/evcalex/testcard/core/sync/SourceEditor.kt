package com.evcalex.testcard.core.sync

import androidx.sqlite.SQLiteConnection
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.db.textOrNull
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.xtream.extractXtreamCredentials
import com.evcalex.testcard.core.xtream.hostWithPort
import com.evcalex.testcard.core.xtream.probeXtream
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Adding and editing a source on the TV, as the desktop app's source form does (`state/sourceEdit.ts`): the login is
 * checked with the provider before it is kept, and the change syncs to the account's other devices.
 */

/** A source as the form edits it. `password` is blank while editing unless a new one is typed. */
data class SourceDraft(
    val kind: String,
    val name: String = "",
    val server: String = "",
    val username: String = "",
    val password: String = "",
    /** A playlist link; for a new source, a whole Xtream `get.php` link is taken as its login. */
    val playlistUrl: String = "",
    val epgUrl: String = "",
    /** Xtream: other server addresses for the same account, comma or space separated as typed. */
    val backupUrls: String = "",
    val content: SourceContent = SourceContent(live = true, movies = true, series = true),
)

fun emptyDraft(kind: String) = SourceDraft(kind)

/** A validation or provider failure, in words fit to show. */
class SourceEditError(message: String) : Exception(message)

suspend fun readDraft(db: Db, logins: SourceLogins, sourceId: String): SourceDraft? {
    class Row(val kind: String, val name: String, val playlistUrl: String?, val epgUrl: String?, val backupUrls: String?, val live: Boolean, val movies: Boolean, val series: Boolean)
    val row = db.read {
        it.one(
            "SELECT kind, name, playlist_url, epg_url, backup_urls, include_live, include_movies, include_series FROM sources WHERE id = ?", sourceId,
        ) { r -> Row(r.getText(0), r.getText(1), r.textOrNull(2), r.textOrNull(3), r.textOrNull(4), r.getLong(5) != 0L, r.getLong(6) != 0L, r.getLong(7) != 0L) }
    } ?: return null
    val login = if (row.kind == "xtream") runCatching { logins.stored(sourceId) }.getOrNull() else null
    return SourceDraft(
        kind = row.kind,
        name = row.name,
        server = login?.baseUrl ?: "",
        username = login?.username ?: "",
        password = "",
        playlistUrl = row.playlistUrl ?: "",
        epgUrl = row.epgUrl ?: "",
        backupUrls = parseBackupUrls(row.backupUrls).joinToString(", "),
        content = SourceContent(row.live, row.movies, row.series),
    )
}

/** Just the scheme and host of a server address, so a whole pasted provider link still works. */
fun serverAddress(input: String): String {
    val trimmed = input.trim()
    val parsed: HttpUrl = (if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) trimmed else "http://$trimmed").toHttpUrlOrNull()
        ?: throw SourceEditError("That's not a server address.")
    return "${parsed.scheme}://${hostWithPort(parsed)}"
}

private suspend fun checkLogin(login: XtreamLogin, http: OkHttpClient) {
    val authenticated = try {
        probeXtream(login, http)
    } catch (error: java.io.IOException) {
        throw SourceEditError("Couldn't reach that server. Check the address.")
    }
    if (!authenticated) throw SourceEditError("The provider turned down that username and password.")
}

private suspend fun checkPlaylist(input: String, http: OkHttpClient): String {
    val url = input.trim()
    val parsed = url.toHttpUrlOrNull() ?: throw SourceEditError(if (Regex("^[a-z][a-z0-9+.-]*:", RegexOption.IGNORE_CASE).containsMatchIn(url) && !url.startsWith("http", ignoreCase = true)) "A playlist link starts with http:// or https://." else "That's not a playlist link.")
    val response = try {
        http.newCall(Request.Builder().url(parsed).header("User-Agent", "node").build()).await()
    } catch (error: java.io.IOException) {
        throw SourceEditError("Couldn't reach that playlist. Check the link.")
    }
    response.use { if (!it.isSuccessful) throw SourceEditError("The playlist link answered with HTTP ${it.code}.") }
    return url
}

private fun checkGuide(input: String): String? {
    val url = input.trim()
    if (url == "") return null
    if (url.toHttpUrlOrNull() != null) return url
    throw SourceEditError("The TV guide address must be a link starting with http:// or https://.")
}

class SavedSource(val id: String, /** The login, link or content switched on changed: its channels and titles are loaded again. */ val reload: Boolean)

/** Checks and keeps a new source (`sourceId` null) or a change to one. Throws [SourceEditError] with a message fit to show. */
suspend fun saveSource(db: Db, logins: SourceLogins, http: OkHttpClient, sourceId: String?, draft: SourceDraft, newId: () -> String): SavedSource {
    val name = draft.name.trim()
    if (name == "") throw SourceEditError("Give the source a name.")
    if (!draft.content.live && !draft.content.movies && !draft.content.series) throw SourceEditError("Choose at least one of Live TV, Movies and Series.")
    val epg = checkGuide(draft.epgUrl)
    val backups = JsonArray(
        draft.backupUrls.split(Regex("[\\s,]+")).filter { it != "" }.map { entry ->
            try { serverAddress(entry) } catch (_: SourceEditError) { throw SourceEditError("\"$entry\" is not a server address.") }
        }.distinct().map { JsonPrimitive(it) },
    ).toString()
    val now = nowMs()

    // A whole Xtream link pasted as a new playlist is an Xtream login.
    val pasted = if (sourceId == null && draft.kind == "m3u") extractXtreamCredentials(draft.playlistUrl.trim()) else null
    val kind = if (pasted != null) "xtream" else draft.kind

    if (sourceId == null) {
        val id = newId()
        if (kind == "xtream") {
            val login = pasted ?: XtreamLogin(serverAddress(draft.server), draft.username.trim(), draft.password)
            if (login.username == "" || login.password == "") throw SourceEditError("Enter the username and password.")
            checkLogin(login, http)
            logins.save(id, login)
            db.write {
                it.run(
                    "INSERT INTO sources (id, kind, name, base_url, epg_url, backup_urls, created_at, remote_key, sync_updated_at) VALUES (?, 'xtream', ?, ?, ?, ?, ?, ?, ?)",
                    id, name, login.baseUrl, epg, backups, now, remoteKeyFor(login.baseUrl, "source"), now,
                )
            }
        } else {
            val url = checkPlaylist(draft.playlistUrl, http)
            db.write {
                it.run(
                    "INSERT INTO sources (id, kind, name, playlist_url, epg_url, created_at, remote_key, sync_updated_at) VALUES (?, 'm3u', ?, ?, ?, ?, ?, ?)",
                    id, name, url, epg, now, remoteKeyForPlaylist(url), now,
                )
            }
        }
        db.write { it.applySourceContent(id, draft.content) }
        return SavedSource(id, true)
    }

    class Row(val kind: String, val playlistUrl: String?)
    val row = db.read { it.one("SELECT kind, playlist_url FROM sources WHERE id = ?", sourceId) { r -> Row(r.getText(0), r.textOrNull(1)) } } ?: throw SourceEditError("This source was removed.")
    var reload = false

    if (row.kind == "xtream") {
        val current = runCatching { logins.stored(sourceId) }.getOrNull()
        val login = XtreamLogin(
            serverAddress(draft.server),
            draft.username.trim().ifEmpty { current?.username ?: "" },
            if (draft.password != "") draft.password else (current?.password ?: ""),
        )
        if (login.username == "" || login.password == "") throw SourceEditError("Enter the username and password.")
        if (current == null || login != current) {
            checkLogin(login, http)
            logins.save(sourceId, login)
            reload = true
        }
        // Only the login changes: the source keeps its identity (its key on the account and the address its history is
        // matched by), so a provider that moved keeps its favourites, progress and Continue watching.
        db.write { it.run("UPDATE sources SET name = ?, epg_url = ?, backup_urls = ?, sync_updated_at = ? WHERE id = ?", name, epg, backups, now, sourceId) }
    } else {
        var url = row.playlistUrl ?: ""
        if (draft.playlistUrl.trim() != url) {
            if (extractXtreamCredentials(draft.playlistUrl.trim()) != null) throw SourceEditError("That's an Xtream link. Remove this source and add it again as an Xtream login.")
            url = checkPlaylist(draft.playlistUrl, http)
            reload = true
        }
        // The source keeps its key on the account, so the other devices update it rather than add another.
        db.write { it.run("UPDATE sources SET name = ?, playlist_url = ?, epg_url = ?, sync_updated_at = ? WHERE id = ?", name, url, epg, now, sourceId) }
    }
    if (db.write { it.applySourceContent(sourceId, draft.content) }) reload = true
    return SavedSource(sourceId, reload)
}
