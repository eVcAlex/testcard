package com.evcalex.testcard.tv.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.tv.MainActivity
import com.evcalex.testcard.tv.ui.components.AppButton
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.theme.Palette
import com.evcalex.testcard.tv.ui.theme.TestcardTheme

/** What the viewer sees when the app died of an error: the message and Try again, which starts the app afresh (`ErrorBoundary.tsx`). */
class ErrorActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val message = intent.getStringExtra(MESSAGE) ?: ""
        val where = intent.getStringExtra(WHERE) ?: ""
        setContent {
            TestcardTheme {
                val focus = remember { FocusRequester() }
                LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
                Column(Modifier.fillMaxSize().background(Palette.background).padding(horizontal = 120.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically)) {
                    AppText("Something went wrong", 40, Palette.foreground, FontWeight.SemiBold)
                    AppText("Testcard hit a problem and needs to restart. Your sources and profiles are safe.", 28, Palette.muted, align = TextAlign.Center)
                    // Kept small for a photo of the screen: it is what says which screen failed.
                    AppText(listOf(message, where).filter { it.isNotEmpty() }.joinToString("\n"), 16, Palette.faint, maxLines = 6, align = TextAlign.Center)
                    AppButton("Try again", {
                        startActivity(Intent(this@ErrorActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                        finish()
                    }, primary = true, focusRequester = focus)
                }
            }
        }
    }

    companion object {
        const val MESSAGE = "message"
        const val WHERE = "where"
    }
}
