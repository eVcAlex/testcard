package com.evcalex.testcard.tv.ui.signin

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.nowMs
import com.evcalex.testcard.core.sync.LinkExpiredException
import com.evcalex.testcard.core.sync.formatLinkCode
import com.evcalex.testcard.core.sync.startLinkSession
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.BuildConfig
import com.evcalex.testcard.tv.ui.components.AppButton
import com.evcalex.testcard.tv.ui.components.AppField
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.QrCode
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch

/** The address people open on a phone or computer, shown without the scheme. */
private val LINK_ADDRESS = "${BuildConfig.SYNC_URL.removePrefix("https://")}/link"

@Composable
private fun Brand() {
    Row {
        AppText("TEST", 28, Palette.foreground, FontWeight.SemiBold)
        AppText("CARD", 28, Palette.accent, FontWeight.SemiBold)
    }
}

/**
 * Signing in is how a TV gets its sources: type nothing about providers here, sign in to the same account as the desktop app
 * and its sources, favourites and progress arrive. A fresh TV starts with a code to enter on a phone or computer; typing a
 * password with a remote is the fallback.
 */
@Composable
fun SignInScreen(app: AppController) {
    var useForm by remember { mutableStateOf(false) }
    if (!useForm) CodeSignIn(app) { useForm = true } else FormSignIn(app) { useForm = false }
}

@Composable
private fun FormSignIn(app: AppController, onUseCode: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf(app.status.lastError) }
    var confirmingSignUp by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    // The on-screen keyboard covers the lower half of the screen, so the form moves to the top while it is open.
    val typing = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    BackHandler(enabled = confirmingSignUp) { confirmingSignUp = false }

    fun submit(mode: String) {
        busy = mode
        error = null
        scope.launch(Dispatchers.Default) {
            try {
                if (mode == "signIn") app.signIn(email.trim(), password) else app.signUp(email.trim(), password)
            } catch (failure: Exception) {
                if (failure is kotlinx.coroutines.CancellationException) throw failure
                error = failure.message ?: "That didn't work. Try again."
            } finally {
                busy = null
            }
        }
    }

    val back = remember { FocusRequester() }
    val first = remember { FocusRequester() }
    LaunchedEffect(confirmingSignUp) { runCatching { if (confirmingSignUp) back.requestFocus() else first.requestFocus() } }
    Box(Modifier.fillMaxSize().background(Palette.background), contentAlignment = if (typing) Alignment.TopCenter else Alignment.Center) {
        Column(
            Modifier.fillMaxWidth(0.6f).widthIn(max = 820.dp).padding(top = if (typing) 24.dp else 0.dp)
                .background(Palette.raised, RoundedCornerShape(16.dp)).border(1.dp, Palette.border, RoundedCornerShape(16.dp)).padding(40.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Brand()
            if (confirmingSignUp) {
                AppText("Create a new account?", 40, Palette.foreground, FontWeight.Bold)
                AppText("This makes a brand new Testcard account with no sources. If you already use Testcard on your computer, go back and choose Sign in with that account.", 22, Palette.muted)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.End)) {
                    AppButton("Go back", { confirmingSignUp = false }, primary = true, focusRequester = back)
                    AppButton("Create account", { confirmingSignUp = false; submit("signUp") })
                }
            } else {
                AppText("Sign in", 40, Palette.foreground, FontWeight.Bold)
                AppText("Use the same account as Testcard on your computer. Your sources and favourites will follow you here.", 22, Palette.muted)
                AppField("Email", email, { email = it }, keyboardType = KeyboardType.Email, focusRequester = first)
                AppField("Password", password, { password = it }, password = true)
                error?.let { AppText(it, 22, Palette.fault) }
                val blocked = busy != null || email.trim() == "" || password == ""
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.End)) {
                    AppButton("Use a code instead", onUseCode)
                    AppButton(if (busy == "signUp") "Working..." else "Sign up", { confirmingSignUp = true }, enabled = !blocked)
                    AppButton(if (busy == "signIn") "Working..." else "Sign in", { submit("signIn") }, primary = true, enabled = !blocked)
                }
            }
        }
    }
}

/**
 * Sign in without typing: the TV shows a code and a QR, the person answers on a phone or computer, and this screen picks the
 * sign-in up. The password crosses only as a sealed blob the server cannot open.
 */
@Composable
private fun CodeSignIn(app: AppController, onTypeInstead: () -> Unit) {
    var round by remember { mutableIntStateOf(0) }
    var offer by remember { mutableStateOf<Pair<String, Long>?>(null) }
    var phase by remember { mutableStateOf("starting") }
    var message by remember { mutableStateOf<String?>(null) }
    var secondsLeft by remember { mutableIntStateOf(0) }
    val typeInstead = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { typeInstead.requestFocus() } }

    LaunchedEffect(round) {
        phase = "starting"
        offer = null
        message = null
        try {
            // Network and disk work never runs on the main thread (StrictMode refuses it in debug builds).
            withContext(Dispatchers.Default) {
                val session = startLinkSession(BuildConfig.SYNC_URL, app.http)
                offer = session.code to session.expiresAt
                phase = "waiting"
                val secrets = session.waitForApproval()
                phase = "signing"
                app.signIn(secrets.email, secrets.password)
            }
        } catch (failure: Exception) {
            if (failure is kotlinx.coroutines.CancellationException) throw failure
            // A code that ran out is replaced with a new one without the person asking.
            if (failure is LinkExpiredException) { round += 1; return@LaunchedEffect }
            phase = "failed"
            message = failure.message ?: "That didn't work."
        }
    }
    LaunchedEffect(offer) {
        val expires = offer?.second ?: return@LaunchedEffect
        while (true) {
            secondsLeft = maxOf(0L, Math.round((expires - nowMs()) / 1000.0)).toInt()
            delay(1000)
        }
    }

    val url = offer?.let { "https://$LINK_ADDRESS#${it.first}" }
    Box(Modifier.fillMaxSize().background(Palette.background), contentAlignment = Alignment.Center) {
        Row(
            Modifier.fillMaxWidth(0.78f).widthIn(max = 1400.dp).background(Palette.raised, RoundedCornerShape(24.dp)).border(1.dp, Palette.border, RoundedCornerShape(24.dp)).padding(56.dp),
            horizontalArrangement = Arrangement.spacedBy(64.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Brand()
                AppText("Sign in or create an account with your phone", 40, Palette.foreground, FontWeight.Bold)
                AppText("On your phone or computer, go to", 22, Palette.muted)
                AppText(LINK_ADDRESS, 36, Palette.accent, FontWeight.SemiBold)
                AppText("and enter this code:", 22, Palette.muted)
                AppText(offer?.let { formatLinkCode(it.first) } ?: "........", 96, Palette.foreground, FontWeight.SemiBold, letterSpacing = 8f, modifier = Modifier.padding(vertical = 8.dp))
                AppText(
                    when (phase) {
                        "signing" -> "Signing you in..."
                        "failed" -> message ?: "That didn't work."
                        "waiting" -> "Waiting for you. The code lasts ${secondsLeft / 60}:${(secondsLeft % 60).toString().padStart(2, '0')} more."
                        else -> "Getting a code..."
                    },
                    26, Palette.muted,
                )
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    if (phase == "failed") AppButton("Try again", { round += 1 }, primary = true)
                    AppButton("Use email and password", onTypeInstead, focusRequester = typeInstead)
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
                if (url != null && phase != "failed") QrCode(url, 380.dp)
                else Box(Modifier.size(380.dp).background(Palette.card, RoundedCornerShape(16.dp)))
                AppText("Or scan this with your phone", 24, Palette.muted)
            }
        }
    }
}
