package com.evcalex.testcard.tv

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test

class LaunchTest {
    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    // A fresh install has no account, so the app lands on the sign-in code screen without crashing StrictMode.
    @Test
    fun landsOnSignIn() {
        rule.waitUntil(10_000) { rule.onAllNodes(androidx.compose.ui.test.hasText("Sign in or create an account with your phone")).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText("Sign in or create an account with your phone").assertExists()
    }
}
