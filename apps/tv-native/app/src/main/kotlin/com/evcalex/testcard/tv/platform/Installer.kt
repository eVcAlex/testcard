package com.evcalex.testcard.tv.platform

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

/**
 * Hands a downloaded APK to Android's own installer, the way a file manager or Downloader does, so Android shows its prompt and its
 * own errors. (A package-installer session was tried first; on Fire OS it dropped the viewer back in the app with no reason.)
 */
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

    /** Opens Android's installer on the APK. Returns once it is open: the app is replaced if the viewer says yes, and [UpdatedReceiver] reopens it. */
    fun install(file: File) {
        if (!file.exists()) throw IllegalStateException("The downloaded update is missing. Try again to download it again.")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try { context.startActivity(intent) } catch (error: Exception) { throw IllegalStateException("Android's installer did not open: ${error.message}", error) }
    }
}

/** Runs when an update has replaced the app: opens it again, as the viewer would expect after saying yes to the installer. */
class UpdatedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        try { context.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { }
    }
}
