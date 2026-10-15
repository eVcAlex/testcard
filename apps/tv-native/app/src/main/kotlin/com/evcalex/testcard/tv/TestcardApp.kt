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
                startActivity(Intent(this, ErrorActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK).putExtra(ErrorActivity.MESSAGE, error.message ?: error.javaClass.simpleName).putExtra(ErrorActivity.WHERE, whereItHappened(error)))
            }
            previous?.uncaughtException(thread, error)
        }
        controller = AppController(this)
    }

    /** Where the error came from (its first two frames and Testcard's own first two), so a photo of the crash screen says which screen it was. */
    private fun whereItHappened(error: Throwable): String {
        val frames = generateSequence(error) { it.cause }.last().stackTrace
        // A layout error is raised deep inside Compose, so the top of the stack alone would not name the screen: add Testcard's first frame.
        val ours = (frames.take(2) + frames.filter { it.className.startsWith("com.evcalex.testcard") }.take(2)).distinct()
        return ours.joinToString("\n") { "${it.className.substringAfterLast('.')}.${it.methodName}:${it.lineNumber}" }
    }

    private fun processName(): String =
        if (Build.VERSION.SDK_INT >= 28) getProcessName() else runCatching { File("/proc/self/cmdline").readText().trimEnd('\u0000') }.getOrDefault("")
}
