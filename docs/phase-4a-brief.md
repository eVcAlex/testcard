# Phase 4a brief

> **Status: Phase 4a and its 4a.1 follow-up are both done** (branch `phase-4a-polish`). Phase 4a
> was a polish pass surfaced by using the app: the on-video overlay auto-hide bug, a real schema
> migration runner, a from-scratch theme (the hot-pink accent is gone), source editing/deletion,
> and playlist auto-refresh. Phase 4a.1, immediately after, redid source management as its own
> screen after a side-by-side comparison against a reference app showed the sidebar-embedded
> version was too small to use — see "Phase 4a.1" below. See `docs/adr/0005-migration-runner.md`
> and `docs/adr/0006-theme-system.md`.

## What shipped

1. **Overlay auto-hide fix** — `useOverlayVisibility` now also tracks hover-over-the-bar and
   pointer-down-on-a-control, not just `mousemove`, so hovering a button motionless or holding
   a volume-slider drag no longer hides the bar mid-interaction. The inverted
   `onMouseLeave={bump}` (which re-revealed on exit) is gone. The faded bar is
   `pointer-events: none` until revealed, so it no longer eats clicks on the video behind it.
2. **Schema migration runner** — `packages/core/src/db/migrations.ts`: a pure
   `pendingMigrations(fromVersion)` plus an ordered `MIGRATIONS` list, run inside one
   transaction by `openDatabase`. `SCHEMA_VERSION` → 2, adding `sources.original_input` and
   `sources.refresh_interval_hours`. Unblocks every schema change after this one — see ADR 0005.
3. **Theme: "Mist"** — a from-scratch cool-neutral palette replacing the hot pink, on a
   shadcn-style semantic token model (`--background`/`--foreground`, `--card`, `--border`,
   `--accent`/`--accent-foreground`, `--ring`), a small motion-token layer
   (`--dur-1/2/3`, `--ease-spring`), and three hand-ported micro-interactions (spring-press
   buttons, a gliding search-focus ring, a logo-loading shimmer). Fixes three latent token bugs
   along the way: `--accent`/`--accent-foreground` are now theme-aware (light mode never
   overrode them before), `--track-wide` is now defined (every status pill rendered with
   default letter-spacing until now), and the unbundled, unused `--font-mono` is gone. See
   ADR 0006 for the full rationale, including why the overlay deliberately stays dark-glass in
   both themes.
4. **Source editing and deletion** — the sidebar's per-source kebab menu now has Edit and
   Remove alongside Refresh, each with its own pending state (a slow refresh on one source no
   longer disables every other row). Editing preserves the source's id (Favourites/Recents
   survive); `kind` can't change. Removing a source now also deletes its stored credentials
   (`deleteCredentials` had been dead code since Phase 2), prunes any Favourites/Recents left
   pointing at now-gone channels, and best-effort purges its cached logo files.
5. **Playlist auto-refresh** — a per-source `refresh_interval_hours` (Off/6h/12h/24h, set from
   the same form used to add/edit a source) and a `RefreshScheduler` that checks every 15
   minutes for sources whose interval has elapsed, refreshing them serially so an auto-refresh
   round can't hammer several providers at once. A `refreshingSourceIds` guard, shared with the
   manual refresh path, stops a due tick from double-running a source a user just refreshed by
   hand.

## Verify on hardware (`pnpm dev`, then `pnpm package`)

- **Overlay**: hover a control for 10s+ → stays visible; start a volume drag, hold still off
  the slider → stays until release; move away and wait → hides after 3s; click where the
  hidden bar was → nothing eaten.
- **Migration**: launch against a pre-4a `testcard.sqlite3` → opens clean, `schema_meta.version`
  = 2, the new `sources` columns exist, no data lost. A fresh install lands at the same state.
- **Theme**: both dark and light render correctly — check a `.btn--primary` fill, an
  accent-coloured label, and a focus ring in each (the accent now actually flips in light
  mode). `ErrorBoundary` matches (force a throw). Button press springs back without a layout
  shift; the search focus ring glides in; a cold-cache channel logo shimmers then resolves,
  and stops shimmering (not strobing) with Windows "Show animations" off.
- **Source editing**: rename a source; change an M3U URL and refresh — Favourites/Recents
  survive; edit an Xtream source leaving the password blank — still authenticates; change the
  password — re-probes. Remove a source → its channels/categories/programmes are gone,
  `credentials.enc.json` no longer has its key, no orphaned Favourites, no console errors.
- **Auto-refresh**: set a source to 6h (or edit the interval and the clock forward for a
  quicker test) → it refreshes on its own with the sidebar's usual progress note; a manual
  refresh mid-window still works and isn't double-run.
- Regression: HEVC + E-AC-3 playback, prev/next, guide, dead-channel, both themes, overlay
  z-order, no CSP errors.

## Carry-overs

- **Xtream edit UX**: editing an Xtream source shows its (non-secret) server URL plus
  blank-means-unchanged username/password fields, not a redacted display of the original
  pasted `get.php` URL — that URL embeds the password in cleartext and was judged not worth
  round-tripping to the renderer even redacted, for a rarely-needed reference string. (Phase
  4a.1 went further and stopped storing that URL at all — see below. Adding a source now offers
  the same structured fields on a dedicated Xtream tab, so a provider that hands out
  host/username/password separately no longer requires hand-assembling a `get.php` URL first.)
- **beui's view-transition theme toggle** (`document.startViewTransition()` + a clip-path
  circle reveal) — scoped out of the theme work as a "nice, not needed" detail. `useTheme.ts`
  is where it would slot in.
- **No semantic secondary colour palette** (red=live, amber=catchup, green=favourite, ...) —
  Mist keeps `--live` as the one reserved warm colour rather than adopting a colour-coded
  language app-wide; revisit if Phase 4b's VOD/series UI wants more status colours.
- Everything Phase 3 already carried over is still open: Xtream `get_short_epg`, guide
  virtualization past ~200 channels, logo-cache eviction, and `packages/core`'s DB code having
  no unit tests (better-sqlite3's ABI is Electron's, not plain Node's) — see
  `docs/phase-3-brief.md`.
- **Phase 4b (VOD & series)** is next and is unstarted — see the phase-4 plan's sketch for the
  domain/schema/adapter shape it needs. The migration runner this phase built is its main
  prerequisite from 4a.

## Phase 4a.1 — source management as a real screen

Using the app surfaced that Phase 4a's sidebar-embedded source editor was too small: the edit
form's "Save changes" button wrapped onto two lines, URL fields truncated after ~20 characters,
and every field was placeholder-only with no label. Comparing against a reference app that gives
source management a whole screen prompted this follow-up.

### What shipped

1. **A stored-credential leak, found while planning this** — `sources.original_input` held the
   raw `get.php` URL pasted to add an Xtream source, which carries the provider password in its
   query string, written to unencrypted `testcard.sqlite3` alongside the DPAPI-encrypted
   `credentials.enc.json` that exists specifically to avoid this. The column also had no reader
   (Phase 4a's edit form deliberately never round-tripped it — see the carry-over above), so it
   was pure write-only risk. Migration v3 drops it; `SCHEMA_VERSION` → 3.
2. **Structured Xtream add** — `AddSourceInput` is now a discriminated union on `via` ("url" vs
   "xtream"), not the source's resulting `kind` (a "url" paste that's a `get.php` link still
   produces an Xtream source, exactly as before). The add form gets an M3U/Xtream segmented
   control; the Xtream tab is host + username + password fields, no URL to hand-assemble.
3. **A dedicated Sources screen** — `BrowseTab` gains `"sources"`, following the same pattern
   `"guide"` already set: a sidebar tab that swaps out the whole main pane. The old sidebar row
   list, inline add form, and `addOpen` state are gone; `SourcesView` owns list/add/edit
   navigation locally. A fresh install (no sources yet) lands there automatically instead of on
   an empty channel grid.
4. **Real form fields** — every input in `SourceForm` gets a label and, where useful, a hint,
   replacing placeholder-only fields. Also fixed in passing: an edit's `["sources"]` cache
   invalidation was previously the caller's job and `SourceRow`'s edit path forgot it, so a
   rename didn't show until something else refreshed the list; it now lives in `SourceForm`
   itself. `formatRelative` (the "refreshed 2h ago" note) now floors instead of rounds its
   minutes/hours math, so 59m30s no longer reads "60m ago".

### Verify on hardware

- Open `testcard.sqlite3` → no `original_input` column, `schema_meta.version` = 3, existing
  sources still refresh.
- Add an Xtream source via the new tab (host + username + password, no URL) → authenticates and
  imports. Pasting a full `get.php` URL into the M3U tab still detects Xtream, as before.
- Sidebar → Sources: card list with host, kind pill, relative refresh time; kebab menu behaves
  as it did in the sidebar; back arrow returns from add/edit. Renaming a source shows the new
  name immediately on return, without needing an unrelated refresh first.
- A database with no sources opens straight to the Sources screen; adding one doesn't force you
  back there afterwards.
- Regression: favourites/recents survive an edit + refresh; auto-refresh, both themes, and the
  overlay are all untouched by this pass.

### Carry-overs

Everything Phase 4a and Phase 3 already carried over is still open (see above). Nothing new was
deferred in this pass.
