# ADR 0011: Profiles on the TV app swap their rows in and out of the usual tables

## Status

Accepted. Not yet run on a device.

## Context

Several people watch on one TV and each wants their own Continue watching, favourites, Home pins and caption
settings. Around a hundred queries in `packages/core` read those tables, and the desktop app and the sync worker
share them. A `profile_id` column on every personal table would touch all of them, the sync schema and the
worker's database.

## Decision

1. **The usual tables always hold the profile watching now.** The other profiles' rows wait as JSON in a
   `profile_stash` table. Switching moves the current profile's rows out and the chosen one's back in, in one
   transaction (`packages/core/src/db/profileSwap.ts`). No query knows profiles exist. The personal tables are
   the channel, film and series favourites and recents, `playback_progress`, `home_pins` and
   `sync_tombstones`, plus the `ui:captions` and `ui:audio` settings in `schema_meta`.
2. **Only the account's own profile ("Main") syncs.** `SyncController.setPaused` holds syncing off while any
   other profile is in the tables, waiting out a sync already under way first. Otherwise that person's history
   would be pushed as the account's, and pending deletes (tombstones) would remove the account's rows. The
   controller starts paused if the app was left on another profile.
3. **The profile list is this TV's**, in `schema_meta` (`ui:profiles`, `ui:profile`). "Who's watching?" opens on
   launch when there are two or more. An optional 4-digit PIN, typed on an on-screen pad because a Fire TV remote
   has no number keys, is stored hashed. It keeps children out; it is not a security boundary.

## Consequences

- Nothing changes on the desktop app or the sync worker.
- While another profile watches, nothing syncs: sources added on another device and history from other devices
  arrive once Main is picked again.
- A stashed row that no longer fits when restored (a pin whose source was removed) is dropped.
