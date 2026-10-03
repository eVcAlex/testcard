package com.evcalex.testcard.tv.ui.player

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.db.ChannelFeed
import com.evcalex.testcard.core.db.listChannelFeeds
import com.evcalex.testcard.core.db.listMoviePlayOrder
import com.evcalex.testcard.core.db.one
import com.evcalex.testcard.core.normalise.splitTitle
import com.evcalex.testcard.core.playback.PlayItem
import com.evcalex.testcard.core.playback.PlayKind
import com.evcalex.testcard.core.playback.ResolvedStream
import com.evcalex.testcard.core.playback.resolveStream
import com.evcalex.testcard.core.playback.sourceOfPlay
import com.evcalex.testcard.core.playback.xtreamSourceOf
import com.evcalex.testcard.core.sync.unreachable
import com.evcalex.testcard.core.text.plainReason
import com.evcalex.testcard.core.text.serverGone
import com.evcalex.testcard.core.xtream.CatchupProgramme
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.ui.components.AppButton
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Fullscreen playback (`Player.tsx`, the outer part): turns what the viewer picked into a stream, tries the other feeds or copies
 * when one will not play, and hands the working stream to [Playing]. Until then it shows the same black screen and spinner the
 * player shows while buffering, so starting something reads as one action; a failure shows the error screen.
 */
@Composable
fun PlayerScreen(
    app: AppController,
    item: PlayItem,
    seriesId: String?,
    resume: Boolean,
    channels: List<PlayItem>?,
    onZap: (PlayItem) -> Unit,
    onNextEpisode: (PlayItem) -> Unit,
    onExit: () -> Unit,
    /** Draws the source's form over the page. Absent where there is none. */
    sourceForm: (@Composable (sourceId: String, onClose: () -> Unit) -> Unit)? = null,
) {
    // Selection and "surfing" are carried across a channel change by one key handler that lives above the player.
    val keys = remember { com.evcalex.testcard.core.playback.PlayerKeys() }
    val history = remember { ChannelHistory() }
    var stream by remember(item.id) { mutableStateOf<ResolvedStream?>(null) }
    var error by remember(item.id) { mutableStateOf<String?>(null) }
    // A past programme the viewer picked from Catch up, for this channel only: changing channel goes back to live.
    var picked by remember { mutableStateOf<Pair<String, CatchupProgramme>?>(null) }
    val catchup = picked?.takeIf { it.first == item.id }?.second
    // A live channel that will not play is tried again on its other feeds before the viewer sees an error; a film's copies the same.
    var feedAt by remember(item.id) { mutableIntStateOf(0) }
    var copyAt by remember(item.id, resume) { mutableIntStateOf(0) }
    // Bumped by Try again (or a source just edited) to ask for the stream afresh.
    var attempt by remember(item.id) { mutableIntStateOf(0) }
    val feeds by produceState<List<ChannelFeed>?>(null, item.id) { value = if (item.kind == PlayKind.Channel) app.db.read { it.listChannelFeeds(item.id) } else emptyList() }
    val copies by produceState<List<String>?>(null, item.id, resume) { value = if (item.kind == PlayKind.Movie) app.db.read { it.listMoviePlayOrder(item.id, resume) } else emptyList() }
    val serverTried = remember(item.id) { booleanArrayOf(false) }
    // Where the first copy was to start, so the next one picks up at the same place.
    val startedFrom = remember(item.id) { arrayOf<Double?>(null) }
    val copyId = copies?.getOrNull(copyAt)
    val playing = if (copyId != null && copyId != item.id) PlayItem(item.kind, copyId, item.title) else item
    val feed = feeds?.getOrNull(feedAt)

    if (feeds != null && copies != null) LaunchedEffect(playing.id, resume, catchup?.serverStart, feedAt, copyAt, attempt) {
        error = null
        // Cleared first, or the dead feed is mounted again under the new key while the next one resolves.
        stream = null
        try {
            val resolved = withContext(Dispatchers.Default) { resolveStream(app.db, app.logins, playing, resume, catchup, if (feedAt > 0) feed else null) }
            if (copyAt == 0) startedFrom[0] = resolved.resumeSecs
            stream = if (copyAt > 0 && resolved.resumeSecs == null) ResolvedStream(resolved.url, resolved.title, startedFrom[0]) else resolved
        } catch (failure: Exception) {
            if (failure is kotlinx.coroutines.CancellationException) throw failure
            if (copyAt + 1 < (copies?.size ?: 0)) copyAt += 1
            else error = failure.message ?: "This couldn't be played."
        }
    }

    // Try again starts over: the best copy or first feed, and the source's other addresses may be tried again.
    val retry = { serverTried[0] = false; copyAt = 0; feedAt = 0; attempt += 1 }

    // A source's server that cannot be reached: once per play, its other addresses are tried, and on one that answers the stream
    // is asked for again. Null when there is nothing to try.
    val onServerDown: suspend (String) -> Boolean? = down@{ raw ->
        val source = sourceOfPlay(app.db, playing.kind, playing.id)
        if (serverTried[0] || source == null || !unreachable(raw) || !app.servers.hasBackups(source.first)) return@down null
        serverTried[0] = true
        val changed = withContext(Dispatchers.Default) { runCatching { app.servers.pickServer(source.first) }.getOrDefault(false) }
        if (changed) attempt += 1
        changed
    }

    val failure = error
    val current = stream
    // Once Playing is on screen it owns Back itself (hide the controls, then leave); this is only for the loading and failure
    // states before that, which would otherwise have no way to leave on Back at all.
    BackHandler(enabled = current == null || failure != null, onBack = onExit)
    if (failure != null) {
        val editSource by produceState<String?>(null, item.id) { value = sourceOfPlay(app.db, item.kind, item.id)?.first }
        val account by produceState<String?>(null, item.id) { value = xtreamSourceOf(app.db, item.kind, item.id) }
        FailureScreen(app, item.title, if (serverGone(failure)) plainReason(failure) else failure, null, failure, editSource, account, retry, onExit, sourceForm)
        return
    }
    if (current == null) { BufferingScreen(); return }

    key(catchup?.serverStart ?: "live", feedAt, copyAt, attempt) {
        val moreFeeds = if (item.kind == PlayKind.Movie) copyAt + 1 < (copies?.size ?: 0) else feedAt + 1 < (feeds?.size ?: 0)
        val fellBack by produceState<String?>(null, copyAt, feedAt, playing.id) {
            value = if (item.kind == PlayKind.Movie) { if (copyAt > 0) copyLabel(app, playing.id) else null }
            else if (feedAt > 0 && feed != null) fellBackLabel(item.title, feed) else null
        }
        // The note is decided once the label has been read; Playing starts without it and the health model reads it when the picture is up.
        Playing(
            app, playing, current, catchup, { programme -> picked = programme?.let { item.id to it } }, seriesId, channels, onZap, onNextEpisode, keys, history,
            moreFeeds, { if (item.kind == PlayKind.Movie) copyAt += 1 else feedAt += 1 }, { attempt += 1 }, onServerDown, fellBack,
            onExit = { app.sync.notifyLocalChange(); app.bump(); onExit() }, sourceForm = sourceForm,
        )
    }
}

/** Remembers the channel being watched and the one before it, so "Last" can flip back, as on a TV remote. */
class ChannelHistory {
    var current: PlayItem? = null
    var previous: PlayItem? = null

    fun see(item: PlayItem) {
        if (current?.id != item.id) { previous = current; current = item }
    }
}

/** What the viewer is told once a film is playing from a copy other than the first. */
private suspend fun copyLabel(app: AppController, movieId: String): String {
    val row = app.db.read { it.one("SELECT m.name, s.name FROM movies m JOIN sources s ON s.id = m.source_id WHERE m.id = ?", movieId) { r -> r.getText(0) to r.getText(1) } }
        ?: return "Playing another copy instead"
    return "Playing the ${if (splitTitle(row.first).is4k) "4K" else "HD"} copy from ${row.second} instead"
}

/** What the viewer is told once a channel is playing on a feed other than the first. */
private fun fellBackLabel(title: String, feed: ChannelFeed): String {
    if (feed.name != title) return "Playing ${feed.name} instead"
    return if (feed.quality != null) "Playing the ${feed.quality} feed instead" else "Playing a backup feed instead"
}

/** The same black screen and spinner the player itself shows while buffering. */
@Composable
fun BufferingScreen() {
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        Spinner(64.dp)
    }
}

/** The device's decoder said no (a 4K or 10-bit stream on hardware that cannot do it) or the network did. */
fun explain(raw: String): String {
    if (Regex("EXCEEDS_CAPABILITIES|MediaCodec|Decoder|decoder").containsMatchIn(raw)) return "This device can't decode this video (its format or resolution is beyond the hardware)."
    if (Regex("40[13]").containsMatchIn(raw)) return "The provider refused this stream."
    if (Regex("404|410").containsMatchIn(raw)) return "The provider has no stream at that address (it may have been removed)."
    if (serverGone(raw)) return plainReason(raw)
    if (Regex("Unable to connect|timeout|timed out|Network|ConnectException|SocketTimeout", RegexOption.IGNORE_CASE).containsMatchIn(raw)) return "Couldn't reach the stream. Check the connection and try again."
    return "This couldn't be played."
}

@Composable
fun FailureScreen(
    app: AppController,
    title: String,
    given: String,
    detail: String?,
    raw: String,
    editSourceId: String?,
    accountSourceId: String?,
    onRetry: (() -> Unit)?,
    onExit: () -> Unit,
    sourceForm: (@Composable (sourceId: String, onClose: () -> Unit) -> Unit)?,
) {
    // A server name that no longer exists is nearly always a provider that moved: say so, and offer to put it right.
    val gone = serverGone(raw) && editSourceId != null && sourceForm != null
    var editing by remember { mutableStateOf(false) }
    // A refused stream is often the account (every stream it allows in use, or it has ended): the provider says which.
    val problem by produceState<String?>(null, accountSourceId) { value = accountSourceId?.let { id -> withContext(Dispatchers.Default) { runCatching { app.accounts.problem(id) }.getOrNull() } } }
    val message = if (gone) plainReason(raw) else (problem ?: given)
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
    Column(Modifier.fillMaxSize().background(Palette.background).padding(48.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(32.dp, Alignment.CenterVertically)) {
        AppText(title, 44, Palette.foreground, FontWeight.SemiBold, Modifier.widthIn(max = 1200.dp), maxLines = 2, align = TextAlign.Center, letterSpacing = -0.5f)
        AppText(message, 30, Palette.muted, modifier = Modifier.widthIn(max = 1000.dp), align = TextAlign.Center, lineHeight = 44)
        if (!gone && !detail.isNullOrEmpty()) AppText(detail, 20, Palette.faint, modifier = Modifier.widthIn(max = 1000.dp), maxLines = 2, align = TextAlign.Center)
        Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            if (gone) AppButton("Edit source", { editing = true }, primary = true, focusRequester = first)
            if (onRetry != null) AppButton("Try again", onRetry)
            AppButton("Back", onExit, primary = !gone, focusRequester = if (!gone) first else null)
        }
    }
    if (editing && editSourceId != null && sourceForm != null) sourceForm(editSourceId) { editing = false; onRetry?.invoke() }
}
