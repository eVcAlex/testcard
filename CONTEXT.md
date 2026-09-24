# Testcard — domain context

A dark, watermark-free IPTV player for Windows. Talks to Xtream Codes and M3U providers,
plays back through an embedded `mpv`, stores everything locally.

## Glossary

- **Source** — one configured provider account (an Xtream login, or a plain M3U + optional
  XMLTV URL). A user may have several, managed from their own full-pane "Sources" screen (a
  sidebar tab, not a dialog) rather than a dialog or a sidebar row. Editable and removable in
  place: an edit keeps the same internal id, so Favourites/Recents survive it; `kind` (Xtream
  vs M3U) can never change on an existing Source — there's no UI for it, and it isn't a
  supported edit. Adding one offers two entry paths (an M3U/M3U8 URL or a pasted Xtream
  `get.php` link, vs. structured Xtream host/username/password fields) that both still end up
  as the same normalised shape below; the app never special-cases "Xtream" vs "M3U" outside
  `packages/core/src/source/`.
- **Source pick** — on the TV app, which Source every page shows: "All sources" (the default) or one. A single
  setting for Home, Live TV, Movies, Series and Search, your own rows (Continue watching, favourites, pins)
  included; kept on the device across launches, not synced. Chosen from a list under the nav bar's Source button,
  which only appears with two or more Sources.
- **Caption preferences** — on the TV app, how captions look (size, colour, background, edge) and whether films
  and episodes start with them on, in a chosen language (never another: wrong-language captions are worse than none).
  Kept on the device, not synced, beside the Source pick; set from the Settings tab or the player's captions panel.
  The look reaches the native player through a `captionStyle` prop added by `patches/expo-video@57.0.4.patch`.
- **Credits offer** — the "Watch credits / Next episode" buttons at the end of an episode. Where credits start is
  learned per series from when the viewer moves on to the next episode (`playback/credits.ts`, device-local); once
  learned, the next episode also starts after a countdown. Until then an estimate is used, with no countdown before
  the episode actually ends.
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
- **Category classification** — advisory metadata (`genre`, `language`, `service`, `tags`) derived
  from a Category's name by the pure `classifyCategory` rules and stored beside the untouched
  provider name. Never authoritative: unknown is `null`, and flags like `junk`/`separator` mark
  rather than hide. Recomputed on open when `CLASSIFIER_VERSION` changes. TypeSafe/Jev is used
  only by the developer to audit these rules — never at runtime. See
  `docs/adr/0007-category-classification-and-dev-time-ai.md`.
- **M3U films and episodes** — an M3U playlist is flat, so `classifyEntry` (`source/m3u/classifyEntry.ts`)
  decides per entry whether it is live, a film or an episode from the stream URL (`/movie/`,
  `/series/`, a video-file extension, never `/live/`) and an `S01E02` / `1x02` marker in the title.
  Films and episodes are stored in the same `movies` / `series` / `seasons` / `episodes` tables as
  Xtream VOD, with the direct stream URL as `provider_stream_id` / `provider_episode_id`, ids derived
  from the title (so a rotating token never orphans a favourite) and no lazy detail fetch. Anything
  unrecognised stays a live channel. See `docs/adr/0008-m3u-films-and-episodes.md`.
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
  (M3U `url-tvg` header / Xtream `xmltv.php`). Manual by default; a Source may also set a
  `refresh_interval_hours` (Off/6h/12h/24h), checked every 15 minutes by a background
  scheduler (`main/refreshScheduler.ts`) that's guarded against double-running a Source
  that's already mid-refresh.
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
- **Visual language:** "Mist" — a cool-neutral, restrained palette (a quiet teal `--accent`,
  never the old hot pink) laid out as a left sidebar (nav + a scrolling category list), a
  full-width multi-column channel grid, light + dark themes (default dark), and a fullscreen
  player view. Type is bundled Inter (self-hosted woff2). Channel cards show now/next + a
  progress bar from EPG; a timeline Guide tab shows the full grid. Tokens follow a shadcn-style
  semantic pair model (`--background`/`--foreground`, `--card`, `--border`,
  `--accent`/`--accent-foreground`, `--ring`) in `renderer/src/styles/tokens.css`, plus a small
  motion-token layer (`--dur-1/2/3`, `--ease-spring`) for a few hand-ported micro-interactions
  (spring-press buttons, a gliding focus ring, a logo-loading shimmer). See
  `docs/adr/0006-theme-system.md`.
- **EPG import** streams XMLTV on source refresh, batched to keep the app responsive, with
  progress pushed on `IPC_TASK_CHANNEL`. See `docs/adr/0003-epg-import.md`.
- **Aspect ratio** (fit/fill/16:9/4:3) is an mpv property re-applied per load and persisted
  like volume; **channel logos** are served through the `testcard-logo:` privileged scheme
  backed by a main-process disk cache. See `docs/adr/0004-player-refinements.md`.
- **Schema migrations** are forward-only: `SCHEMA_SQL` always describes the latest shape (a
  fresh install just runs it), and an ordered `MIGRATIONS` list brings an existing database
  up to date. See `docs/adr/0005-migration-runner.md`.
- The raw URL a user pastes to add an Xtream source is deliberately **stored nowhere** — it's a
  `get.php` link with the provider password in its query string, and `sources` briefly kept it
  in a plaintext `original_input` column (removed by migration v3) with no reader to justify the
  risk. Don't re-add it "for reference": credentials only ever live in `credentials.enc.json`.
