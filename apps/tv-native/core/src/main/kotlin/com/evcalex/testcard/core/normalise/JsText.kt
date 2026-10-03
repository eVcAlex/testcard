package com.evcalex.testcard.core.normalise

/**
 * JavaScript's `\s`, written out. Java's (and Android's ICU) `\s` is ASCII-only, JS's also matches NBSP, the U+2000
 * spaces, U+3000 and the byte-order mark, all of which turn up in provider names. Every regex in this package uses
 * `[$WS]` where the TypeScript has `\s`, `[0-9]` for `\d` and explicit lookarounds for `\b`, so that the JVM and
 * Android's regex engine agree with JavaScript.
 */
internal const val WS = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"

/** `\b` before a word character. */
internal const val WORD_START = "(?<![A-Za-z0-9_])"

/** `\b` after a word character. */
internal const val WORD_END = "(?![A-Za-z0-9_])"

internal fun isJsSpace(char: Char): Boolean = when (char) {
    '\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
    else -> char in ' '..' '
}

/** `String.prototype.trim`. Kotlin's `trim()` keeps U+FEFF and Java's trims control characters JS keeps. */
internal fun String.jsTrim(): String = trim(::isJsSpace)

internal fun nfkc(text: String): String = java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFKC)

/** `Number(text)` that is not NaN: "" is 0, surrounding spaces are ignored, anything that is not a plain decimal is null. */
private val PLAIN_NUMBER = Regex("^[+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?\\z")

internal fun jsNumber(text: String): Double? {
    val trimmed = text.jsTrim()
    if (trimmed.isEmpty()) return 0.0
    return if (PLAIN_NUMBER.matches(trimmed)) trimmed.toDouble() else null
}
