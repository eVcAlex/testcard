# ADR 0016: Manage Sources and Profiles from the web player

## Status

Proposed (2026-10-14). Built on the web player branch; the pull request waits for, or includes, that branch.

## Context

Typing an Xtream link or an M3U address with a TV remote is slow. The web player (`apps/player`, served at `/watch`)
already signs in, opens the account's sealed Sources and Profiles in the browser with the password, and holds a session.
Managing them there is one more use of what it already has, not a second client.

Checked in the code before deciding:

- **Devices already take a Source made or edited elsewhere** (`syncController.ts`, the `applyRemoteChanges` callback):
  an unknown `remoteKey` creates the Source; a known one takes the newer name, login, backup hosts, content, pins and
  guide address. Last write wins on `updatedAt`. A web edit needs no device-side change to land.
- **Source identity** follows `saveSource` on the TV, not the older lines of `CONTEXT.md`: an Xtream Source's key is
  `remoteKeyFor(baseUrl, "source")`, a playlist's `remoteKeyForPlaylist(url)`, and an edit keeps the key. The sealed
  payload carries `keyHost`, the address history is matched by, so a provider that moves keeps its favourites.
- **`WEB_PLAYER = "off"` gates only the stream proxy** (`/watch/p`). Sign-in and sync work with it off, so managing
  works before streaming is switched on.
- **The player already sends provider logins through the Worker** (the proxy carries the login in the provider URL).
  Managing adds nothing to what the Worker can see beyond that.

## Decision

1. **A "Manage" screen in `apps/player`**, reached from the "who is watching" screen (and from the browser header when
   the account has one profile, where that screen is skipped). Add, change, remove a Source; add, rename, recolour,
   remove a Profile. Not in v1: PINs, history, per-TV settings.
2. **End to end encrypted, in the browser.** The password unlocks the account in memory; nothing goes to browser
   storage. Signing out drops the password and the derived key (`forgetKey` in `credentialCrypto.ts`).
3. **Read-modify-write on the raw decrypted record** (`account.ts`). The editor overlays only the fields it edits and
   seals the rest as it was, never through the Zod shape (which would drop pins, hidden categories, skips, a profile's
   PIN, and anything a newer app adds). It also reads the account again just before each save, so a change made on a
   TV while the page was open is not written over.
4. **A record that cannot be opened is shown as locked and never sent.**
5. **Login check when it can be made.** A new or changed Xtream login is tried through the proxy: a provider that
   turns it down is refused; when the check cannot be made (proxy off, server out of reach) the source is kept and the
   page says it was saved unchecked. A playlist link is not fetched.
6. **Source form rules are shared** with the TV in `packages/core/src/sync/sourceDraft.ts` (server address, playlist
   and guide links, backup addresses, name and content). The TV keeps its own SQLite writes.
7. **Profile rules are the apps'.** Ids are letters and digits only; at most four; Main cannot be removed; removal is
   a tombstone, which devices take as the TV's own delete. A profile with a PIN asks for it before it is changed or
   removed (the PIN is never changed here).
8. **A missing salt is created** by the page (set once; a 409 means a device got there first, so it is read again).
9. **Sources fetched this visit are forgotten** after any save (`forgetCatalogue`): a source keeps its id through an
   edit, so what was cached for it is stale.

## Consequences

- The page holds decrypted provider logins and the password in memory while open. A page refresh asks for the
  password again.
- Clock skew in a browser can lose a last-write-wins race to a device. Devices already live with this.
- A device that gets a changed login or playlist address takes it but does not reload until its next refresh
  (see Follow-ups).

## Follow-ups (not v1)

- A device reloads a Source whose login or playlist address changed remotely (push its id to `addedSourceIds`).
- Set or change a PIN from the page.
- Hardware check: add a Source on the page and see it on the TV; edit its login; remove a profile.
