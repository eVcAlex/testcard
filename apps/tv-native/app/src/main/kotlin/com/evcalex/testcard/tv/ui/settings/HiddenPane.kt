package com.evcalex.testcard.tv.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.evcalex.testcard.core.db.listHidden
import com.evcalex.testcard.core.db.unhide
import com.evcalex.testcard.tv.AppController
import com.evcalex.testcard.tv.ui.components.AppText
import com.evcalex.testcard.tv.ui.theme.Palette
import kotlinx.coroutines.launch

internal fun hiddenKind(kind: String) = when (kind) { "live" -> "Live TV category"; "movies" -> "Movies category"; "series" -> "Series category"; else -> "Channel" }

/** What was hidden, on any device, each with a way to bring it back. */
@Composable
internal fun HiddenPane(app: AppController) {
    val entries by produceState(emptyList<com.evcalex.testcard.core.db.HiddenEntry>(), app.version) { value = app.db.read { it.listHidden() } }
    val mixed = app.sources.size > 1
    val scope = rememberCoroutineScope()
    PaneColumn {
        AppText("Hidden", 40, Palette.foreground, FontWeight.Bold)
        AppText(
            if (entries.isEmpty()) "Nothing is hidden. Hide a category from its page in Browse all, or a channel from its options." else "These are left out of every list, row and search, on all your devices.",
            22, Palette.muted,
        )
        for (entry in entries) {
            Card {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    AppText(entry.label, 28, Palette.foreground, FontWeight.SemiBold, maxLines = 1)
                    AppText(if (mixed) "${hiddenKind(entry.kind)}  ·  ${entry.sourceName}" else hiddenKind(entry.kind), 22, Palette.muted)
                }
                SmallButton("Show again", {
                    scope.launch {
                        app.db.write { it.unhide(entry.sourceId, entry.kind, entry.key) }
                        app.sync.notifyLocalChange()
                        app.bump()
                    }
                })
            }
        }
    }
}
