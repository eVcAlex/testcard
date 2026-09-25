# ADR 0011: Profiles swap their rows in and out of the usual tables, and sync under key prefixes

## Status

Accepted. Not yet run on a device. Needs the sync worker deployed with migration 0003.

## Context

Several people watch on one account's TVs and each wants their own Continue watching, favourites, Home pins and
caption settings, on every TV. Around a hundred queries in `packages/core` read those tables, and the desktop app
and the sync worker share them. A `profile_id` column on every personal table would touch all of them.

## Decision

1. **The usual tables always hold the profile watching now.** The other profiles' rows wait as JSON in
   `profile_stash`. Switching moves the current profile's rows out and the chosen one's back in, in one transaction
   (`packages/core/src/db/profileSwap.ts`). No query knows profiles exist. The personal tables are the channel, film
   and series favourites and recents, `playback_progress`, `home_pins` and `sync_tombstones`, plus the
   `ui:captions` and `ui:audio` settings in `schema_meta`.
2. **The profile list is the account's.** Core's `profiles` table syncs through a new `profiles` array in push and
   pull. Each profile is encrypted like a source's login, so the server holds no names. `main`, the account's own
   profile, always exists and cannot be deleted. Which profile is watching is the TV's own (`ui:profile`).
3. **Each profile's history syncs under its own keys.** Main's favourites, recents and progress keep the keys they
   always had. Another profile's go under `p.<id>.`. A pull names the profile (`?profile=<id>`), and the worker
   returns only that profile's rows. With no profile named it returns only Main's, so a device that names none never
   sees rows it cannot match, which would hold its cursor back. Each profile keeps its own pull cursor, swapped with
   its rows. Switching pushes the leaving profile's changes first, then holds syncing off across the swap.
4. **Home pins stay Main's in sync.** They ride in the source's record. While another profile watches, a source is
   pushed without pins, and pins that arrive for a source wait for Main (`holdPinsForMain`). Other profiles' pins,
   channel favourites and caption settings are kept on each TV.
5. **An optional 4-digit PIN** is typed on an on-screen pad, because a Fire TV remote has no number keys. It is
   stored hashed. It keeps children out; it is not a security boundary.

## Consequences

- The worker must be deployed (`pnpm --filter @testcard/sync-worker db:migrate:remote`, then `deploy`) before a
  profile other than Main is used. An older worker ignores the profile list and filter, and an older desktop app
  would then stall on the other profiles' rows.
- A deleted profile's rows stay on the server, unreferenced.
- A stashed row that no longer fits when restored (a pin whose source was removed) is dropped.
- **The desktop app switches profiles too, but never asks for a PIN.** It reuses the same core
  `swapProfile`/sync-profile machinery as the TV (`apps/desktop/src/main/ipc.ts`'s `profiles` IPC, with no per-profile
  `schema_meta` settings to move yet — the `ui:captions`/`ui:audio` swap stays TV-only). The desktop PC is treated as
  trusted: a profile locked with a PIN on a TV can be opened from desktop with no prompt. Desktop's own UI also never
  sets or changes a PIN — that stays a setting made on the TV. The avatar set, colours and PIN hash moved from
  `apps/mobile/src/state/profiles.ts` into core's `db/profileIdentity.ts` so both apps agree on them; the renderer
  can't import that module at runtime (it pulls in better-sqlite3), so `apps/desktop/src/renderer/src/player/profileDisplay.ts`
  keeps a browser-safe copy of the avatar and colour lists, kept in step by hand.
