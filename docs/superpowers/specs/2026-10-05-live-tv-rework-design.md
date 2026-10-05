# Live TV rework (Fire TV native): the guide is the page

Status: T1-T6, T8, T9 implemented (not committed); T7 (live preview) deferred. Scope: `apps/tv-native` only. Desktop, EPG import/correctness (later spec A), the
4-account cap and the licensing note are out of scope.

Mockups: `live-tv-mockups.html` (option A) and `rail-tail.html` (rail states), in the 2026-10-05 session scratchpad.

---

## Part 1: Design

### 1.1 Intent

Live TV opens straight on a classic EPG grid ("replicate EPG but better"). The current landing (hero plus rows,
`LiveSection` → `HomeScreen`), **Browse all** (`LiveBrowsing` → `BrowseScreen`) and the **TV guide** sub-mode
(`GuideScreen` behind `ctx.browsing == GUIDE`) collapse into one screen. The pill bar of lists becomes a left
**category rail**. Rows never sit on "Loading": listings are fetched in batches for the rows on screen plus a lookahead.

### 1.2 Layout (1920×1080 design px, 1 dp = 1 px through `TestcardTheme`)

```
y=0    ┌ top nav (Shell, unchanged, floats over the page; ends ~y=104) ───────────────────────────────┐
y=104  │rail│ ┌ preview 448×252 ┐  "101  BBC One"                         (22, muted)               │
       │110 │ │ ● LIVE           │  Title of what is on                    (40, SemiBold, foreground) │
       │ px │ │       (picture)  │  20:00 to 21:00 · 34 min left           (22, faint)               │
       │    │ └──────────────────┘  ▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░ progress (4 px, accent on border)               │
       │    │                       Next: 21:00 Title                       (22, muted)               │
y=388  │    │ Today        20:00          20:30          21:00          21:30        (ruler, 44 px)   │
y=432  │    │ ┌channel 300┐┌programme cells sized by duration, red now-line ─────────────────────┐     │
       │    │ │101 [logo] ││                                                                   │     │
       │    │ │   name    ││  focused cell: background #E7D2AD (Palette.accent), ink #1D160A    │     │
       └────┴─┴───────────┴┴───────────────────────────────────────────────────────────────────┘     ┘
```

- Rail strip: x 0..110, y 104..1080, `Palette.sunken`, 1 px `Palette.border` right edge.
- Content: start padding 134 (110 + 24), end padding 44, top 104. Grid width 1742; time area 1442 px for 120 min.
- Header row height 284 (252 preview + 32 bottom gap). Preview: 16:9, 12 px corners, `Palette.sunken` behind,
  LIVE badge top-left (12 px `Palette.live` dot + "LIVE" 18 SemiBold), channel logo bottom-right as fallback picture.
- Ruler: day label (Today/Tomorrow/weekday) over the channel column, `clock24` at each 30 min slot.
- Channel column (`CHANNEL_W = 300`): number (22, muted, width 56, end-aligned, blank when null), logo box 80×56,
  name (20, muted, 2 lines).
- Rows `ROW_H = 96`, cells 84 high, 8 px corners: now-airing `Palette.card`, later `Palette.raised`, no-listing
  transparent with 1 px border, unloaded = flat `Palette.raised` at 50% alpha with no text (skeleton).
- Now-line: 3 px `Palette.live` at 80% alpha over the grid (as today).

### 1.3 Info pane (beside the preview)

Driven by the focused cell (`Focused(channel, segment)`):
- Focused segment is the programme airing now, or a gap: channel line, now title, "HH:MM to HH:MM · N min left",
  progress bar, "Next: HH:MM Title" (from `nowAndNext`).
- Focused segment is a later programme: channel line, that title, "Tomorrow 06:00 to 07:00" (day prefix only when not
  today), no progress bar, and "On now: Title" in place of the Next line.
- No listings for the channel: title "No listings for this time", no time line, no bar, no Next line.
- Listings not loaded yet: title blank, other lines blank (no "Loading" text).

### 1.4 Category rail

Items, top to bottom: **Favourites** (Glyph.Star), **Recently watched** (Glyph.Restart), separator, every browsable
category with `count > 0` (monogram of the label, max 3 chars), **All channels** (text "All"). Counts: favourites and
recents filtered to the picked source, `category.count`, and All = sum of category counts. Favourites and Recently
watched are always listed (count may be 0). Only on Live TV.

States:
- **Collapsed (default):** 110 px strip, icons/monograms only, current list's icon in `Palette.accent`, others
  `Palette.faint`. Not focusable (so Down from the nav bar never lands in it).
- **Expanded:** overlay 440 px wide over the grid (grid does not move or reflow), items 60 px tall: icon, label (24),
  count (19, faint) end-aligned; focused item `Palette.accent` fill with `Palette.accentInk` text; shadow; a scrim
  `Color(0x9E050709)` over the rest of the page. Focus moving through the items selects that list after 250 ms (grid
  filters live behind the scrim).

### 1.5 Key map

| Where | Key | Result |
|---|---|---|
| Grid cell | Up/Down | Previous/next channel row (Compose default focus search). |
| Grid cell, row 0 | Up | Focus the Live TV nav tab (`ctx.focusNav()`). |
| Grid cell | Left/Right | Previous/next cell (default). |
| Grid cell, last cell | Right | Page window +60 min (max 24 h ahead). Unchanged (EPG-01). |
| Grid cell, first cell, window > now | Left | Page window −60 min. Unchanged (EPG-01). |
| Grid cell, first cell, window at now | Left | **Open the rail**, focus on the current list's item. |
| Grid cell | OK | Watch the channel full screen, zapping through the first 300 of the list (LIVE-03). |
| Grid cell | Long-press OK | Channel options sheet (see 1.7). |
| Grid | Back | Shell's handler: focus the Live TV tab, `backToTop` bumps (guide resets to now, top row). |
| Nav bar | Back | Asks twice before exit (Shell, unchanged). |
| Nav bar | Down | Into the grid; `focusRestorer` returns to the last focused cell when still composed. |
| Rail (open) | Up/Down | Move through lists (focus trapped inside the rail). |
| Rail (open) | OK or Right | Commit that list now, close rail, focus the same channel in the new list if present, else row 0, at "now". |
| Rail (open) | Left | Consumed (nothing). |
| Rail (open) | Back | Close rail as for Right. Does not reach Shell. |
| Rail (open), category item | Long-press OK | Category sheet: "Pin to Home" / "Pinned to Home. Press to remove", "Hide category". |

Repeat presses: paging ignores `repeatCount > 0` (as today); rail open also ignores repeats so holding Left on the grid
does not open it.

### 1.6 Data loading

Today each `GuideRow` calls `guides.fetchListings(id)` on composition, which goes through a 3-at-a-time queue and runs
one `programmesInWindow` query per channel even when the imported guide has everything. New approach, inside the
existing `GuideRepository`:

1. `GuideRepository.storedListings(ids)`: one `programmesInWindow(ids, now−6 h, now+36 h)` query for all ids not
   already cached, grouped per channel, cached in the existing `listings` map (20 min), returned with the cached ones.
   Channels missing from the result have no imported guide.
2. The guide watches `LazyListState.layoutInfo` (via `snapshotFlow`) and, for rows `firstVisible − 4 ..
   lastVisible + 12`, calls `storedListings` once, then `fetchListings(id)` only for the misses (provider path; the
   existing newest-first queue of 3 stays). Results go into one `SnapshotStateMap<String, List<Airing>>` the rows read.
3. Now/next for the info pane is derived from the same listings (`nowAndNext`), no extra `fetchGuide` call.
4. Refreshed when `app.version` changes (sync/import, `GuideRepository.forget()` already clears the cache) and every
   20 min of clock (`now / LISTINGS_FRESH_MS`). The UI map is overwritten, not cleared, so cells never flash.

EPG-02 (sources, window, limit 24, 3 at once, 20 min) and EPG-03 (`fetchGuide`, used by the player's programme bar)
are unchanged.

### 1.7 Things the old landing did that must survive (parity)

The home rows' hero offered favourite/remove-from-recents/move/hide per channel, and Browse all offered Pin to Home and
Hide category. These move to long-press sheets (existing `OptionsSheet`):
- Channel sheet (title = channel name): "Watch live", "Add to Favourites"/"Remove from Favourites", "Remove from
  Recently watched" (only in the Recently watched list), then `channelExtras(...)` ("Move earlier/later in Favourites"
  when in Favourites, "Hide this channel").
- Category sheet: from `pinningFor(app, CategoryKind.Live)`.

### 1.8 Empty and error states

| Case | Shown |
|---|---|
| Lists not read yet | Nothing but the background (no flash of an empty message). |
| No channels at all (every count 0) | No rail, no grid: `EmptyNote(NOTHING_FROM_SOURCE)` when a source is picked, else `EmptyNote("Sources that sync from your account load here. Open Sources to see progress.")`. |
| List empty: Favourites | Grid area: "No favourite channels yet. Hold OK on a channel to add it." |
| List empty: Recently watched | "Channels you watch show up here." |
| List empty: other | "No channels in this list." (existing). |
| No EPG for a channel | One "No listings" cell across the window (existing `segmentsFor`); info pane "No listings for this time". |
| Provider listing fetch fails | Same as no EPG (repository already maps errors to empty). |
| Preview can't play | Logo on `Palette.sunken`, LIVE badge hidden. Never an error dialog. |

### 1.9 Reused vs new

Reused: `Guide.kt` constants, window/paging logic (`page`), `wantFocus` focus hand-off, `GuideCell`, `dayLabel`,
`Focusable`, `ChannelLogo`, `monogram`, `GlyphIcon`, `OptionsSheet`, `channelExtras`, `pinningFor`, `BackTo`,
`GuideRepository` queue and cache, `programmesInWindow`, `Media3Player.create`, `resolveStream`.

New: `core/guide/GuideGrid.kt` (pure helpers moved from `Guide.kt` plus `nowAndNext`, `listingsByChannel`),
`GuideRepository.storedListings`, `ui/sections/GuideRail.kt`, `ui/sections/LivePreview.kt`,
`SectionContext.focusNav`.

Deleted: `LiveSection`'s rows landing and `LiveBrowsing`, the pill `LazyRow` in `GuideScreen`, the `GUIDE` constant,
`HomeScreen`'s `openGuide` parameter and its "TV guide" header button (only Live used them).

### 1.10 Risks

1. **Live preview and provider connection limits.** Many Xtream accounts allow 1 stream. The preview player must be
   released before the full-screen player connects, and must never run while the section is covered. Mitigation: the
   preview is only composed while `ctx.active`; `Route.Play` sets `active = false` in the same frame, `onDispose`
   releases synchronously, and the full player only connects after `resolveStream` on a background dispatcher. Verify
   on a 1-connection account. Task T7 is isolated so it can be dropped without touching the rest.
2. **Fire TV stick decoder/memory.** One extra ExoPlayer while browsing. Debounce 800 ms, muted, `vod = false` buffers.
3. **Focus loss when the rail closes.** The focused rail item leaves composition before the grid cell requests focus.
   If D-pad goes dead on device, fall back to: keep the expanded rail composed until `withFrameNanos` after the grid
   cell reports focus, then collapse.
4. **`strings-diff` CI.** Removing the rows landing/Browse all may drop React Native sentences from Kotlin
   ("TV guide", "All categories", …). Each one that is intentionally gone goes into `parity/strings-allow.txt`.
5. **Big lists.** "All channels" can be 2000 rows. Only visible + lookahead rows are queried; never batch the whole list.

---

## Part 2: Implementation plan

Conventions: Kotlin style of the surrounding files (KDoc sentences on public things, no new dependencies, no
interfaces). Every task must compile on its own. Do **not** commit, push or publish (owner rule). Build commands are in
section 2.3.

Dependency graph:

```
T1 (core) ─┐
T2 (shell) ├─> T3 (data) ─> T4 (layout+focus) ─> T5 (rail) ─> T6 (sheets+LiveSection cleanup) ─> T8 (docs) ─> T9 (verify)
           │                                  └─> T7 (preview, optional, after T4; touches Guide.kt in one spot)
```

T1 and T2 can run in parallel. T5, T6 and T7 all edit `Guide.kt`; run them one after another (or in separate
worktrees and merge by hand).

### T1. Core: pure grid helpers and batched stored listings  [independent]

Files:
- **Create** `apps/tv-native/core/src/main/kotlin/com/evcalex/testcard/core/guide/GuideGrid.kt`
- **Modify** `apps/tv-native/core/src/main/kotlin/com/evcalex/testcard/core/guide/GuideRepository.kt`
- **Create** `apps/tv-native/core/src/test/kotlin/com/evcalex/testcard/core/GuideGridTest.kt`

`GuideGrid.kt` contents:

```kotlin
package com.evcalex.testcard.core.guide

import com.evcalex.testcard.core.db.ProgrammeRow

/** One stretch of a guide row: a programme, or time the listings do not cover. `loading`: the row has no listings yet. */
class GuideSegment(val start: Long, val end: Long, val airing: Airing?, val loading: Boolean = false)

/**
 * A row's programmes cut to [from, to), with the gaps filled so every part of the row can be reached. Null airings (not
 * loaded) give one loading segment. Airings must be in start order; overlaps are trimmed to start where the last ended.
 */
fun segmentsFor(airings: List<Airing>?, from: Long, to: Long): List<GuideSegment>
// body: the existing Guide.kt segmentsFor, with Segment(key,start,end,airing,"none") -> GuideSegment(start,end,airing)
// and the "loading" case -> GuideSegment(from, to, null, loading = true).

/** What is on at `at` and the first programme starting after it, or null when the list has neither. */
fun nowAndNext(airings: List<Airing>, at: Long): ChannelGuide? {
    val now = airings.firstOrNull { it.start <= at && at < it.end }
    val next = airings.firstOrNull { it.start > at }
    return if (now == null && next == null) null else ChannelGuide(now, next)
}

/** Programme rows (ordered by channel then start) as each channel's airings; zero-length or inverted rows dropped. */
fun listingsByChannel(rows: List<ProgrammeRow>): Map<String, List<Airing>> =
    rows.filter { it.endAt > it.startAt }.groupBy({ it.channelId }) { Airing(it.title, it.startAt, it.endAt) }
```

`GuideRepository.kt` changes:
- Add constants `private const val PAST_MS = 6 * 60 * 60 * 1000L` and `private const val AHEAD_MS = 36 * 60 * 60 * 1000L`;
  use them in `readListings` (same values as today, EPG-02).
- Add, below `knownListings`:

```kotlin
/**
 * Listings from the imported guide for many channels in one query, kept like [fetchListings]'s. Channels already fresh
 * are not asked again; channels the imported guide does not have are missing from the result (ask [fetchListings]).
 */
suspend fun storedListings(channelIds: List<String>): Map<String, List<Airing>> {
    val out = HashMap<String, List<Airing>>()
    val missing = ArrayList<String>()
    for (id in channelIds) knownListings(id)?.let { out[id] = it } ?: missing.add(id)
    if (missing.isEmpty()) return out
    val at = nowMs()
    val found = listingsByChannel(db.read { it.programmesInWindow(missing, at - PAST_MS, at + AHEAD_MS) })
    val until = nowMs() + LISTINGS_FRESH_MS
    for ((id, airings) in found) { listings[id] = Listing(airings, until); out[id] = airings }
    return out
}
```
- In `readListings`, replace `stored.map { Airing(...) }` with `listingsByChannel(stored)[channelId].orEmpty()` and
  keep the `isNotEmpty` check on that result.

`GuideGridTest.kt` (JUnit 5, `org.junit.jupiter.api.Test`, same style as `PlayerStateTest`), tests:
- `nullAiringsGiveOneLoadingSegment`: `segmentsFor(null, 0, 100)` → one segment 0..100, `loading == true`.
- `gapsAreFilledAndEdgesClipped`: airings `[-50..20 "A", 40..70 "B", 90..200 "C"]`, window 0..100 → segments
  `0..20 A`, `20..40 gap`, `40..70 B`, `70..90 gap`, `90..100 C`; assert starts, ends, titles, `airing == null` for gaps.
- `overlapsAreTrimmed`: `[0..60 A, 30..90 B]`, window 0..100 → `0..60 A`, `60..90 B`, `90..100 gap`.
- `emptyListingsGiveOneGap`: `segmentsFor(emptyList(), 0, 100)` → one gap, `loading == false`.
- `nowAndNextPicksCoveringAndFollowing`: at 50 with `[0..40, 40..60, 60..80]` → now 40..60, next 60..80; at 100 → null;
  at -10 → now null, next 0..40.
- `listingsByChannelGroupsAndDrops`: rows for "a" (two), "b" (one with end == start) → `{"a": 2 airings}` only.

Done when: `:core:test --tests "com.evcalex.testcard.core.GuideGridTest"` passes and `:core:test` still passes.

### T2. Shell: let a page send focus to its nav tab  [independent]

File: `apps/tv-native/app/src/main/kotlin/com/evcalex/testcard/tv/ui/shell/Shell.kt`
- Add to `SectionContext` (last parameter, default so no other caller changes):
  `/** Puts the remote on the open section's tab in the nav bar (Up from a page's top edge). */ val focusNav: () -> Unit = {}`
- In `Shell`, where `SectionContext(...)` is built (line ~168), pass
  `focusNav = { runCatching { tabFocus.getValue(section).requestFocus() } }` as a named argument.

Done when `:app:compileDebugKotlin` passes.

### T3. Guide data: batched, prefetched listings  [needs T1]

File: `apps/tv-native/app/src/main/kotlin/com/evcalex/testcard/tv/ui/sections/Guide.kt`
1. Delete the private `Segment` class and `segmentsFor`; import `com.evcalex.testcard.core.guide.GuideSegment`,
   `segmentsFor`, `nowAndNext`. `Focused` becomes `private class Focused(val channel: ChannelRow, val segment: GuideSegment)`.
   In `GuideRow`, `key(segment.key)` → `key(segment.start)`; `segment.empty == "loading"` → `segment.loading`.
2. Add constants: `private const val LOOK_BEHIND = 4`, `private const val LOOK_AHEAD = 12`,
   `private const val LISTINGS_REFRESH_MS = 20 * 60_000L`.
3. In `GuideScreen`:
   - `val gridState = rememberLazyListState()`; pass it to the `LazyColumn(state = gridState, ...)`.
   - `val listings = remember { mutableStateMapOf<String, List<Airing>>() }`.
   - Add:

```kotlin
LaunchedEffect(channels, active, app.version, now / LISTINGS_REFRESH_MS) {
    if (!active || channels.isEmpty()) return@LaunchedEffect
    snapshotFlow { gridState.layoutInfo.visibleItemsInfo.let { (it.firstOrNull()?.index ?: 0) to (it.lastOrNull()?.index ?: 0) } }
        .distinctUntilChanged()
        .collectLatest { (first, last) ->
            delay(80) // let a held key settle before querying
            val ids = channels.subList(maxOf(0, first - LOOK_BEHIND), minOf(channels.size, last + 1 + LOOK_AHEAD)).map { it.id }
            val stored = withContext(Dispatchers.Default) { guides.storedListings(ids) }
            listings.putAll(stored)
            for (id in ids) if (id !in stored) launch { listings[id] = withContext(Dispatchers.Default) { guides.fetchListings(id) } }
        }
}
```
     (`val guides = app.guides`; imports `snapshotFlow`, `kotlinx.coroutines.flow.distinctUntilChanged`,
     `kotlinx.coroutines.flow.collectLatest`, `kotlinx.coroutines.launch`, `mutableStateMapOf`,
     `androidx.compose.foundation.lazy.rememberLazyListState`.)
   - `GuideRow(...)` gets a new first data parameter `airings: List<Airing>?` = `listings[channel.id]`.
4. In `GuideRow`: delete the `produceState` that calls `fetchListings`; use the `airings` parameter;
   `ctx` parameter is no longer needed, remove it.
5. In `GuideCell`: loading segment draws `Palette.raised.copy(alpha = 0.5f)` background, no border, no text.

Done when it compiles and, on the emulator, scrolling the grid shows filled rows without per-row "Loading".

### T4. Guide layout and focus rules  [needs T2, T3]

File: `Guide.kt`.
1. Remove the pill `LazyRow` and the `GuideList` pill usage from the layout (keep `GuideList`; T5 extends it).
2. Root: `Box(Modifier.fillMaxSize().padding(top = 104.dp))` containing a `Column(Modifier.fillMaxSize().padding(start = 134.dp, end = 44.dp))`
   with: `LiveHeader(focused, listings, now, Modifier.height(284.dp))`, the ruler (existing code, height 44), the grid
   `Box` (existing). Leave x 0..110 free for the rail (T5 draws it; until then it is blank).
3. Replace `Details` with `@Composable private fun LiveHeader(focused: Focused?, listings: Map<String, List<Airing>>, now: Long, modifier: Modifier)`:
   `Row(spacedBy(32.dp))` of `PreviewFrame(focused?.channel)` (448×252) and the info `Column` per section 1.3.
   `@Composable private fun PreviewFrame(channel: ChannelRow?, picture: @Composable () -> Unit = {})`: rounded 12 dp
   `Palette.sunken` box; `ChannelLogo` centred in a 200×120 box as the fallback; `picture()` drawn over it full size;
   LIVE badge top-left (padding 18/16) only when `channel != null`. Progress bar: `Box(fillMaxWidth(0.6f).height(4.dp).background(Palette.border))`
   with an inner `fillMaxWidth(fraction)` `Palette.accent` box; fraction `((now - start) / (end - start)).coerceIn(0f, 1f)`.
   "N min left" = `max(1, round((end - now) / 60000.0))` (same as today's Details).
4. Channel column in `GuideRow`: number `AppText(channel.channelNumber?.toString() ?: "", 22, Palette.muted, align = TextAlign.End, modifier = Modifier.width(56.dp))`,
   logo box 80×56, name (20, muted, 2 lines), spacing 12.
5. Up from row 0: `GuideRow` gets `rowIndex: Int`; `GuideCell` gets `onUpEdge: (() -> Boolean)?` (non-null only for
   `rowIndex == 0`, value `{ ctx.focusNav(); true }`). In the cell's `onKeyEvent`, before the Right/Left checks:
   `event.key == Key.DirectionUp && onUpEdge != null -> onUpEdge()`.
   Use `onPreviewKeyEvent` instead of `onKeyEvent` for the Up case so the LazyColumn does not try to scroll first.
6. Down from the nav: add `.focusRestorer()` to the `LazyColumn` modifier (import `androidx.compose.ui.focus.focusRestorer`,
   already used in `SeriesDetail.kt`).
7. `backToTop`: `LaunchedEffect(ctx.backToTop) { if (ctx.backToTop > 0) { offsetMin = 0; gridState.scrollToItem(0); focused = null } }`.
   Use a `remember { intArrayOf(ctx.backToTop) }` guard so it does not fire on first composition.

Done when it compiles; emulator: Up from row 0 lands on the Live TV tab; Down returns to the same cell.

### T5. Category rail  [needs T4]

Files:
- **Create** `apps/tv-native/app/src/main/kotlin/com/evcalex/testcard/tv/ui/sections/GuideRail.kt`
- **Modify** `Guide.kt`

`GuideRail.kt`:

```kotlin
package com.evcalex.testcard.tv.ui.sections

/** One list the guide can show: "favourites", "recent", a category id, or "all". */
internal class GuideList(val id: String, val label: String, val count: Int, val mark: RailMark)

/** What the collapsed rail draws for a list. */
internal sealed interface RailMark { class Icon(val glyph: Glyph) : RailMark; class Letters(val text: String) : RailMark }

internal const val RAIL_COLLAPSED_W = 110
internal const val RAIL_OPEN_W = 440
private const val RAIL_ITEM_H = 60
private const val PICK_DELAY_MS = 250L

/**
 * The Live TV list rail. Collapsed: a strip of marks, not focusable. Open: names and counts over the guide, focus held
 * inside; resting on an item for [PICK_DELAY_MS] calls `onPick`; OK or Right calls `onClose(id)` with the item under the
 * remote; Back is handled by the caller. A separator follows "recent".
 */
@Composable
internal fun GuideRail(
    lists: List<GuideList>, current: String, open: Boolean,
    onPick: (String) -> Unit, onClose: (String) -> Unit, onLongPress: (GuideList) -> Unit,
    requesters: Map<String, FocusRequester>, state: LazyListState,
)
```

Implementation notes for `GuideRail`:
- Root `Box(Modifier.fillMaxHeight().width((if (open) RAIL_OPEN_W else RAIL_COLLAPSED_W).dp).zIndex(1f).background(Palette.sunken))`,
  right border 1 dp `Palette.border`; when open add `.shadow(24.dp)`.
- `LazyColumn(state = state, contentPadding = PaddingValues(vertical = 20.dp, horizontal = 14.dp), verticalArrangement = spacedBy(6.dp))`;
  when `open`, modifier `.trapFocus()` (from `ui/components/Overlays.kt`).
- Collapsed item: plain `Box(height 60, fillMaxWidth, contentAlignment = Center)` with the mark (`GlyphIcon(glyph, color, 28.dp)` or
  `AppText(text, 20, color, SemiBold)`), color `Palette.accent` if `id == current` else `Palette.faint`. No `Focusable`.
- Open item: `Focusable(onClick = { onClose(item.id) }, Modifier.fillMaxWidth().height(60.dp).onPreviewKeyEvent { … }, RoundedCornerShape(10.dp), onLongClick = { onLongPress(item) }.takeIf { item.mark is RailMark.Letters }, onFocusChange = { if (it) pending = item.id }, focusRequester = requesters[item.id], ring = false, background = Color.Transparent, focusedBackground = Palette.accent)`.
  Key handler: KeyDown + `repeatCount == 0` + `DirectionRight` → `onClose(item.id); true`; `DirectionLeft` → `true`.
  Content: Row(mark 44 wide, label 24, count 19 faint, end-aligned); focused text `Palette.accentInk`.
- After the item with id `"recent"`: `Box(Modifier.padding(horizontal = 10.dp, vertical = 8.dp).fillMaxWidth().height(1.dp).background(Palette.border))`.
- `var pending by remember { mutableStateOf<String?>(null) }`; `LaunchedEffect(pending) { val id = pending ?: return@LaunchedEffect; delay(PICK_DELAY_MS); onPick(id) }`.

`Guide.kt` changes:
1. Replace the `lists` producer to build `List<GuideList>` and add `tick` (`var tick by remember { mutableIntStateOf(0) }`) to its keys and
   to `channels`' keys:
   - `GuideList("favourites", "Favourites", favourites, RailMark.Icon(Glyph.Star))`
   - `GuideList("recent", "Recently watched", recents, RailMark.Icon(Glyph.Restart))`
   - each `categories.filter { it.count > 0 }` → `GuideList(c.id, c.label, c.count, RailMark.Letters(monogram(c.label).take(3)))`
   - `GuideList("all", "All channels", categories.sumOf { it.count }, RailMark.Letters("All"))`
   Initial value `null` (not loaded); `channels` initial value `null` too.
2. `listId`: `rememberSaveable { mutableStateOf<String?>(null) }`; default list = `favourites` if its count > 0, else
   `recent` if > 0, else `all`.
3. Rail state: `var railOpen by remember { mutableStateOf(false) }`, `val railState = rememberLazyListState()`,
   `val railRequesters = remember(lists) { lists.orEmpty().associate { it.id to FocusRequester() } }`,
   `val scope = rememberCoroutineScope()`.

```kotlin
fun openRail() {
    railOpen = true
    scope.launch {
        railState.scrollToItem(maxOf(0, lists.orEmpty().indexOfFirst { it.id == shownList }))
        withFrameNanos { }
        runCatching { railRequesters[shownList]?.requestFocus() }
    }
}
fun closeRail(id: String) {
    listId = id
    scope.launch {
        // Wait for the picked list's channels before choosing the row to land on.
        snapshotFlow { channelsFor }.first { it == id }
        val keep = focused?.channel?.id
        val index = channels.orEmpty().indexOfFirst { it.id == keep }.coerceAtLeast(0)
        offsetMin = 0
        gridState.scrollToItem(index)
        wantFocus = channels.orEmpty().getOrNull(index)?.let { it.id to nowMs() }
        railOpen = false
    }
}
```
   `channelsFor` is a `var channelsFor by remember { mutableStateOf<String?>(null) }` set to `shownList` inside the
   `channels` producer after `value = …`, so `closeRail` knows the grid shows the new list.
4. `page(cell, -1)` when `offsetMin == 0`: call `openRail()` and return true. Guard: only when
   `event.nativeKeyEvent.repeatCount == 0` (already true in `GuideCell`).
5. `BackTo(railOpen) { closeRail(shownList) }` (`BackTo` is in `SectionSupport.kt`).
6. Draw: in the root `Box` (from T4), first the content Column, then when `railOpen` a scrim
   `Box(Modifier.fillMaxSize().background(Color(0x9E050709)))`, then `GuideRail(...)` aligned `TopStart`.
   `onPick = { listId = it }`.
7. Remove the old `LaunchedEffect(shownList) { offsetMin = 0; wantFocus = null }` behaviour only where it fights the
   rail: keep `offsetMin = 0`, keep `wantFocus = null`, but the first-row auto focus
   (`LaunchedEffect(shownList, firstId)`) must not run while `railOpen` (add `&& !railOpen`).
8. Category long-press: `var categorySheet by remember { mutableStateOf<GuideList?>(null) }`; when set, read
   `val pinning = app.db.read { it.pinningFor(app, CategoryKind.Live) { tick++ } }` in a `produceState` and show
   `OptionsSheet(title = list.label, options = listOf(SheetOption("pin", if (list.id in pinning.pinned) "Pinned to Home. Press to remove" else "Pin to Home"), SheetOption("hide", "Hide category")), onChoose = { … pinning.toggle(list.id, list.label) / pinning.hide(list.id, list.label); categorySheet = null }, onClose = { categorySheet = null })`.
   After hiding, if `shownList == list.id` set `listId = null` (falls back to the default list).
9. Empty states from section 1.8 (`EmptyNote` for no channels at all; per-list messages in the grid area).

Done when: emulator, Left at the first cell opens the rail on the current list; moving filters the grid after 250 ms;
Right/OK/Back close it and focus lands on a grid cell; Back again goes to the nav bar.

### T6. Channel sheet, LiveSection cleanup, strings  [needs T5]

Files: `Guide.kt`, `LiveSection.kt`, `SectionSupport.kt`, `ui/home/HomeScreen.kt`, `AppContent.kt` (only if the
call changes), `apps/tv-native/parity/strings-allow.txt`.
1. `GuideCell`: pass `onLongClick = { onLongPress(channel) }` to `Focusable`; thread `onLongPress: (ChannelRow) -> Unit`
   through `GuideRow`.
2. In `GuideScreen`: `var channelSheet by remember { mutableStateOf<ChannelRow?>(null) }` and

```kotlin
val sheetActions by produceState(emptyList<DetailAction>(), channelSheet) {
    val channel = channelSheet
    if (channel == null) { value = emptyList(); return@produceState }
    val refresh = { tick++ }
    value = buildList {
        add(DetailAction("watch", "Watch live", ActionGlyph.Restart) { play(channel) })
        add(DetailAction("favourite", if (channel.isFavourite) "Remove from Favourites" else "Add to Favourites", ActionGlyph.Plus) {
            app.scope.launch { app.db.write { it.toggleFavourite(channel.id) }; app.sync.notifyLocalChange(); refresh() }
        })
        if (shownList == "recent") add(DetailAction("forget", "Remove from Recently watched", ActionGlyph.Cross) {
            app.scope.launch { app.db.write { it.removeChannelFromRecents(channel.id) }; refresh() }
        })
        addAll(channelExtras(app, channel.id, channel.normalisedName, shownList == "favourites", refresh))
    }
}
if (channelSheet != null && sheetActions.isNotEmpty()) OptionsSheet(
    channelSheet!!.normalisedName, sheetActions.map { SheetOption(it.key, it.label) },
    onChoose = { key -> sheetActions.firstOrNull { it.key == key }?.onPress?.invoke(); channelSheet = null },
    onClose = { channelSheet = null },
)
```
   Note `refresh` runs on `app.scope` (Default dispatcher): `tick` must be a snapshot state (`mutableIntStateOf`), which
   is safe to write from any thread.
3. `LiveSection.kt`: replace the whole file body with

```kotlin
/** Live TV is the guide: lists on a rail at the left, channels and their programmes across the page. */
@Composable
fun LiveSection(ctx: SectionContext) = GuideScreen(ctx)
```
   Delete `LiveBrowsing` and `channelItem` (check `grep -rn "channelItem\|LiveBrowsing" apps/tv-native/app/src` is empty first).
4. `SectionSupport.kt`: delete `internal const val GUIDE = "guide"`. Keep `BROWSE` (Movies/Series use it).
5. `HomeScreen.kt`: remove the `openGuide` parameter and the `HeaderButton("TV guide", openGuide)` line; fix
   `offsetRows` to `if (browseAll != null) 1 else 0`. Check no other caller passes `openGuide`.
6. Run `node apps/tv-native/parity/strings-diff.mjs` from the repo root. For each sentence it reports as missing that
   belonged to the removed Live landing/Browse-all/TV-guide button, add a line to `parity/strings-allow.txt`. Do not
   allow-list anything else; if an unrelated sentence is reported, stop and investigate.

Done when it compiles, `strings-diff` reports 0 missing, and long-press on a cell offers the sheet.

### T7. Live preview  [needs T4; optional, risky: see 1.10]

Files: **Create** `apps/tv-native/app/src/main/kotlin/com/evcalex/testcard/tv/ui/sections/LivePreview.kt`; one line in
`Guide.kt` (`PreviewFrame(..., picture = { if (ctx.active) LivePreview(app, focused?.channel) })`).

```kotlin
/** How long the remote must rest on a channel before the preview tunes to it. */
private const val TUNE_DELAY_MS = 800L

/**
 * The focused channel playing, muted, in the guide's preview frame. Draws nothing until the picture starts or when the
 * channel can't play, so the logo behind shows. Released when it leaves composition (the full player must never share
 * the provider connection with it). Does not add the channel to Recently watched.
 */
@Composable
internal fun LivePreview(app: AppController, channel: ChannelRow?)
```
Implementation:
- `val context = LocalContext.current`; `val player = remember { Media3Player.create(context, app.http, vod = false).apply { volume = 0f } }`;
  `DisposableEffect(player) { onDispose { player.release() } }`.
- `var showing by remember { mutableStateOf(false) }`; a `Player.Listener` (added in a `DisposableEffect`) sets
  `showing = true` on `onRenderedFirstFrame`, `false` on `onPlayerError`.
- `LaunchedEffect(channel?.id) { showing = false; player.stop(); val c = channel ?: return@LaunchedEffect; delay(TUNE_DELAY_MS); val url = runCatching { withContext(Dispatchers.Default) { resolveStream(app.db, app.logins, PlayItem(PlayKind.Channel, c.id, c.normalisedName), false).url } }.getOrNull() ?: return@LaunchedEffect; player.setMediaItem(MediaItem.fromUri(url)); player.prepare(); player.play() }`
  (rethrow `CancellationException`; `runCatching` swallows it, so use try/catch like `PlayerScreen.kt` line ~99).
- `if (showing) AndroidView(factory = { PlayerView(it).apply { useController = false; setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER); isFocusable = false; isFocusableInTouchMode = false; descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS; resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT; this.player = player } }, modifier = Modifier.fillMaxSize())`
  (copy the setup from `Playing.kt` ~line 603). Keep the `AndroidView` composed (alpha 0 when not showing) if
  attaching late shows a black flash; decide on the emulator.
- LIVE badge in `PreviewFrame` shows always when a channel is focused (it labels the pane, not the stream).

Done when: on the emulator the preview tunes ~1 s after the remote rests, OK to full screen plays without a second
connection (check provider logs or the fake provider's request log), and Back from the player resumes the preview.

### T8. Docs  [needs T6]

- `apps/tv-native/parity/parity-report.md`: EPG-01 row note "Live TV opens on the guide; list rail replaces pills;
  Left at the first block with the window at now opens the rail"; add a row "LIVE-01/02 landing and Browse all:
  replaced by the guide (2026-10-05 spec); pin/hide category and channel actions moved to long-press sheets".
- `CONTEXT.md` glossary, after **Guide**: "- **Category rail** — on the Fire TV Live TV guide, the strip at the left
  listing Favourites, Recently watched, the categories and All channels; Left from the guide's first block opens it
  over the grid."

### T9. Verification checklist

Run from Git Bash. `/tmp/gw.sh` exists on this machine (wraps Gradle 8.14.3 at
`C:/Users/Administrator/AppData/Local/Temp/tcbuild/gradle-8.14.3` with JDK 17 and filters output). These are Kotlin/JVM
tests: no `ELECTRON_RUN_AS_NODE` (that is only for `packages/core` TypeScript tests).

1. `bash /tmp/gw.sh :core:test --tests "com.evcalex.testcard.core.GuideGridTest"` → BUILD SUCCESSFUL.
2. `bash /tmp/gw.sh :core:test` → all core tests pass (vectors, goldens, player state).
3. `bash /tmp/gw.sh :app:assembleDebug :app:lintDebug` → BUILD SUCCESSFUL, no new lint errors.
   If `/tmp/gw.sh` is missing: `cd apps/tv-native && JAVA_HOME="/c/Program Files/Microsoft/jdk-17.0.20.101-hotspot" /c/Users/Administrator/AppData/Local/Temp/tcbuild/gradle-8.14.3/bin/gradle :core:test :app:assembleDebug :app:lintDebug --console=plain`.
4. `node apps/tv-native/parity/strings-diff.mjs` → 0 missing.
5. Emulator (optional but needed for focus): `bash /tmp/gw.sh :app:installDebug -PsyncUrl=http://10.0.2.2:8787` with
   the local sync worker running, then check by hand:
   - Live TV opens on the guide; no rows ever show a "Loading" title; scrolling fast through All channels stays smooth.
   - Up from row 0 → Live TV tab; Down → same cell; Back in grid → tab; Back on tab twice → exit prompt then exit.
   - Left at first cell (window at now) opens the rail; Left with the window paged forward pages back instead.
   - Rail: Up/Down filters live; OK/Right/Back close; focus lands on a cell; Back in rail never reaches the nav.
   - Right at last cell pages +1 h up to 24 h (EPG-01); now-line moves within 30 s.
   - Long-press cell: favourite toggles and the Favourites count on the rail updates; Hide removes the row.
   - Long-press category on the rail: pin shows on Home; hide removes it from the rail.
   - Empty states: a source with no channels; an empty Favourites list; a channel without EPG.
   - Preview (T7): tunes after rest, muted, released before full screen.
6. Do not commit, push or run the release workflow; report to the owner.
