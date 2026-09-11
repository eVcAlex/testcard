# Phase 4a brief

> **Status: Phase 4a is done** (branch `phase-4a-polish`). A polish pass surfaced by using the
> app: the on-video overlay auto-hide bug, a real schema migration runner, a from-scratch theme
> (the hot-pink accent is gone), source editing/deletion, and playlist auto-refresh. See
> `docs/adr/0005-migration-runner.md` and `docs/adr/0006-theme-system.md`.

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
  round-tripping to the renderer even redacted, for a rarely-needed reference string.
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
