package com.evcalex.testcard.tv.ui.sections

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import com.evcalex.testcard.core.db.CategoryKind
import com.evcalex.testcard.core.db.ChannelRow
import com.evcalex.testcard.core.db.browseChannels
import com.evcalex.testcard.core.db.listCategories
import com.evcalex.testcard.core.db.listFavouriteChannels
import com.evcalex.testcard.core.db.listRecentChannels
import com.evcalex.testcard.core.db.removeChannelFromRecents
import com.evcalex.testcard.core.db.toggleFavourite
import com.evcalex.testcard.tv.ui.browse.BrowseItem
import com.evcalex.testcard.tv.ui.browse.BrowseScreen
import com.evcalex.testcard.tv.ui.browse.BrowseSource
import com.evcalex.testcard.tv.ui.browse.Special
import com.evcalex.testcard.tv.ui.components.ActionGlyph
import com.evcalex.testcard.tv.ui.components.DetailAction
import com.evcalex.testcard.tv.ui.components.PosterItem
import com.evcalex.testcard.tv.ui.components.PrimaryAction
import com.evcalex.testcard.tv.ui.home.HeroActions
import com.evcalex.testcard.tv.ui.home.HomeDetail
import com.evcalex.testcard.tv.ui.home.HomeRow
import com.evcalex.testcard.tv.ui.home.HomeScreen
import com.evcalex.testcard.tv.ui.home.toHomeItem
import com.evcalex.testcard.tv.ui.shell.SectionContext
import kotlinx.coroutines.launch

internal fun channelItem(channel: ChannelRow) = BrowseItem(channel.id, channel.normalisedName, channel.logoUrl, number = channel.channelNumber)

@Composable
fun LiveSection(ctx: SectionContext) {
    val app = ctx.app
    val sourceId = ctx.sourceId
    val mode = ctx.browsing.mode
    val version = versionWhileShown(ctx)
    val tick = refreshOnShow(ctx.active)
    BackTo(mode != null) { ctx.browsing.set(null) }
    if (mode == GUIDE) { GuideScreen(ctx); return }
    val rows = rememberRows(app, "live|${sourceId ?: ""}", version, app.catalogue, sourceId, tick.intValue) {
        val categories = app.memoByCatalogue("live-categories", sourceId) { it.listCategories(sourceId).browsable() }
        app.db.read { c ->
            fun own(channel: ChannelRow) = sourceId == null || channel.sourceId == sourceId
            val recents = c.listRecentChannels(60).filter(::own).take(30)
            val favourites = c.listFavouriteChannels().filter(::own)
            val list = ArrayList<HomeRow>()
            if (recents.isNotEmpty()) list += HomeRow("recent", "Recently watched", recents.map(::toHomeItem), channels = true)
            if (favourites.isNotEmpty()) list += HomeRow("favourites", "Favourites", favourites.take(30).map(::toHomeItem), channels = true)
            for (category in categories.filter { it.count > 0 }.take(CATEGORY_ROWS)) {
                val channels = c.browseChannels(categoryId = category.id, limit = ROW_SIZE, sourceId = sourceId)
                if (channels.isNotEmpty()) list += HomeRow(category.id, category.label, channels.map(::toHomeItem), channels = true)
            }
            list
        }
    }
    if (mode == BROWSE || (rows != null && rows.isEmpty())) { LiveBrowsing(ctx, tick.intValue); return }
    if (rows == null) { Loading(); return }
    val refresh: () -> Unit = { tick.intValue += 1 }
    val recentIds = remember(rows) { rows.firstOrNull { it.key == "recent" }?.items?.map { it.id }?.toSet() ?: emptySet() }

    fun play(item: PosterItem) {
        val row = rows.firstOrNull { r -> r.items.any { it.id == item.id } }
        ctx.actions.playChannel(item.id, item.name, (row?.items ?: listOf(item)).map { it.id to it.name })
    }
    HomeScreen(
        rows = rows,
        heroActions = { item, rowKey ->
            HeroActions(
                PrimaryAction("Watch live", { play(item) }),
                buildList {
                    add(DetailAction("favourite", if (item.favourite) "Remove from Favourites" else "Add to Favourites", if (item.favourite) ActionGlyph.Check else ActionGlyph.Plus) {
                        app.scope.launch { app.db.write { it.toggleFavourite(item.id) }; app.sync.notifyLocalChange(); refresh() }
                    })
                    if (item.id in recentIds) add(DetailAction("forget", "Remove from Recently watched", ActionGlyph.Cross) { app.scope.launch { app.db.write { it.removeChannelFromRecents(item.id) }; refresh() } })
                    addAll(channelExtras(app, item.id, item.name, rowKey == "favourites", refresh))
                },
            )
        },
        onSelect = ::play,
        backToTop = ctx.backToTop,
        // Shown as a now/next block under the title; null (no guide) is kept too, so the hero can say so.
        fetchDetail = { id -> HomeDetail(null, null, app.guides.fetchGuide(id), isGuide = true) },
        browseAll = { ctx.browsing.set(BROWSE) },
        openGuide = { ctx.browsing.set(GUIDE) },
    )
}

/** Every category as a row of pills, channels beneath. */
@Composable
internal fun LiveBrowsing(ctx: SectionContext, tick: Int) {
    val app = ctx.app
    val sourceId = ctx.sourceId
    val source by produceState<BrowseSource?>(null, app.version, app.catalogue, sourceId, tick) {
        val categories = app.memoByCatalogue("live-categories", sourceId) { it.listCategories(sourceId).browsable() }
        value = app.db.read { c ->
            fun own(channel: ChannelRow) = sourceId == null || channel.sourceId == sourceId
            val favourites = c.listFavouriteChannels().filter(::own)
            val recents = c.listRecentChannels(60).filter(::own).take(30)
            BrowseSource(
                layout = "channel", noun = "channels", single = "channel", genres = false, menu = "pills",
                pinning = c.pinningFor(app, CategoryKind.Live) { app.bump() },
                guide = { id -> app.guides.fetchGuide(id) },
                specials = listOf(
                    Special("recent", "Recently watched", recents.size),
                    Special("favourites", "Favourites", favourites.size),
                    Special("all", "All channels", categories.sumOf { it.count }),
                ),
                categories = categories,
                load = { selection, limit ->
                    when (selection.kind) {
                        "category" -> app.db.read { it.browseChannels(categoryId = selection.key, limit = limit, sourceId = sourceId) }.map(::channelItem)
                        "genre" -> app.db.read { it.browseChannels(genre = selection.key, limit = limit, sourceId = sourceId) }.map(::channelItem)
                        else -> when (selection.key) {
                            "recent" -> recents.take(limit).map(::channelItem)
                            "favourites" -> favourites.take(limit).map(::channelItem)
                            else -> app.db.read { it.browseChannels(limit = limit, sourceId = sourceId) }.map(::channelItem)
                        }
                    }
                },
            )
        }
    }
    val current = source ?: return Padded {}
    Padded {
        BrowseScreen(current, if (sourceId != null) NOTHING_FROM_SOURCE else "Sources that sync from your account load here. Open Sources to see progress.") { item, list ->
            app.scope.launch {
                // Next and previous step through the list the viewer picked from; a list of one steps through all channels instead.
                val stepping = if (list.size > 1) list else app.db.read { it.browseChannels(limit = 300, sourceId = sourceId) }.map(::channelItem)
                ctx.actions.playChannel(item.id, item.title, stepping.map { it.id to it.title })
            }
        }
    }
}
