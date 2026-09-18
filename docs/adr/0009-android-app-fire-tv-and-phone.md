# ADR 0009: One Expo app for Fire TV and Android phones, sharing packages/core

## Status

Accepted. First version built, not yet run on a device.

## Context

Testcard is an Electron app, which cannot run on Fire OS or Android. The goal is a Fire Stick app
(older, sideloaded sticks are the main target) and later an Android phone app, without forking the
logic that already exists in `packages/core`: parsing, classification, import, the sync client.

## Decision

1. **One app, `apps/mobile`, in this monorepo.** Expo with `react-native-tvos` as the `react-native`
   package, so one codebase builds for Android TV / Fire TV (`EXPO_TV=1`, which the
   `@react-native-tvos/config-tv` plugin turns into the leanback launcher intent) and for phones
   (`EXPO_TV=0`). iOS and Apple TV are out of scope for now.
2. **Core stays platform-free.** Core already touches no Electron or React; the boundary test now
   also rejects Expo and the mobile app. Where core needed something platform-specific it takes it as
   a parameter:
   - `migrateDatabase(db)` split out of `openDatabase(path)`, so the phone can migrate a database it
     opened itself.
   - `SyncController` moved from the desktop main process into core, taking a `SyncPlatform`
     (base URL, credential store, account-password store, id generator). Desktop passes Electron's
     `safeStorage` implementation; the mobile app passes the Android keystore.
   - `importCatalogue` holds the live/movie/series import that used to live inside desktop's
     `ipc.ts`; both apps call it.
   - `splitTitle` and `categoryLabel` moved into core.
3. **SQLite through an adapter.** Core speaks better-sqlite3's synchronous API. `apps/mobile` gives
   expo-sqlite that shape (`prepare().run/get/all`, `exec`, `transaction`, named parameters), which is
   all core uses, so no query was rewritten.
4. **Secrets in the Android keystore** (expo-secure-store): one entry per source login and one for
   the account password, never in the SQLite file. Same rule as desktop.
5. **Runtime shims.** `react-native-quick-crypto` installs `crypto.subtle` (PBKDF2, AES-GCM, SHA-1)
   that sync and remote keys need; Expo's streaming `fetch` replaces the global one so a playlist is
   parsed as it downloads. `parseM3U` accepts a reader-only stream as well as an async iterable.
6. **Metro** is told to resolve core's `./x.js` imports to `./x.ts`. The app imports core by deep path,
   never the barrel, which would pull in the native better-sqlite3 module.
7. **The TV UI is its own UI.** Every control is a focusable with a visible ring, sized for a sofa;
   there is no hover, and Back always leaves the current screen. Sources are added on the desktop and
   arrive through sync, so the TV needs no keyboard entry of provider logins.
8. **APKs are built by GitHub Actions** (`.github/workflows/android-apk.yml`, manual trigger) because
   no Android SDK is needed on a developer machine. They are signed with Expo's debug key, which is
   enough to sideload.

## Consequences

- Not in the first version: the TV guide (EPG import depends on stream decompression that Hermes lacks),
  adding or editing sources on the device, search, toggling favourites, category filtering of Movies
  and Series, audio and subtitle track pickers.
- Verified without a device: typecheck, the Android JS bundle builds (Hermes bytecode), the generated
  manifest carries the leanback launcher and cleartext HTTP (IPTV providers use `http://`), and core's
  tests. Not verified: anything that runs on a Fire Stick, including sync sign-in and playback.
- expo-video (Media3/ExoPlayer) plays HLS and MP4/MKV but is less forgiving than mpv on odd codecs.
  Falling back to an external player for a dead stream is a later option.
- Old sticks are slow. A large playlist import happens on the device today; if that is too slow the
  fix is to keep imports on the desktop and sync the catalogue down.
