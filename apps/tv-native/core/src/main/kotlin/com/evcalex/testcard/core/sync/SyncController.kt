package com.evcalex.testcard.core.sync

import com.evcalex.testcard.core.SecretStore
import com.evcalex.testcard.core.crypto.AccountKeys
import com.evcalex.testcard.core.crypto.Base64
import com.evcalex.testcard.core.crypto.randomBytes
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.MAIN_PROFILE
import com.evcalex.testcard.core.db.applySourceHidden
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.db.textOrNull
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient

enum class SyncAccount { SignedOut, SignedIn, NeedsPassword }

class SyncStatus(
    val account: SyncAccount,
    val email: String? = null,
    val lastSyncedAt: Long? = null,
    /** When a sync last brought in anything new from the account. Screens re-read their data on this, not on every sync. */
    val lastChangedAt: Long? = null,
    val lastError: String? = null,
    /** Set while syncing is held off (the TV app, while a profile other than the account's own is watching). */
    val paused: Boolean = false,
)

/** Where the account password is kept between launches (the secret store, under this key). */
const val ACCOUNT_SECRET = "account"

private const val PERIODIC_INTERVAL_MS = 60_000L

/** Local edits sync shortly after they happen, but never more often than this: playback progress is written every few seconds while watching. */
private const val CHANGE_SYNC_DELAY_MS = 3000L
private const val CHANGE_SYNC_MIN_GAP_MS = 15_000L

/** A sign-in or sign-up that failed, in words a person can act on. */
class AuthFailure(message: String) : Exception(message)

/** Sign-in / sign-up failures, in words a person can act on. */
internal fun authFailure(error: Throwable, action: String): AuthFailure {
    val status = (error as? ApiException)?.status ?: return AuthFailure("Can't reach the sync server. Check your connection and try again.")
    val detail = serverMessage(error)
    if (action == "signIn" && (status == 401 || status == 400)) return AuthFailure("That email and password don't match an account.")
    if (action == "signUp" && (status == 422 || status == 409)) return AuthFailure("An account with that email already exists. Sign in instead.")
    if (status >= 500) return AuthFailure("The sync server had a problem. Try again in a moment.")
    return AuthFailure(detail ?: "That didn't work. Check your details and try again.")
}

/** Turns a transport/HTTP error into something a person can act on (never raw JSON). */
internal fun describeSyncError(error: Throwable): String {
    val status = (error as? ApiException)?.status
    if (status == 401) return "Sync isn't authorised. Sign in again."
    if (status != null && status >= 500) return "The sync server had a problem. It will retry shortly."
    if (status == null) return "Can't reach the sync server. It will retry shortly."
    return error.message?.takeIf { it.isNotEmpty() } ?: "Sync failed."
}

/**
 * Owns the account password, used to derive the credential-encryption key. The password is kept in memory and in the
 * secret store, so a relaunch resumes syncing without a new sign-in. The session token, account email and PBKDF2 salt
 * live in `sync_state`. All state is touched on `scope`'s dispatcher (give it a single-threaded one); the database and
 * the network are reached through suspend calls (`syncController.ts`).
 *
 * `onSourcesAdded` is called with the ids of sources that arrived from another device, so they can be imported right away.
 */
class SyncController(
    private val db: Db,
    private val logins: SourceLogins,
    private val secrets: SecretStore,
    private val scope: CoroutineScope,
    baseUrl: String = SYNC_BASE_URL,
    http: OkHttpClient = OkHttpClient(),
    private val keys: AccountKeys = AccountKeys(),
    private val onSourcesAdded: (List<String>) -> Unit = {},
    paused: Boolean = false,
    profile: String = MAIN_PROFILE,
    private val now: () -> Long = ::nowMs,
    private val randomId: () -> String = { UUID.randomUUID().toString() },
) {
    /** The session token the API sends: set by `signIn` and read by every authed call. */
    @Volatile private var sessionToken: String? = null
    private val api = SyncApi(baseUrl, http) { sessionToken }

    private var accountPassword: String? = null
    private var salt: String? = null
    private var accountEmail: String? = null
    private var lastError: String? = null
    private var lastSyncedAt: Long? = null
    private var lastChangedAt: Long? = null
    private var running: Job? = null
    private var rerunRequested = false
    private var changeJob: Job? = null
    private var periodicJob: Job? = null
    private var lastRunStartedAt = 0L
    private var paused = paused
    /** Whose rows are in the tables now: theirs are the rows pushed and pulled. */
    private var profile = profile

    private val statusFlow = MutableStateFlow(SyncStatus(SyncAccount.SignedOut, paused = paused))
    val status: StateFlow<SyncStatus> get() = statusFlow

    private fun publish() {
        val email = accountEmail
        statusFlow.value = when {
            email == null -> SyncStatus(SyncAccount.SignedOut, lastError = lastError)
            accountPassword == null -> SyncStatus(SyncAccount.NeedsPassword, email = email, lastError = lastError)
            else -> SyncStatus(SyncAccount.SignedIn, email, lastSyncedAt, lastChangedAt, lastError, paused)
        }
    }

    /** Resumes a previous session (no sign-in needed after a relaunch) and starts syncing. Call once, after construction. */
    suspend fun start() {
        val row = db.write { it.one("SELECT sync_salt, account_email, session_token FROM sync_state WHERE id = 1") { r -> Triple(r.textOrNull(0), r.textOrNull(1), r.textOrNull(2)) } }
        salt = row?.first
        accountEmail = row?.second
        sessionToken = row?.third
        if (accountEmail != null) {
            accountPassword = secrets.get(ACCOUNT_SECRET)
            if (accountPassword != null && salt != null) {
                startPeriodicSync()
                scope.launch { runOnce() }
            }
        }
        publish()
    }

    /** Call after any local change to synced data. Coalesced: one sync shortly after, rate-limited. */
    fun notifyLocalChange() {
        if (paused || accountPassword == null || changeJob != null) return
        val wait = maxOf(CHANGE_SYNC_DELAY_MS, lastRunStartedAt + CHANGE_SYNC_MIN_GAP_MS - now())
        changeJob = scope.launch {
            delay(wait)
            changeJob = null
            runOnce()
        }
    }

    /**
     * Holds syncing off, or lets it run again (with a sync straight away). Pausing waits for a sync already under way to
     * finish, so once it returns nothing more is read from or written to the synced tables until resumed.
     */
    suspend fun setPaused(paused: Boolean) {
        this.paused = paused
        if (paused) {
            changeJob?.cancel()
            changeJob = null
            rerunRequested = false
            // A sync waiting on the network is cut off rather than waited for; one past that point (writing what it
            // pulled) finishes, so nothing is left half-applied.
            api.abortAll()
            running?.join()
        } else scope.launch { runOnce() }
        publish()
    }

    /** Call, paused, after swapping another profile's rows in; the next sync pushes and pulls theirs. */
    fun setProfile(profile: String) {
        this.profile = profile
    }

    /** Registers a public guide address and answers the name of its file; null when signed out or the Worker will not have it. */
    suspend fun registerGuide(url: String): String? {
        if (sessionToken == null) return null
        return try { api.registerGuide(url) } catch (error: Exception) { if (error is CancellationException) throw error else null }
    }

    suspend fun signUp(email: String, password: String): SyncStatus {
        val result = try { api.signUp(email, password) } catch (error: Exception) { if (error is CancellationException) throw error else throw authFailure(error, "signUp") }
        // Persist the token before any authenticated call: the API reads it back, so setSalt would otherwise go out with no Bearer token and 401.
        persistToken(email, result.sessionToken)
        val newSalt = generateSalt()
        api.setSalt(newSalt) // set-once; safe even if a retry races
        finaliseSession(password, newSalt)
        startPeriodicSync()
        runOnce()
        return statusFlow.value
    }

    suspend fun signIn(email: String, password: String): SyncStatus {
        val result = try { api.signIn(email, password) } catch (error: Exception) { if (error is CancellationException) throw error else throw authFailure(error, "signIn") }
        persistToken(email, result.sessionToken)
        var accountSalt = api.getSalt()
        if (accountSalt == null) {
            // Defensive fallback only: every account should have set one during signUp.
            accountSalt = generateSalt()
            api.setSalt(accountSalt)
        }
        finaliseSession(password, accountSalt)
        startPeriodicSync()
        runOnce()
        return statusFlow.value
    }

    suspend fun signOut(): SyncStatus {
        try { api.signOut() } catch (error: Exception) { if (error is CancellationException) throw error } // best-effort: sign the device out locally regardless
        lastError = null
        forgetSession()
        return statusFlow.value
    }

    suspend fun triggerNow(): SyncStatus {
        runOnce()
        return statusFlow.value
    }

    suspend fun reenterPassword(password: String): SyncStatus {
        accountPassword = password
        secrets.put(ACCOUNT_SECRET, password)
        startPeriodicSync()
        runOnce()
        publish()
        return statusFlow.value
    }

    private fun generateSalt(): String = Base64.encode(randomBytes(16))

    private suspend fun persistToken(email: String, token: String) {
        db.write {
            it.run("INSERT OR IGNORE INTO sync_state (id, last_pulled_at, last_pushed_at) VALUES (1, 0, 0)")
            it.run("UPDATE sync_state SET account_email = ?, session_token = ? WHERE id = 1", email, token)
        }
        accountEmail = email
        sessionToken = token
    }

    private suspend fun finaliseSession(password: String, accountSalt: String) {
        db.write { it.run("UPDATE sync_state SET sync_salt = ? WHERE id = 1", accountSalt) }
        secrets.put(ACCOUNT_SECRET, password)
        accountPassword = password
        salt = accountSalt
        publish()
    }

    /** Drops the local session (token, password, salt, cursors) without telling the server. */
    private suspend fun forgetSession() {
        accountPassword = null
        salt = null
        accountEmail = null
        sessionToken = null
        lastSyncedAt = null
        lastChangedAt = null
        secrets.remove(ACCOUNT_SECRET)
        changeJob?.cancel()
        changeJob = null
        periodicJob?.cancel()
        periodicJob = null
        db.write { it.run("UPDATE sync_state SET account_email = NULL, session_token = NULL, sync_salt = NULL, last_pulled_at = 0, last_pushed_at = 0 WHERE id = 1") }
        publish()
    }

    private fun startPeriodicSync() {
        periodicJob?.cancel()
        periodicJob = scope.launch {
            while (true) {
                delay(PERIODIC_INTERVAL_MS)
                try { runOnce() } catch (error: Exception) { if (error is CancellationException) throw error }
            }
        }
    }

    /** One sync at a time; a request that arrives mid-run triggers exactly one follow-up run. */
    private suspend fun runOnce() {
        if (paused) return
        running?.let {
            rerunRequested = true
            it.join()
            return
        }
        val job = scope.launch {
            try {
                do {
                    rerunRequested = false
                    if (paused) break
                    lastRunStartedAt = now()
                    syncCycle(true)
                } while (rerunRequested)
            } finally {
                running = null
            }
        }
        running = job
        job.join()
    }

    /** Session tokens expire; with the stored password we can quietly sign in again instead of asking. */
    private suspend fun reauthenticate(): String {
        val email = accountEmail
        val password = accountPassword
        if (email == null || password == null) return "rejected"
        return try {
            persistToken(email, api.signIn(email, password).sessionToken)
            "ok"
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            // The server answered and said no (unknown account, wrong password): the session is gone for good. No answer
            // at all (offline) is temporary: keep the session and retry next tick.
            val status = (error as? ApiException)?.status
            if (status != null && status in 400..499) "rejected" else "unreachable"
        }
    }

    private suspend fun syncCycle(allowReauth: Boolean) {
        val password = accountPassword ?: return
        val accountSalt = salt ?: return // signed out, or no stored password available
        try {
            val key = withContext(Dispatchers.Default) { keys.keyFor(password, accountSalt) }
            val state = db.write { it.getSyncState() }
            val currentProfile = profile
            val push = db.write { it.collectLocalChanges(state.lastPushedAt, key, { sourceId -> logins.stored(sourceId) }, currentProfile) }
            val pushResult = api.push(push)
            db.write {
                it.setSyncState(lastPushedAt = maxOf(state.lastPushedAt, pushResult.newCursor))
                it.clearTombstones(push.newestDeletion)
            }

            // Devices before this change ignored a source edited elsewhere (a rename, new login, content switches). Read the
            // account's sources once from the start so edits already made are picked up; applying them again is harmless.
            val reread = db.write { it.one("SELECT 1 FROM schema_meta WHERE key = 'sync_source_edits_reread'") { r -> r.getLong(0) } } == null
            val pull = api.pull(if (reread) 0 else state.lastPulledAt, if (currentProfile == MAIN_PROFILE) null else currentProfile)
            val addedSourceIds = ArrayList<String>()
            val deferred = db.write { connection ->
                connection.applyRemoteChanges(
                    pull, key,
                    onDecryptedSource = { remoteKey, label, payload, updatedAt -> applySource(connection, remoteKey, label, payload, updatedAt, currentProfile, addedSourceIds) },
                    onRemovedSource = { remoteKey, deletedAt ->
                        val existing = connection.one("SELECT id, sync_updated_at FROM sources WHERE remote_key = ?", remoteKey) { r -> r.getText(0) to (if (r.isNull(1)) null else r.getLong(1)) }
                        // A source added again here after it was removed elsewhere is newer than the removal: keep it.
                        if (existing != null && !(existing.second != null && existing.second!! > deletedAt)) {
                            connection.removeSourceRows(existing.first, recordTombstone = false)
                            logins.delete(existing.first)
                        }
                    },
                    profile = currentProfile,
                )
            }
            val nextPulledAt = if (deferred != null) minOf(pull.serverCursor, deferred - 1) else pull.serverCursor
            db.write {
                it.setSyncState(lastPulledAt = nextPulledAt)
                if (reread) it.run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('sync_source_edits_reread', '1')")
            }
            lastSyncedAt = now()
            lastError = null
            if (pull.count > 0) lastChangedAt = now()
            publish()
            if (addedSourceIds.isNotEmpty()) onSourcesAdded(addedSourceIds)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            if (allowReauth && (error as? ApiException)?.status == 401) {
                when (reauthenticate()) {
                    "ok" -> return syncCycle(false)
                    "rejected" -> {
                        // The account this device was signed in to no longer exists (or the password changed). Say so and go
                        // back to the sign-in form instead of failing forever.
                        forgetSession()
                        lastError = "Your session expired. Sign in again to keep syncing."
                        publish()
                        return
                    }
                }
            }
            // Cut off on purpose by a pause (see setPaused): not a failure to show.
            if (!paused) lastError = describeSyncError(error)
            publish()
            // Best-effort: a failed sync never blocks playback or browsing. The next periodic tick (or a manual triggerNow) retries.
        }
    }

    /** Takes one decrypted source: an edit to one this device has (id kept), or a new one. */
    private fun applySource(connection: androidx.sqlite.SQLiteConnection, remoteKey: String, label: String, payload: SourcePayload, updatedAt: Long, currentProfile: String, added: MutableList<String>) {
        val existing = connection.one("SELECT id, sync_updated_at FROM sources WHERE remote_key = ?", remoteKey) { r -> r.getText(0) to (if (r.isNull(1)) null else r.getLong(1)) }
        if (existing != null) {
            // Already configured here: the id stays, but a newer edit made elsewhere (a rename, new login, content switches) is taken.
            if (existing.second != null && existing.second!! >= updatedAt) return
            val id = existing.first
            if (payload.isPlaylist) {
                connection.run("UPDATE sources SET name = ?, playlist_url = ?, sync_updated_at = ? WHERE id = ?", label, payload.playlistUrl, updatedAt, id)
            } else {
                // The login (and so the server connected to) is taken; the address history is matched by stays, as a source
                // keeps its history when its provider moves.
                logins.save(id, XtreamLogin(payload.host!!, payload.username!!, payload.password!!))
                connection.run("UPDATE sources SET name = ?, base_url = COALESCE(base_url, ?), sync_updated_at = ? WHERE id = ?", label, payload.keyHost ?: payload.host, updatedAt, id)
                if (payload.backupHosts != null) connection.run("UPDATE sources SET backup_urls = ? WHERE id = ?", backupJson(payload.backupHosts), id)
            }
            if (payload.content != null && connection.applySourceContent(id, payload.content)) added += id
            applyExtras(connection, id, payload, currentProfile)
            return
        }
        val id = randomId()
        if (payload.isPlaylist) {
            connection.run("INSERT INTO sources (id, kind, name, playlist_url, created_at, remote_key, sync_updated_at) VALUES (?, 'm3u', ?, ?, ?, ?, ?)", id, label, payload.playlistUrl, now(), remoteKey, updatedAt)
        } else {
            logins.save(id, XtreamLogin(payload.host!!, payload.username!!, payload.password!!))
            connection.run("INSERT INTO sources (id, kind, name, base_url, created_at, remote_key, sync_updated_at) VALUES (?, 'xtream', ?, ?, ?, ?, ?)", id, label, payload.keyHost ?: payload.host, now(), remoteKey, updatedAt)
            if (payload.backupHosts != null) connection.run("UPDATE sources SET backup_urls = ? WHERE id = ?", backupJson(payload.backupHosts), id)
        }
        // Taken with the source's own clock, so this device does not push it back as if it had just edited it.
        if (payload.content != null) connection.applySourceContent(id, payload.content)
        applyExtras(connection, id, payload, currentProfile)
        added += id
    }

    private fun applyExtras(connection: androidx.sqlite.SQLiteConnection, id: String, payload: SourcePayload, currentProfile: String) {
        if (payload.position != null) connection.applySourcePosition(id, payload.position)
        if (payload.pins != null) {
            // Home pins are Main's (they ride in the source's record): with another profile in, they wait for Main.
            if (currentProfile == MAIN_PROFILE) connection.applySourcePins(id, payload.pins) else connection.holdPinsForMain(id, payload.pins)
        }
        if (payload.skips != null) connection.applySourceSkips(id, payload.skips)
        if (payload.epgPresent) connection.run("UPDATE sources SET epg_url = ? WHERE id = ?", payload.epgUrl, id)
        if (payload.hidden != null) connection.applySourceHidden(id, payload.hidden)
    }

    private fun backupJson(hosts: List<String>): String = kotlinx.serialization.json.JsonArray(hosts.map { kotlinx.serialization.json.JsonPrimitive(it) }).toString()

    fun dispose() {
        periodicJob?.cancel()
        changeJob?.cancel()
    }
}

