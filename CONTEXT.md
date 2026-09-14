# Testcard — domain context

A dark, watermark-free IPTV player for Windows. Talks to Xtream Codes and M3U providers,
plays back through an embedded `mpv`, stores everything locally.

## Glossary

- **Source** — one configured provider account (an Xtream login, or a plain M3U + optional
  XMLTV URL). A user may have several. All sources normalise into the same shape below; the
  app never special-cases "Xtream" vs "M3U" outside `packages/core/src/source/`.
- **Channel** — one logical live-TV channel as a human thinks of it — "TNT Sports 1". Has a
  **stable internal id** that survives playlist refreshes, independent of whatever id the
  provider assigns.
- **Channel Variant** — one concrete stream a provider offers for a Channel — a specific
  resolution/framerate ("1080p50", "720p25") each with its own provider stream id and URL.
  A Channel has one or more Variants. Providers routinely ship the same channel as five or
  more separate playlist entries differing only by variant; grouping them is a normalisation
  step, not a provider feature.
- **Category** — a provider's `group-title` (Xtream: `get_live_categories`), e.g.
  `UK| TNT Sports`. Raw categories are flat strings; the sidebar tree in the UI is a
  presentation-layer grouping by parsed **Country** prefix, not a separate domain concept.
- **Country** — parsed from a leading `XX|` prefix on a category name (`UK|`, `CA|`), when
  present. Absent for categories with no such prefix — those sit outside the country tree.
- **Normalised name** — a Channel's display name with unicode styling stripped (`ᵁᴴᴰ`,
  `ᴳᴬᴺᴶᴬ`, `ᴴᴰᴿ`, etc.), the quality suffix that identifies a Variant removed, and the
  country prefix separated out. This is what search (FTS5) indexes and what variant
  grouping keys on — one parser feeds both features.
- **Now/Next** — the current and following Programme for a Channel, resolved from EPG data
  at read time (`nowNextForChannels` / `resolveNowNext`). Not stored as its own concept;
  derived from `Programme` rows by time. Drives the channel-card second line + progress bar.
- **Programme** — one EPG entry for a Channel: title, start, end, description. Imported from
  XMLTV on source refresh (`importEpg`), keyed to Channels by `tvg_id`. Crosses IPC as
  `ProgrammeLite` (unix-ms `startMs`/`endMs`, never a `Date`). The Xtream per-channel
  `get_short_epg` path exists (`fetchShortEpg`) but is not yet wired.
- **Guide** — the timeline view: channels down a sticky gutter, a scrolling time axis, and
  `Programme` blocks on a px-per-minute scale. `epg.window(channelIds, from, to)` feeds it.
- **Dead channel** — a Variant that returns no stream data within the 10s playback timeout.
  Expected and frequent at 18k-channel scale; a designed UI state ("Channel didn't
  respond"), not an error.
- **Refresh** — re-fetching a Source's channel/category data, then its EPG. Channels are
  **diff-and-merge** against existing ones (matched by stable internal id), never a
  destructive rebuild — Favourites and Recents survive a renumber/rename. EPG is
  delete-then-insert per source (see `docs/adr/0003`), best-effort: a bad guide URL never
  fails the channel refresh. The EPG URL is the user's explicit one, else auto-detected
  (M3U `url-tvg` header / Xtream `xmltv.php`).
- **Favourite** — a user-starred Channel. Survives Refresh (see above).
- **Recent** — a Channel the user has played, most-recent-first. Survives Refresh.

## Key decisions

- Playback goes through an embedded `mpv.exe` child process (`--wid` + JSON IPC), not
  Chromium's `<video>` / `mpegts.js`, because the provider serves HEVC video and E-AC-3
  audio on its primary channels — codecs Electron's bundled Chromium does not decode.
  See `docs/adr/0001-mpv-playback-engine.md`.
- `packages/core` has zero dependency on Electron or React. It is the only part of this
  codebase a future Android/Firestick app would reuse — everything else in `apps/desktop`
  is assumed to be rewritten for that platform.
- mpv renders into a **frameless transparent child window** docked over the picture, not a
  child HWND inside the main window — DirectComposition was occluding it. A second such
  window carries the on-video overlay controls. See `docs/adr/0002-video-region-window.md`.
- **Visual language:** the surface follows IPTV Expert — a left sidebar (nav + a scrolling
  category list), a full-width multi-column channel grid, a hot-pink accent (`--accent`,
  fully tokenised in `renderer/src/styles/tokens.css`), light + dark themes (default dark),
  and a fullscreen player view. Type is bundled Inter (self-hosted woff2). Channel cards
  show now/next + a progress bar from EPG; a timeline Guide tab shows the full grid.
- **EPG import** streams XMLTV on source refresh, batched to keep the app responsive, with
  progress pushed on `IPC_TASK_CHANNEL`. See `docs/adr/0003-epg-import.md`.
- **Aspect ratio** (fit/fill/16:9/4:3) is an mpv property re-applied per load and persisted
  like volume; **channel logos** are served through the `testcard-logo:` privileged scheme
  backed by a main-process disk cache. See `docs/adr/0004-player-refinements.md`.
