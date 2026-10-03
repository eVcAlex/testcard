package com.evcalex.testcard.tv

import android.content.Context
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.db.MAIN_PROFILE
import com.evcalex.testcard.core.db.PROFILE_META_KEYS
import com.evcalex.testcard.core.db.Profile
import com.evcalex.testcard.core.db.deleteProfile
import com.evcalex.testcard.core.db.forgetProfile
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.query
import com.evcalex.testcard.core.db.readActiveProfile
import com.evcalex.testcard.core.db.readProfiles
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.db.saveProfile
import com.evcalex.testcard.core.db.swapProfile
import com.evcalex.testcard.core.db.writeActiveProfile
import com.evcalex.testcard.core.guide.GuideImporter
import com.evcalex.testcard.core.guide.GuideRepository
import com.evcalex.testcard.core.importing.CatalogueEvents
import com.evcalex.testcard.core.importing.CatalogueSource
import com.evcalex.testcard.core.importing.SlicePacing
import com.evcalex.testcard.core.importing.importCatalogue
import com.evcalex.testcard.core.importing.reclassifyCategories
import com.evcalex.testcard.core.playback.CaptionPrefs
import com.evcalex.testcard.core.playback.DEFAULT_CAPTIONS
import com.evcalex.testcard.core.playback.readAudioLanguage
import com.evcalex.testcard.core.playback.readCaptionPrefs
import com.evcalex.testcard.core.playback.writeAudioLanguage
import com.evcalex.testcard.core.playback.writeCaptionPrefs
import com.evcalex.testcard.core.setup.ContentKind
import com.evcalex.testcard.core.setup.ImportProgress
import com.evcalex.testcard.core.setup.ImportStage
import com.evcalex.testcard.core.setup.SetupProgress
import com.evcalex.testcard.core.setup.Wants
import com.evcalex.testcard.core.setup.describeSetup
import com.evcalex.testcard.core.sync.ServerPicker
import com.evcalex.testcard.core.sync.SourceDraft
import com.evcalex.testcard.core.sync.SourceLogins
import com.evcalex.testcard.core.sync.SyncAccount
import com.evcalex.testcard.core.sync.SyncController
import com.evcalex.testcard.core.sync.SyncStatus
import com.evcalex.testcard.core.sync.removeSourceRows
import com.evcalex.testcard.core.sync.saveSource
import com.evcalex.testcard.core.xtream.SourceAccounts
import com.evcalex.testcard.core.xtream.XtreamApi
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.tv.platform.Adoption
import com.evcalex.testcard.tv.platform.KeystoreSecrets
import com.evcalex.testcard.tv.platform.Updater
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient

/** Something a source's last import could not load: its movies, its series, or (a thrown import) all of it. */
class SourceFailure(val part: String, val message: String)

class SourceSummary(
    val id: String,
    val name: String,
    val kind: String,
    val lastRefreshedAt: Long?,
    val channels: Int,
    val movies: Int,
    val series: Int,
    val refreshing: Boolean,
    /** Empty unless the last import failed, in part or whole. */
    val failures: List<SourceFailure>,
)

/** The launch catch-up holds the app at most this long; after that it carries on with "Syncing" in the nav bar. */
internal const val LAUNCH_SYNC_WAIT_MS = 10_000L

/** And the getting-ready screen stays at least this long once it is up, so a quick sync does not flash it. */
private const val LAUNCH_SYNC_SHOW_MS = 700L

/** How long after launch the TV guides are looked at. */
private const val GUIDES_AFTER_LAUNCH_MS = 60_000L

/** How long after launch sources with backup addresses are checked. */
private const val SERVERS_AFTER_LAUNCH_MS = 10_000L

/** Where the source pick is kept between launches: this device's own setting, not synced. */
private const val SOURCE_PICK_KEY = "ui:source"

/**
 * Owns the database and the sync loop for the life of the app (`state/app.tsx`). Every field the screens read is Compose
 * state; every operation runs on a background dispatcher. The screens re-read their data when [version] changes.
 */
class AppController(context: Context) {
    private val appContext = context.applicationContext
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // Built on first use: creating a client loads TLS and is a slow call StrictMode rightly refuses on the main thread.
    val http: OkHttpClient by lazy { OkHttpClient() }
    val secrets = KeystoreSecrets(appContext)
    val logins = SourceLogins(secrets)
    val db = Db({ Adoption.databaseFile(appContext).path }) { check(Looper.myLooper() != Looper.getMainLooper()) { "Database call on the main thread" } }

    val updates = Updater(appContext, { http }, db, scope)

    lateinit var sync: SyncController
        private set
    lateinit var guides: GuideRepository
        private set
    lateinit var guideImporter: GuideImporter
        private set
    lateinit var servers: ServerPicker
        private set
    lateinit var accounts: SourceAccounts
        private set

    /** False until the database is open and the first reads are in: the splash shows until then. */
    var ready by mutableStateOf(false)
        private set
    var status by mutableStateOf(SyncStatus(SyncAccount.SignedOut))
        internal set

    /** Bumps whenever stored data may have changed (sync applied, a source imported), so screens re-query. */
    var version by mutableIntStateOf(0)
        private set

    /**
     * Changes only when the catalogue does (a source imported, added or removed), never for favourites or progress. Reads
     * that walk the whole catalogue key on this, so a sync that only brought history does not rebuild them.
     */
    var catalogue by mutableStateOf("")
        private set
    var sources by mutableStateOf<List<SourceSummary>>(emptyList())
        private set

    /** True while the app is catching up with the account on launch or on coming back to the front. */
    var syncing by mutableStateOf(false)
        internal set
    private var launching by mutableStateOf(false)
    internal var progress by mutableStateOf<Map<String, ImportProgress>>(emptyMap())
    internal var errors by mutableStateOf<Map<String, List<SourceFailure>>>(emptyMap())
    internal var refreshing by mutableStateOf<Set<String>>(emptySet())
    var captions by mutableStateOf(DEFAULT_CAPTIONS)
        internal set
    var audioLanguage by mutableStateOf<String?>(null)
        internal set
    var profiles by mutableStateOf<List<Profile>>(emptyList())
        private set
    internal var profileId by mutableStateOf(MAIN_PROFILE)
    val profile: Profile get() = profiles.firstOrNull { it.id == profileId } ?: profiles.firstOrNull() ?: Profile(MAIN_PROFILE, "Main", 0, null, null, 0)
    var sourcePick by mutableStateOf<String?>(null)
        private set

    /** The "getting ready" screen: shown while a signed-in device waits for its first sync and while anything imports. */
    val setup: SetupProgress?
        get() {
            val signedIn = status.account == SyncAccount.SignedIn
            val waitingForSources = sources.isEmpty() && status.lastSyncedAt == null && status.lastError == null
            val firstSync = signedIn && (waitingForSources || progress.isNotEmpty())
            return describeSetup(firstSync, signedIn && launching, progress.values.toList())
        }

    /** When the remote was last used: a key press shortly before means the viewer is moving around, so an import waits its turn. */
    @Volatile var lastKeyAt = 0L

    internal val inFlight = HashMap<String, Deferred<Unit>>()
    private val importing get() = synchronized(inFlight) { inFlight.isNotEmpty() }

    init {
        SlicePacing.pauseBeforeSliceMs = { if (nowMs() - lastKeyAt < BUSY_FOR_MS) WAIT_MS else 0L }
        scope.launch { open() }
    }

    private suspend fun open() {
        val client = withContext(Dispatchers.Default) { http }
        val syncScope = CoroutineScope(SupervisorJob() + Dispatchers.Default.limitedParallelismOne())
        servers = ServerPicker(db, logins, client)
        accounts = SourceAccounts(logins, client)
        guides = GuideRepository(db, logins, client, scope)
        // Maintenance of what the importers stored (new classifier rules); chunked, so it never freezes the remote.
        scope.launch { runCatching { reclassifyCategories(db) } }
        servers.loadServersInUse()
        val first = db.write { it.readActiveProfile() }
        profiles = db.write { it.readProfiles() }
        profileId = first
        captions = db.read { it.readCaptionPrefs() }
        audioLanguage = db.read { it.readAudioLanguage() }
        sourcePick = db.read { connection -> connection.one("SELECT value FROM schema_meta WHERE key = ?", SOURCE_PICK_KEY) { it.getText(0) }?.takeIf { it != "" } }
        // An update in place from the React Native app brings its logins along before sync looks for them.
        runCatching { Adoption.adoptSecrets(appContext, db, secrets) }
        sync = SyncController(db, logins, secrets, syncScope, baseUrl = BuildConfig.SYNC_URL, http = client, onSourcesAdded = { ids -> ids.forEach { id -> scope.launch { refreshSource(id) } } }, profile = first)
        guideImporter = GuideImporter(db, client, scope, { sync.registerGuide(it) }, guides, { importing }, { bump() }, "${BuildConfig.SYNC_URL}/app")
        reloadSources()
        sync.start()
        status = sync.status.value
        launching = status.account == SyncAccount.SignedIn
        ready = true
        updates.start()
        scope.launch {
            var seen: Long? = null
            sync.status.collect { next ->
                status = next
                if (next.lastChangedAt != seen) {
                    seen = next.lastChangedAt
                    bump()
                    // A guide address set on another device is read as soon as it arrives.
                    guideImporter.refresh()
                }
            }
        }
        catchUp(onLaunch = true)
        scope.launch {
            delay(SERVERS_AFTER_LAUNCH_MS)
            for (id in servers.sourcesWithBackups()) runCatching { servers.pickServer(id) }
            bump()
        }
        scope.launch {
            delay(GUIDES_AFTER_LAUNCH_MS)
            if (!importing) runCatching { guideImporter.dropUnusedGuides() }
            guideImporter.refresh()
        }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun kotlinx.coroutines.CoroutineDispatcher.limitedParallelismOne() = limitedParallelism(1)

    /** The app came back to the front: catch up with the account at once, and look at the guides. */
    fun onForeground() {
        if (!ready) return
        catchUp(onLaunch = false)
        guideImporter.refresh()
        updates.onForeground()
    }

    private fun catchUp(onLaunch: Boolean) {
        if (status.account != SyncAccount.SignedIn) {
            if (onLaunch) launching = false
            return
        }
        syncing = true
        val shownFrom = nowMs()
        val cap = if (onLaunch) scope.launch { delay(LAUNCH_SYNC_WAIT_MS); launching = false } else null
        scope.launch {
            try { sync.triggerNow() } catch (_: Exception) { }
            status = sync.status.value
            bump()
            syncing = false
            if (!onLaunch) return@launch
            cap?.cancel()
            delay(maxOf(0L, LAUNCH_SYNC_SHOW_MS - (nowMs() - shownFrom)))
            launching = false
        }
    }

    /** The last rows each screen built, by name, so coming back to a section shows them at once while the fresh ones are read. */
    val rowsCache = java.util.concurrent.ConcurrentHashMap<String, Any>()

    private val memo = java.util.concurrent.ConcurrentHashMap<String, Pair<String, Any?>>()

    /** A read that walks the whole catalogue is made once per catalogue stamp (an import), not on every visit. */
    suspend fun <T> memoByCatalogue(name: String, sourceId: String?, build: (androidx.sqlite.SQLiteConnection) -> T): T {
        val key = "$name|${sourceId ?: ""}"
        val stamp = catalogue
        memo[key]?.let { if (it.first == stamp) {
            @Suppress("UNCHECKED_CAST")
            return it.second as T
        } }
        val built = db.read(build)
        memo[key] = stamp to built
        return built
    }

    /** The provider API for one source's login (on the backup server in use, if any). */
    fun api(sourceId: String) = XtreamApi({ logins.current(sourceId) }, http)

    // ---- reading what the shell shows

    private suspend fun reloadSources() {
        class Row(val id: String, val kind: String, val name: String, val lastRefreshedAt: Long?)
        val (rows, counts, hidden) = db.read { c ->
            val rows = c.query("SELECT id, kind, name, last_refreshed_at FROM sources ORDER BY sort_order IS NULL, sort_order, created_at") { Row(it.getText(0), it.getText(1), it.getText(2), if (it.isNull(3)) null else it.getLong(3)) }
            // One grouped query per table instead of one COUNT per source.
            fun counts(table: String) = c.query("SELECT source_id, COUNT(*) FROM $table GROUP BY source_id") { it.getText(0) to it.getLong(1).toInt() }.toMap()
            val hiddenStamp = c.one(
                "SELECT (SELECT COUNT(*) || '.' || COALESCE(MAX(hidden_at), 0) FROM hidden_categories) || '/' || (SELECT COUNT(*) || '.' || COALESCE(MAX(hidden_at), 0) FROM hidden_channels)",
            ) { it.getText(0) } ?: ""
            Triple(rows, listOf(counts("channels"), counts("movies"), counts("series")), hiddenStamp)
        }
        val summaries = rows.map { Row ->
            SourceSummary(Row.id, Row.name, Row.kind, Row.lastRefreshedAt, counts[0][Row.id] ?: 0, counts[1][Row.id] ?: 0, counts[2][Row.id] ?: 0, Row.id in refreshing, errors[Row.id].orEmpty())
        }
        sources = summaries
        // Hiding a category or channel (here or on another device) changes what the lists hold, so it is part of the key.
        catalogue = "${summaries.joinToString(",") { "${it.id}:${it.lastRefreshedAt ?: 0}" }}|$hidden"
        profiles = db.write { it.readProfiles() }
    }

    /** Re-reads what the shell shows, then tells the screens to re-query. */
    fun bump() {
        scope.launch {
            reloadSources()
            version += 1
        }
    }

    // ---- account

    suspend fun signIn(email: String, password: String) {
        sync.signIn(email, password)
        status = sync.status.value
        launching = false
        bump()
    }

    suspend fun signUp(email: String, password: String) {
        sync.signUp(email, password)
        status = sync.status.value
        launching = false
        bump()
    }

    suspend fun signOut() {
        sync.signOut()
        status = sync.status.value
        bump()
    }

    /** Debug builds only: signs in (or up) a throwaway account on the dev server and adds the fake provider's sources. */
    suspend fun devSeed(spec: String) {
        val (email, password, server) = spec.split("|")
        while (!ready) delay(100)
        if (status.account != SyncAccount.SignedIn) try { signIn(email, password) } catch (_: Exception) { signUp(email, password) }
        if (sources.isEmpty()) {
            saveSource(null, SourceDraft("xtream", "Panel", server, "u", "p"))
            saveSource(null, SourceDraft("m3u", "Playlist", playlistUrl = "$server/main.m3u"))
        }
    }

    // ---- this device's settings

    fun changeCaptions(prefs: CaptionPrefs) {
        captions = prefs
        scope.launch { db.write { it.writeCaptionPrefs(prefs) } }
    }

    fun changeAudioLanguage(language: String?) {
        audioLanguage = language
        scope.launch { db.write { it.writeAudioLanguage(language) } }
    }

    fun pickSource(id: String?) {
        sourcePick = id
        scope.launch { db.write { it.run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)", SOURCE_PICK_KEY, id ?: "") } }
    }

    private companion object {
        const val BUSY_FOR_MS = 600L
        const val WAIT_MS = 120L
    }

}
