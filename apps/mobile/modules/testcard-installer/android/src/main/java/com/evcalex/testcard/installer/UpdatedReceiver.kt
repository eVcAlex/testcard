package com.evcalex.testcard.installer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Opens Testcard again once Android has replaced it with an update. Installing an update closes the running app, and
 * with nothing to bring it back it looked as if it had crashed. Android tells the new version, first thing, that it
 * has been put in place; this starts it. Where Android does not let an app start itself from the background (newer
 * versions can refuse), nothing happens and the viewer opens it as before.
 */
class UpdatedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val packages = context.packageManager
    val launch = packages.getLeanbackLaunchIntentForPackage(context.packageName)
      ?: packages.getLaunchIntentForPackage(context.packageName)
      ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      context.startActivity(launch)
    } catch (_: Exception) {
    }
  }
}
