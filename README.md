# Testcard

A dark, watermark-free IPTV player for Windows and Fire TV. Xtream Codes and M3U sources, live TV
with a guide, films and series, and one account that keeps sources, favourites and where you left
off in step across devices. SQLite-backed, so it stays fast at tens of thousands of channels.

Built as a free alternative to the paywalled features (dark mode, no watermark, playlist
auto-refresh) of commercial IPTV players. See [`CONTEXT.md`](CONTEXT.md) for the domain glossary and
[`docs/adr/`](docs/adr) for the decisions behind non-obvious choices.

## What it does

**Both apps**
- Xtream and M3U sources: live channels, films and series, with catch-up where the provider keeps it.
- Channel and category names tidied whatever the provider's style ("UK| ʙʙᴄ ᴏɴᴇ ᴴᴰ" → "BBC One HD").
- Favourites, recently watched, Continue watching and watched state, synced through your account.

**Windows** (`apps/desktop`, Electron)
- Embedded `mpv` playback (HEVC and E-AC-3 included, [ADR 0001](docs/adr/0001-mpv-playback-engine.md)).
- Sources are added and edited here, refreshed by hand or on a schedule (Off / 6h / 12h / 24h), with
  the XMLTV guide imported alongside.
- Updates itself from the release bucket ([ADR 0010](docs/adr/0010-in-app-updates.md)).

**Fire TV** (`apps/mobile`, Expo + react-native-tvos, [ADR 0009](docs/adr/0009-android-app-fire-tv-and-phone.md))
- Sign in to the same account and your sources, favourites and progress arrive.
- Home, Movies, Series, Live TV and Search, laid out for a remote, with a TV guide grid on Live TV.
- A live channel that won't start falls back to its other feeds and qualities (4K to HD) by itself.
- Captions you can restyle, Skip intro, and a Next episode button at the credits.
- Updates itself: a new release shows on the Settings gear and installs from there.
- Phones are not supported for now: the layout is drawn for a TV.

## Requirements

- Node.js 22+, pnpm 10+
- Windows for the desktop app (it embeds mpv by window handle, see ADR 0001)
- For Fire TV work: an Android SDK with `adb` (`C:\Android\sdk` on Windows by default), or nothing at
  all if you only run the checks below

## Getting started

```sh
pnpm install
pnpm test          # every package's tests
pnpm typecheck
pnpm lint
pnpm dev           # launches the desktop app
```

For real playback on the desktop, follow `scripts/fetch-mpv.md` first (a one-time manual download,
not automated on purpose).

## Repo layout

```
packages/core/        pure TypeScript shared by both apps: source adapters (Xtream, M3U), name
                      normalisation, XMLTV parsing, the SQLite schema and imports, the sync client.
                      No Electron, React or Expo.
packages/sync-schema/ the sync API's request and response shapes (zod), shared by apps and worker.
apps/desktop/         the Electron app: main process (SQLite, credentials, mpv, IPC), preload, renderer.
apps/mobile/          the Fire TV app.
apps/sync-worker/     the Cloudflare Worker behind accounts, sync and the release bucket.
docs/adr/             decisions worth recording.
```

## Fire TV

### Installing

The first install is by hand; after that the app updates itself.

1. In GitHub, open **Actions**, run **Android APK** with target `firetv`, and download
   `testcard-firetv` from the finished run (or `gh run download <id> -n testcard-firetv`).
2. On the stick, turn on developer options and ADB debugging, then from the PC:

```sh
adb connect <stick-ip>:5555
adb -s <stick-ip>:5555 install -r testcard-firetv.apk
```

If `adb` says the device is not found, run `adb connect` again and accept the prompt on the TV.

### Developing

Checks that need no Android SDK:

```sh
pnpm --filter @testcard/mobile typecheck
pnpm --filter @testcard/mobile bundle:check    # builds the Android JS bundle, catches import problems
```

On a device, a debug build loads its JavaScript from your PC. Native code is always built by CI
(pnpm's long paths break CMake on Windows):

```sh
pnpm android stick <ip>    # point the commands below at a Fire Stick (or "emulator" to go back)
pnpm android emulator      # start the "tv1080" Android TV emulator
pnpm android install       # install the newest debug APK built by CI (target "debug")
pnpm android run           # start the dev server and launch the app against it
pnpm android log           # the app's log from the device
```

Slow page builds are logged under `[perf]`: `adb logcat -s ReactNativeJS | findstr perf`.

## Publishing a release

Both apps update from the `testcard-releases` bucket on Cloudflare R2, served by the sync worker
([ADR 0010](docs/adr/0010-in-app-updates.md)). Publishing needs `gh` and `wrangler` signed in on your
own machine; no Cloudflare token is stored anywhere.

- **Fire TV:** run **Android APK** (target `firetv`) on `main`, then `pnpm release:android <run-id>`
  (or no id for the newest successful run). CI stamps each build with the run number
  (`versionCode`, and version `0.1.<run>`), so every build is newer than the last and devices offer it.
- **Windows:** bump `apps/desktop/package.json` `version`, then `pnpm package` and
  `pnpm release:desktop`. The installer is unsigned, so SmartScreen can warn on a first install.

## Security

Provider logins are held in the platform's secure store (Windows DPAPI via Electron's `safeStorage`,
the Android keystore on Fire TV), never in the SQLite database and never logged. On the desktop the
renderer never sees them or raw stream URLs. They travel between devices only encrypted with a key
derived from your account password. No playlist or credential data is ever committed to this repo.

## Known gotcha: better-sqlite3's native binary targets one runtime at a time

`better-sqlite3` compiles a native binary for one Node ABI. `apps/desktop`'s `postinstall` rebuilds
it for Electron, which `pnpm dev` and `pnpm package` need. If core's tests then fail with a
`NODE_MODULE_VERSION` mismatch, run `pnpm rebuild better-sqlite3` to build it for your system Node,
and `pnpm install` again before going back to the desktop app.

## Development-time category audit (optional)

Category genres come from deterministic rules in `packages/core`
([ADR 0007](docs/adr/0007-category-classification-and-dev-time-ai.md)); the app never calls an AI
service. To audit those rules while developing, put `TYPESAFE_API_KEY` in your own environment
(never in this repo) and run `pnpm --filter @testcard/core eval:categories` with
`CATEGORY_NAMES_FILE` pointing at a JSON of provider category names.
