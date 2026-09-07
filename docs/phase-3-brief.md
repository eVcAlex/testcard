# Phase 3 brief

> **Status: Phase 3 is done** (branch `phase-3-epg`). XMLTV EPG import, the timeline guide
> view, an aspect-ratio control, and a main-process logo cache. See
> `docs/adr/0003-epg-import.md` and `docs/adr/0004-player-refinements.md`.

## What shipped

1. **tvg-id** captured through the M3U/Xtream adapters into `channels.tvg_id` (first non-empty
   wins across a channel's quality variants).
2. **`importEpg`** — streaming XMLTV import in `packages/core`, delete-then-insert per source,
   batched with an event-loop yield between flushes. Runs as part of `sources.refresh`.
3. **EPG URL** — optional field on the add-source form; otherwise auto-detected from the M3U
   `url-tvg` header or Xtream `xmltv.php`. Best-effort: a bad URL never fails the refresh.
4. **Now/next** on channel cards — `HH:mm  Title` second line + a filling progress bar, from a
   batched `epg.nowNext(ids)` query refetched every 60 s.
5. **Guide** tab — a scrolling timeline (channels × time), `epg.window(ids, from, to)`,
   category-aware, capped at 200 channels.
6. **Aspect ratio** — `fit/fill/16:9/4:3` cycled from the overlay, an mpv property persisted
   like volume.
7. **Logo cache** — `testcard-logo://` privileged scheme, main-process fetch + disk cache
   under `userData/logo-cache`, CSP updated in both HTML entries.

Progress events use a new `IPC_TASK_CHANNEL` / `events.onTask` stream, kept off the playback
event bus so the overlay window doesn't see them.

## Verify on hardware (`pnpm dev`, then `pnpm package`)

- Add/refresh an M3U source with a `url-tvg` header → sidebar toast shows `· N programmes`;
  cards show now/next; the guide grid populates with the now-rule in the right place.
- Add an Xtream source → guide comes from `xmltv.php` with no manual URL.
- A large XMLTV import keeps the UI interactive and shows a live programme count.
- Aspect button visibly changes the picture and survives a channel change + app restart.
- `userData/logo-cache/` fills on first grid render; a dead logo URL still falls back to
  initials; no CSP violation in either window's console.
- Regression: HEVC + E-AC-3 playback, prev/next, dead-channel, both themes, overlay z-order.

## Carry-overs

- Xtream `get_short_epg` per-channel EPG (`fetchShortEpg`, already written) for providers with
  no `xmltv.php`.
- Guide virtualization for categories over ~200 channels (`@tanstack/react-virtual` is a dep).
- Logo cache eviction / size cap.
- A real schema migration runner — still `CREATE TABLE IF NOT EXISTS` only.
- `packages/core` DB code has no unit tests (better-sqlite3 ABI is Electron's, not Node's).
