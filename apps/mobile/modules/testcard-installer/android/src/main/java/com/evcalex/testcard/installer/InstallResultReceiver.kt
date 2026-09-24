package com.evcalex.testcard.installer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException

/**
 * Android's answer to an install session. First it asks for the viewer's confirmation, which this opens; then, if the
 * install fails, why. A successful install replaces the app, so success is never heard here.
 */
class InstallResultReceiver : BroadcastReceiver() {
  companion object {
    @Volatile var pending: Promise? = null
  }

  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    when (status) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        val confirm: Intent? =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
          else @Suppress("DEPRECATION") intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
        if (confirm == null) {
          settle(CodedException("ERR_INSTALL", "Android did not ask to confirm the update.", null))
          return
        }
        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
          context.startActivity(confirm)
          settle(null)
        } catch (error: Exception) {
          settle(CodedException("ERR_INSTALL", "Android's installer did not open: ${error.message}", error))
        }
      }
      PackageInstaller.STATUS_SUCCESS -> settle(null)
      else -> {
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        val reason = when (status) {
          PackageInstaller.STATUS_FAILURE_ABORTED -> "The update was cancelled."
          PackageInstaller.STATUS_FAILURE_BLOCKED -> "Android blocked the update. Allow Testcard to install unknown apps in Settings."
          PackageInstaller.STATUS_FAILURE_CONFLICT -> "The update is signed differently from the installed app, so Android refused it."
          PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "This update does not fit this device."
          PackageInstaller.STATUS_FAILURE_INVALID -> "The downloaded update is damaged. Try again."
          PackageInstaller.STATUS_FAILURE_STORAGE -> "There is not enough space on this device for the update."
          else -> "The update did not install${if (message != null) " ($message)" else ""}."
        }
        settle(CodedException("ERR_INSTALL", reason, null))
      }
    }
  }

  private fun settle(error: CodedException?) {
    val promise = pending ?: return
    pending = null
    if (error == null) promise.resolve(null) else promise.reject(error)
  }
}
