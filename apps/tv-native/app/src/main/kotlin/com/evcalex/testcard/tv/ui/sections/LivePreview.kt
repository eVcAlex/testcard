package com.evcalex.testcard.tv.ui.sections

import android.view.ViewGroup
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.evcalex.testcard.core.db.ChannelRow
import com.evcalex.testcard.core.playback.PlayItem
import com.evcalex.testcard.core.playback.PlayKind
import com.evcalex.testcard.core.playback.resolveStream
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.platform.Media3Player
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** How long the remote must rest on a channel before the preview tunes to it (a held key flies past without opening streams). */
private const val TUNE_DELAY_MS = 800L

/**
 * The focused channel playing, muted, in the guide's preview frame. Draws nothing until the picture starts or when the channel
 * can't play, so the logo behind shows. Released when it leaves composition: the full-screen player must never share the
 * provider's connection with it (many accounts allow one stream). Does not add the channel to Recently watched.
 */
@Composable
internal fun LivePreview(app: AppController, channel: ChannelRow?) {
    val context = LocalContext.current
    val player = remember { Media3Player.create(context, app.http, vod = false).apply { volume = 0f } }
    var showing by remember { mutableStateOf(false) }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onRenderedFirstFrame() { showing = true }
            override fun onPlayerError(error: PlaybackException) { showing = false }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener); player.release() }
    }
    LaunchedEffect(channel?.id) {
        showing = false
        player.stop()
        val tune = channel ?: return@LaunchedEffect
        delay(TUNE_DELAY_MS)
        val url = try {
            withContext(Dispatchers.Default) { resolveStream(app.db, app.logins, PlayItem(PlayKind.Channel, tune.id, tune.normalisedName), false).url }
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            return@LaunchedEffect
        }
        player.setMediaItem(MediaItem.fromUri(url))
        player.prepare()
        player.play()
    }
    // Always attached (no surface, no first frame), but invisible until the first frame so the logo shows through before it.
    AndroidView(
        factory = { viewContext ->
            PlayerView(viewContext).apply {
                useController = false
                setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                setShutterBackgroundColor(android.graphics.Color.BLACK)
                isFocusable = false
                isFocusableInTouchMode = false
                descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                this.player = player
            }
        },
        modifier = Modifier.fillMaxSize().alpha(if (showing) 1f else 0f),
    )
}
