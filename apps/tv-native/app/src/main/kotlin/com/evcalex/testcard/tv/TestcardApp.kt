package com.evcalex.testcard.tv

import android.app.Application
import android.content.Intent
import android.os.Build
import android.os.StrictMode
import com.evcalex.testcard.tv.ui.ErrorActivity
import java.io.File

class TestcardApp : Application() {
    /** The app's long-lived objects, built by hand: the app is small enough that a DI framework would only add weight. */
    lateinit var controller: AppController
        private set

    override fun onCreate() {
        super.onCreate()
        // The crash screen runs in a process of its own (so it can open after this one dies): it owns no database or sync.
        if (processName().endsWith(":crash")) return
        // Nothing heavy on the main thread, enforced: a disk or network call on it kills the debug build.
        if (BuildConfig.DEBUG) {
            StrictMode.setThreadPolicy(StrictMode.ThreadPolicy.Builder().detectAll().penaltyLog().penaltyDeath().build())
        }
        // An error nothing catches ends the app; the viewer gets "Something went wrong" and Try again, not a bare launcher (ERR-01).
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                startActivity(Intent(this, ErrorActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK).putExtra(ErrorActivity.MESSAGE, error.message ?: error.javaClass.simpleName))
            }
            previous?.uncaughtException(thread, error)
        }
        controller = AppController(this)
    }

    private fun processName(): String =
        if (Build.VERSION.SDK_INT >= 28) getProcessName() else runCatching { File("/proc/self/cmdline").readText().trimEnd('\u0000') }.getOrDefault("")
}
