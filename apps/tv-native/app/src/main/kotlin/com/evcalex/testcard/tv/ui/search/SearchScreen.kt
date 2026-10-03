package com.evcalex.testcard.tv.ui.search

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.evcalex.testcard.core.db.ChannelRow
import com.evcalex.testcard.core.db.MIN_SEARCH_LENGTH
import com.evcalex.testcard.core.db.SearchResults
import com.evcalex.testcard.core.db.searchAll
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.components.ChannelLogo
import com.evcalex.testcard.tv.ui.components.Focusable
import com.evcalex.testcard.tv.ui.components.Glyph
import com.evcalex.testcard.tv.ui.components.GlyphIcon
import com.evcalex.testcard.tv.ui.components.LocalSourceNames
import com.evcalex.testcard.tv.ui.components.PosterItem
import com.evcalex.testcard.tv.ui.components.PosterRow
import com.evcalex.testcard.tv.ui.home.progressOf
import com.evcalex.testcard.tv.ui.shell.ShellActions
import com.evcalex.testcard.tv.ui.theme.Inter
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.delay

/** What was typed last, so coming back from a film's page lands on the same results. */
private var remembered = ""

private class Found(val results: SearchResults, val sourceNames: Map<String, String>?)

/**
 * One search box for everything: films, series and live channels, updating as you type (`Search.tsx`). Opening Search from the nav
 * bar opens the system keyboard straight away; select on the box opens it again.
 */
@Composable
fun SearchScreen(app: AppController, sourceId: String?, openKeyboard: Int, actions: ShellActions, active: Boolean) {
    var query by remember { mutableStateOf(remembered) }
    val text = query.trim()
    val found by produceState<Found?>(null, text, app.version, sourceId) {
        if (text.length < MIN_SEARCH_LENGTH) { value = null; return@produceState }
        // A moment after the last key, so typing stays quick and only the finished word is looked up.
        delay(200)
        val results = app.db.read { it.searchAll(text, sourceId) }
        // Results from more than one source name theirs on each poster and channel, so the same film from two providers can be told apart.
        val ids = HashSet<String>()
        for (entry in results.movies) ids += entry.id.substring(0, Math.max(0, entry.id.indexOf(':')))
        for (entry in results.series) ids += entry.id.substring(0, Math.max(0, entry.id.indexOf(':')))
        for (channel in results.channels) ids += channel.sourceId
        value = Found(results, if (ids.size > 1) app.sources.associate { it.id to it.name } else null)
    }
    val short = text.length < MIN_SEARCH_LENGTH
    val results = found?.results

    Row(Modifier.fillMaxSize().padding(start = 44.dp, end = 44.dp, top = 112.dp), horizontalArrangement = Arrangement.spacedBy(40.dp)) {
        Column(Modifier.width(570.dp)) { SearchBar(query, { remembered = it; query = it }, openKeyboard, active) }
        Box(Modifier.weight(1f).fillMaxHeight()) {
            val movies = results?.movies?.map { PosterItem(it.id, it.name, it.posterUrl, progressOf(it.positionSecs, it.durationSecs)) } ?: emptyList()
            val series = results?.series?.map { PosterItem(it.id, it.name, it.posterUrl) } ?: emptyList()
            val channels = results?.channels ?: emptyList()
            if (movies.isEmpty() && series.isEmpty() && channels.isEmpty()) {
                Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)) {
                    AppText(if (short) "Search movies, series and channels" else if (results == null) "" else "Nothing found for \"$text\"", 34, Palette.muted, FontWeight.Medium)
                    if (short) AppText("Type at least two letters. Results appear as you go.", 24, Palette.faint)
                }
            } else CompositionLocalProvider(LocalSourceNames provides found?.sourceNames) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 80.dp)) {
                    if (movies.isNotEmpty()) item("movies") { PosterRow("Movies  ${movies.size}", movies, { actions.openMovie(it.id, it.name) }, Modifier.padding(bottom = 24.dp)) }
                    if (series.isNotEmpty()) item("series") { PosterRow("Series  ${series.size}", series, { actions.openSeries(it.id, it.name) }, Modifier.padding(bottom = 24.dp)) }
                    if (channels.isNotEmpty()) item("channels") {
                        ChannelSection(channels) { channel -> actions.playChannel(channel.id, channel.normalisedName, channels.map { it.id to it.normalisedName }) }
                    }
                }
            }
        }
    }
}

/**
 * The search box. It is a focus stop that opens the keyboard on select (so moving past it never throws the keyboard up);
 * focused, it takes the accent ring every other focus stop in the app has.
 */
@Composable
private fun SearchBar(value: String, onChange: (String) -> Unit, openKeyboard: Int, active: Boolean) {
    var editing by remember { mutableStateOf(false) }
    val inner = remember { FocusRequester() }
    val outer = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(editing) { if (editing) { inner.requestFocus(); keyboard?.show() } }
    LaunchedEffect(openKeyboard, active) {
        if (openKeyboard == 0 || !active) return@LaunchedEffect
        // A moment's wait: the pane was hidden until this render, and a hidden field cannot take focus.
        delay(60)
        editing = true
    }
    LaunchedEffect(active) { if (active) runCatching { outer.requestFocus() } }
    Focusable({ editing = true }, Modifier.fillMaxWidth().height(76.dp), CircleShape, focusRequester = outer, ring = false, background = Palette.raised, focusedBackground = Palette.card) { focused ->
        Row(
            Modifier.fillMaxSize().border(3.dp, if (focused || editing) Palette.accent else Palette.border, CircleShape).padding(horizontal = 26.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            GlyphIcon(Glyph.Search, if (focused || editing) Palette.foreground else Palette.muted, 30.dp)
            Box(Modifier.weight(1f)) {
                BasicTextField(
                    value, onChange,
                    Modifier.fillMaxWidth().focusRequester(inner).focusProperties { canFocus = editing }.onFocusChanged { if (!it.isFocused && editing) editing = false },
                    singleLine = true,
                    textStyle = androidx.compose.ui.text.TextStyle(color = Palette.foreground, fontSize = 28.sp, fontFamily = Inter),
                    cursorBrush = SolidColor(Palette.accent),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onAny = { editing = false; keyboard?.hide(); outer.requestFocus() }),
                    decorationBox = { inside ->
                        if (value.isEmpty()) AppText("Movies, series, channels", 28, Palette.faint)
                        inside()
                    },
                )
            }
        }
    }
}

@Composable
private fun ChannelSection(channels: List<ChannelRow>, onPress: (ChannelRow) -> Unit) {
    Column(Modifier.padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        AppText("Channels  ${channels.size}", 32, Palette.foreground, FontWeight.SemiBold, Modifier.padding(start = 8.dp), letterSpacing = -0.3f)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)) {
            items(channels, key = { it.id }) { channel -> ChannelTile(channel, onPress) }
        }
    }
}

@Composable
private fun ChannelTile(channel: ChannelRow, onPress: (ChannelRow) -> Unit) {
    val sourceName = LocalSourceNames.current?.get(channel.sourceId)
    Focusable({ onPress(channel) }, Modifier.width(360.dp), RoundedCornerShape(16.dp), background = Palette.raised, focusedBackground = Palette.card) { _ ->
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(96.dp, 64.dp).clip(RoundedCornerShape(10.dp)).background(Palette.sunken)) { ChannelLogo(channel.logoUrl, channel.normalisedName, 24) }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                AppText(channel.normalisedName, 24, Palette.foreground, FontWeight.Medium, maxLines = if (sourceName != null) 1 else 2)
                if (sourceName != null) AppText(sourceName, 19, Palette.muted, FontWeight.Medium, maxLines = 1)
            }
        }
    }
}
