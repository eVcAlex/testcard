package com.evcalex.testcard.tv.platform

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Hands a downloaded APK to Android's package installer (from `apps/mobile/modules/testcard-installer`, Expo wrapper removed). */
class Installer(private val context: Context) {
    /** Whether Android lets Testcard install its updates. */
    fun canInstall() = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    /** Opens the setting that allows it; false when this device has none of the screens. */
    fun openInstallSetting(): Boolean {
        val candidates = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) add(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
            add(Intent(Settings.ACTION_SECURITY_SETTINGS))
            add(Intent(Settings.ACTION_SETTINGS))
        }
        // Fire OS lacks some of these screens; the first that opens is used.
        return candidates.any { intent ->
            try { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (_: Exception) { false }
        }
    }

    /** Resolves once Android's confirmation is on screen; throws why, when Android says no. A successful install replaces the app. */
    suspend fun install(file: File) = withContext(Dispatchers.IO) {
        if (!file.exists()) throw IllegalStateException("The downloaded update is missing. Try again to download it again.")
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) setAppPackageName(context.packageName)
            setSize(file.length())
        }
        val sessionId = installer.createSession(params)
        val answer = CompletableDeferred<Unit>()
        try {
            installer.openSession(sessionId).use { session ->
                file.inputStream().use { input ->
                    session.openWrite("update.apk", 0, file.length()).use { output ->
                        input.copyTo(output, 1 shl 16)
                        session.fsync(output)
                    }
                }
                InstallResultReceiver.pending = answer
                val intent = Intent(context, InstallResultReceiver::class.java).setPackage(context.packageName)
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
                session.commit(PendingIntent.getBroadcast(context, sessionId, intent, flags).intentSender)
            }
        } catch (error: Exception) {
            InstallResultReceiver.pending = null
            try { installer.abandonSession(sessionId) } catch (_: Exception) { }
            throw IllegalStateException("Android would not start the install: ${error.message}", error)
        }
        answer.await()
    }
}

/**
 * Android's answer to an install session. First it asks for the viewer's confirmation, which this opens; then, if the install
 * fails, why. A successful install replaces the app, so success is never heard here.
 */
class InstallResultReceiver : BroadcastReceiver() {
    companion object {
        @Volatile var pending: CompletableDeferred<Unit>? = null
    }

    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm: Intent? =
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                    else @Suppress("DEPRECATION") intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                if (confirm == null) { settle(IllegalStateException("Android did not ask to confirm the update.")); return }
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { context.startActivity(confirm); settle(null) } catch (error: Exception) { settle(IllegalStateException("Android's installer did not open: ${error.message}", error)) }
            }
            PackageInstaller.STATUS_SUCCESS -> settle(null)
            else -> {
                val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                settle(
                    IllegalStateException(
                        when (status) {
                            PackageInstaller.STATUS_FAILURE_ABORTED -> "The update was cancelled."
                            PackageInstaller.STATUS_FAILURE_BLOCKED -> "Android blocked the update. Allow Testcard to install unknown apps in Settings."
                            PackageInstaller.STATUS_FAILURE_CONFLICT -> "The update is signed differently from the installed app, so Android refused it."
                            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "This update does not fit this device."
                            PackageInstaller.STATUS_FAILURE_INVALID -> "The downloaded update is damaged. Try again."
                            PackageInstaller.STATUS_FAILURE_STORAGE -> "There is not enough space on this device for the update."
                            else -> "The update did not install${if (message != null) " ($message)" else ""}."
                        },
                    ),
                )
            }
        }
    }

    private fun settle(error: Exception?) {
        val answer = pending ?: return
        pending = null
        if (error == null) answer.complete(Unit) else answer.completeExceptionally(error)
    }
}
