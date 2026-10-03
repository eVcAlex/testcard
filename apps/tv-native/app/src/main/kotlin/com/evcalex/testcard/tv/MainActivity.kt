package com.evcalex.testcard.tv

import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.tv.platform.Perf
import com.evcalex.testcard.tv.ui.shell.Shell
import com.evcalex.testcard.tv.ui.shell.UpdateState
import com.evcalex.testcard.tv.ui.theme.Palette
import com.evcalex.testcard.tv.ui.theme.TestcardTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var app: AppController
    private var started = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Perf.mark("activity_create")
        Perf.watchFrames(window)
        app = (application as TestcardApp).controller
        setContent {
            TestcardTheme {
                Box(Modifier.fillMaxSize().background(Palette.background)) {
                    Shell(app, UpdateState(app.updates.available != null), appContent(app), exit = { finish() })
                    if (BuildConfig.DEBUG) PerfOverlay()
                }
            }
        }
        window.decorView.post { Perf.mark("first_frame_posted") }
        // Debug builds can be given a throwaway account and the fake provider on the command line (see scripts/tv-fake-provider.mjs).
        // ...and can be made to fail on purpose, to see the crash screen.
        if (BuildConfig.DEBUG && intent.getBooleanExtra("crash", false)) window.decorView.post { error("Crash screen rehearsal") }
        if (BuildConfig.DEBUG) intent.getStringExtra("seed")?.let { spec -> app.scope.launch { runCatching { app.devSeed(spec) } } }
    }

    override fun onStart() {
        super.onStart()
        // The first start is the launch, which catches up on its own; later ones are coming back to the front.
        if (started) app.onForeground()
        started = true
    }

    // Every key goes through here first, so the latency of each one to the next frame is measured the same way everywhere,
    // and a background import knows the remote is in use.
    // The super call is flagged as restricted (androidx.activity) though every Activity makes it.
    @android.annotation.SuppressLint("RestrictedApi")
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        Perf.onKey(event)
        app.lastKeyAt = nowMs()
        return super.dispatchKeyEvent(event)
    }
}

/** Key latency, frame times and memory, top right (debug builds only). Refreshed once a second. */
@Composable
private fun PerfOverlay() {
    LaunchedEffect(Unit) {
        while (true) {
            Perf.refreshOverlay()
            delay(1000)
        }
    }
    Box(Modifier.fillMaxSize().padding(12.dp), contentAlignment = Alignment.TopEnd) {
        Text(Perf.overlay, style = MaterialTheme.typography.bodyMedium, color = Palette.accent, modifier = Modifier.background(Palette.sunken))
    }
}
