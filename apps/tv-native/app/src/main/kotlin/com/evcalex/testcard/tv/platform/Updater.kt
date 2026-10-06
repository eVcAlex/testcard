package com.evcalex.testcard.tv.platform

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.evcalex.testcard.core.db.Db
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.db.run
import com.evcalex.testcard.core.update.UpdateInfo
import com.evcalex.testcard.core.update.checkForUpdate
import com.evcalex.testcard.core.update.downloadUpdate
import com.evcalex.testcard.tv.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient

/** "Checking" and "Downloading" are what they say; "Installing" is Android's installer being asked; "Permission" waits for the viewer to allow installs in Settings. */
enum class UpdatePhase { Idle, Checking, Downloading, Installing, Permission, Error }

private const val AUTO_KEY = "update:auto"
private const val SKIPPED_KEY = "update:skipped"
private const val BETA_KEY = "update:beta"

/** How often an app left open, or brought back, looks again. */
private const val RECHECK_MS = 6 * 60 * 60 * 1000L

/** The launch check waits for the app to settle: the first seconds are for the viewer. */
private const val FIRST_CHECK_MS = 8000L

/**
 * Sideloaded apps get no store updates, so the app updates itself: it reads a small manifest and, if that names a newer
 * build, downloads the APK and hands it to Android's installer (`UpdateProvider.tsx`).
 */
class Updater(context: Context, private val http: () -> OkHttpClient, private val db: Db, private val scope: CoroutineScope) {
    private val context = context.applicationContext
    private val installer = Installer(this.context)
    private val baseUrl = "${BuildConfig.SYNC_URL}/app"

    val installedCode = BuildConfig.VERSION_CODE
    val installedName: String = BuildConfig.VERSION_NAME

    var available by mutableStateOf<UpdateInfo?>(null)
        private set
    var phase by mutableStateOf(UpdatePhase.Idle)
        private set
    var progress by mutableStateOf(0f)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    /** True once a check has completed, so "up to date" is not claimed before one has run. */
    var checked by mutableStateOf(false)
        private set

    /** Whether the app looks for new versions by itself (at launch and every few hours) and offers them. */
    var auto by mutableStateOf(true)
        private set

    /** Whether to follow beta builds (published from a branch before they reach main) instead of only releases. */
    var beta by mutableStateOf(false)
        private set

    /** Whether the "new version" dialog is up. */
    var prompting by mutableStateOf(false)
        private set

    private val busy get() = phase == UpdatePhase.Checking || phase == UpdatePhase.Downloading || phase == UpdatePhase.Installing
    private var lastCheck = 0L
    private var started = false

    /** Reads the saved choices, then starts the automatic checks. Called once the database is open. */
    suspend fun start() {
        auto = readMeta(AUTO_KEY) != "0"
        beta = readMeta(BETA_KEY) == "1"
        if (started) return
        started = true
        scope.launch {
            delay(FIRST_CHECK_MS)
            while (true) {
                if (auto) runCheck(offer = true)
                delay(RECHECK_MS)
            }
        }
    }

    private suspend fun readMeta(key: String): String? = runCatching { db.read { c -> c.one("SELECT value FROM schema_meta WHERE key = ?", key) { it.getText(0) } } }.getOrNull()
    private suspend fun writeMeta(key: String, value: String) { runCatching { db.write { it.run("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)", key, value) } } }

    /** [offer]: an automatic check, which opens the dialog for a version the viewer has not put off. */
    private suspend fun runCheck(offer: Boolean) {
        if (busy) return
        lastCheck = nowMs()
        phase = UpdatePhase.Checking
        error = null
        try {
            val info = checkForUpdate(http(), baseUrl, installedCode, BuildConfig.UPDATE_APK_KEY, if (beta) "beta-latest.json" else "latest.json")
            available = info
            checked = true
            phase = UpdatePhase.Idle
            if (info != null && offer && readMeta(SKIPPED_KEY) != info.versionCode.toString()) prompting = true
        } catch (cause: Exception) {
            if (cause is kotlinx.coroutines.CancellationException) throw cause
            error = cause.message?.takeIf { it.isNotEmpty() } ?: "The update check failed."
            phase = if (offer) UpdatePhase.Idle else UpdatePhase.Error
        }
    }

    fun check() { scope.launch { runCheck(offer = false) } }

    fun install() {
        val info = available ?: return
        if (busy) return
        prompting = true
        error = null
        if (!installer.canInstall()) { phase = UpdatePhase.Permission; return }
        phase = UpdatePhase.Downloading
        progress = 0f
        scope.launch {
            try {
                val file = downloadUpdate(http(), context.cacheDir, info) { progress = it }
                phase = UpdatePhase.Installing
                // Android's question is on screen; the app is replaced if the viewer says yes. If they say no, the dialog is back as it was.
                installer.install(file)
                phase = UpdatePhase.Idle
            } catch (cause: Exception) {
                if (cause is kotlinx.coroutines.CancellationException) throw cause
                error = cause.message?.takeIf { it.isNotEmpty() } ?: "The update failed."
                phase = UpdatePhase.Error
            }
        }
    }

    fun changeAuto(on: Boolean) {
        auto = on
        scope.launch { writeMeta(AUTO_KEY, if (on) "1" else "0") }
    }

    /** Switches between releases and beta builds, and looks again at once. */
    fun changeBeta(on: Boolean) {
        beta = on
        available = null
        checked = false
        scope.launch {
            writeMeta(BETA_KEY, if (on) "1" else "0")
            runCheck(offer = false)
        }
    }

    /** Shows the dialog for the available version (from Settings). */
    fun showPrompt() { if (available != null) prompting = true }

    /** Closes the dialog; an automatic check does not offer this version again. */
    fun later() {
        prompting = false
        val info = available
        if (info != null) scope.launch { writeMeta(SKIPPED_KEY, info.versionCode.toString()) }
        if (phase == UpdatePhase.Error || phase == UpdatePhase.Permission) phase = UpdatePhase.Idle
    }

    fun openInstallSetting() {
        if (!installer.openInstallSetting()) error = "Open Settings, then My Fire TV, Developer options, Install unknown apps, and turn on Testcard."
    }

    /** Back at the front: carry on a waiting update if installs are now allowed, or look again if it has been a while. */
    fun onForeground() {
        if (phase == UpdatePhase.Permission && installer.canInstall()) { install(); return }
        if (auto && nowMs() - lastCheck > RECHECK_MS) scope.launch { runCheck(offer = true) }
    }
}
