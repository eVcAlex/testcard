package com.evcalex.testcard.installer

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class InstallerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TestcardInstaller")

    Function("canInstall") {
      Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()
    }

    Function("openInstallSetting") {
      val activity = appContext.currentActivity
      val candidates = buildList {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          add(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
        }
        add(Intent(Settings.ACTION_SECURITY_SETTINGS))
        add(Intent(Settings.ACTION_SETTINGS))
      }
      // Fire OS lacks some of these screens; the first that opens is used.
      candidates.any { intent ->
        if (activity == null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
          (activity ?: context).startActivity(intent)
          true
        } catch (_: Exception) {
          false
        }
      }
    }

    AsyncFunction("install") { path: String, promise: Promise ->
      val file = File(if (path.startsWith("file://")) Uri.parse(path).path ?: path else path)
      if (!file.exists()) throw CodedException("ERR_NO_FILE", "The downloaded update is missing.", null)
      val installer = context.packageManager.packageInstaller
      val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) setAppPackageName(context.packageName)
        setSize(file.length())
      }
      val sessionId = installer.createSession(params)
      try {
        installer.openSession(sessionId).use { session ->
          file.inputStream().use { input ->
            session.openWrite("update.apk", 0, file.length()).use { output ->
              input.copyTo(output, 1 shl 16)
              session.fsync(output)
            }
          }
          InstallResultReceiver.pending = promise
          val intent = Intent(context, InstallResultReceiver::class.java).setPackage(context.packageName)
          val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
          val sender = PendingIntent.getBroadcast(context, sessionId, intent, flags)
          session.commit(sender.intentSender)
        }
      } catch (error: Exception) {
        InstallResultReceiver.pending = null
        try {
          installer.abandonSession(sessionId)
        } catch (_: Exception) {
        }
        throw CodedException("ERR_INSTALL", "Android would not start the install: ${error.message}", error)
      }
    }
  }
}
