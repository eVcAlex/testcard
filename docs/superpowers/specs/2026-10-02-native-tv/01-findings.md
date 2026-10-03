# Findings: architecture, performance, Fire TV, targets

Everything here was read from the code at `49e0d31`. File references are relative to the repository root.

## 2. Current architecture findings

### 2.1 What exists

| Part | What it is | Size (non-test lines) |
| --- | --- | --- |
| `packages/core` | Platform-free TypeScript: SQLite schema (v15) and ~100 hand-written queries, Xtream and M3U clients, M3U/XMLTV parsers, normalisation and classification, imports, sync client and controller, crypto, profiles | ~8,000 |
| `packages/sync-schema` | zod schemas: the sync wire contract (`index.ts`) and the shared guide file format (`guide.ts`) | ~240 |
| `apps/mobile` | The Fire TV app: Expo 57, `react-native-tvos@0.86`, Hermes, New Architecture (`newArchEnabled=true`), expo-sqlite, expo-video (Media3 1.9.0, patched), expo-secure-store, react-native-quick-crypto, expo-image, one local Kotlin module (`modules/testcard-installer`) | ~11,000 |
| `apps/desktop` | Electron + React + better-sqlite3 + embedded mpv; uses core directly in the main process | not in scope |
| `apps/sync-worker` | Cloudflare Worker (Hono + better-auth + D1 + R2): `/auth/*`, `/sync/{pull,push,salt}`, `/link/*`, `/guides/register`, `/app/:file` | ~800 |
| CI | `android-apk.yml` (manual; armeabi-v7a release; publishes to R2 from main), `guides.yml` (daily shared guide files), `sync-worker.yml`, `desktop-app.yml` | |

### 2.2 ADR 0009 compared with the code today

| ADR 0009 says | Reality |
| --- | --- |
| One app for Fire TV and phones | Only the TV build ships. The CI comment says phones are unsupported ("the layout is drawn for a TV"). The updater still looks up `apks.phone` for a non-TV build. |
| Core stays platform-free; platform bits are parameters | True. `SyncPlatform`, `migrateDatabase(db)` and `importCatalogue` are used as described. Core also carries TV-specific accommodations: `setSlicePause` (pacing), U+0001-for-NUL handling in `importSource`, `storedKeys` and `channelHistory`, and `keysFor` caching "because it took most of a refresh on a Fire TV". |
| SQLite through an adapter, no query rewritten | True. The adapter is synchronous, so every query blocks the JS thread. |
| Secrets in the Android keystore | True (expo-secure-store keys `testcard.account-password`, `testcard.source.<id>`). |
| quick-crypto for WebCrypto; streaming fetch | True. The fetch shim also forces `user-agent: node` for all provider/API requests (providers filter on User-Agent). |
| TV UI is its own UI | True. It has grown far beyond the first version (see §4 in `02-parity.md`). |
| Not in first version: guide, source add/edit, search, favourites toggling, category filtering, track pickers | All of these now exist. The "Consequences" section is entirely stale. |
| "If import is too slow, keep imports on desktop and sync the catalogue down" | Not done. The TV imports everything itself; a shared guide file service was added for public XMLTV URLs only. |
| APKs signed with Expo's debug key | Now signed with a repo-secret keystore when `ANDROID_KEYSTORE_*` exist (`scripts/sign-release.mjs`), else the debug key. **Which key signs the build installed on the owner's stick is unknown and must be checked** (Phase 0). |

### 2.3 How the app is put together

- `index.ts` installs polyfills (quick-crypto `crypto.subtle`, streaming `fetch` with `user-agent: node`).
- `App.tsx`: fonts gate → `AppProvider` (opens DB, migrates, creates `SyncController`) → `UpdateProvider` → `Root`.
  `Root` holds all navigation as React state: `section` (home/live/movies/series/search/sources) and an overlay `route`
  (movie/series/play). Sections are mounted on first visit and kept (`display: none` when hidden). Detail pages and
  the player draw over the shell, so Back returns to the same scroll position and focus.
- `state/app.tsx` is a single context holding `db`, `sync`, `status`, a global `version` counter, a `catalogue` stamp,
  `sources` (with three `GROUP BY` counts), setup progress, captions, audio language, and profile operations. Any
  `version` bump re-renders every consumer; screens gate their queries on `useVersionWhileShown`.
- Screens call core query functions **inside `useMemo` during render**: synchronous SQLite on the JS thread.
- Playback: `expo-video` `useVideoPlayer` + `VideoView` (Media3 ExoPlayer, OkHttp data source, custom load control),
  with a patch adding a `captionStyle` prop and `buildFromSource` autolinking.
- Updates: `update/` fetches `latest.json` from the Worker's R2 route, downloads with `expo-file-system`, and installs
  via the Kotlin `PackageInstaller` module.

### 2.4 Classification of the code

| Category | Where |
| --- | --- |
| Genuinely shared (desktop + TV + Worker) | `packages/sync-schema`; core `sync/*`, `db/*` schema and queries, `source/*`, `normalise/*`, `epg/*` (parse/import), `playback/progressPolicy.ts` |
| Expo / React Native specific | `apps/mobile/src/platform/*` (sqlite adapter, polyfills, secure-store secrets, pacing, perf), all `screens/*` and `ui/*`, `update/*` (expo-file-system, expo-application), the expo-video patch |
| TV specific (would be the same in any TV app) | D-pad focus model, longSelect options sheets, Back semantics, `uiScale` (1920-unit design scaled to 960 dp), PIN pad, code sign-in, player key map, update installer |
| TV-only logic living in the app, not core | `state/setup.ts` (setup progress model), `state/hosts.ts` (backup server failover), `state/account.ts` (Xtream account lines), `state/sourceEdit.ts` (source form validation), `playback/airing.ts` (now/next and listings queues), `playback/guideImport.ts`, `playback/captions.ts`, `playback/viewing.ts`, `playback/resolveStream.ts`, `playback/streamInfo.ts`, `ui/plainReason.ts`, `screens/player/*` |

### 2.5 Things the code shows that the docs do not

- The TV still **receives and re-pushes** `skips` (series skip-intro windows) in the source record although its UI no
  longer uses them. Any client must round-trip them or desktop data is lost.
- Pins are Main's only: other profiles' pins stay on the device and are never pushed (`collectLocalChanges` `pinsFor`).
- The pull cursor is held back by rows for titles not imported yet (`deferredBeforeMs`); channel rows are parked in
  `pending_channel_sync` for 30 days instead.
- The launch catch-up holds the UI behind the setup screen for 0.7 to 10 s (`LAUNCH_SYNC_SHOW_MS` / `LAUNCH_SYNC_WAIT_MS`).
- **Every** import, including a manual Refresh of one source, replaces the whole app with the blocking setup screen
  (`settingUp = setup !== null && route.name === "home"`).
- Browse grids stop at 600 items per category (`MAX_ITEMS`); the zap list from a single item is the first 300 channels;
  the guide shows at most 2,000 channels per list.

## 3. Performance findings

No Fire TV measurements exist in the repository. The only numbers are from an earlier session on the 1080p Android TV
emulator with a **dev** build (memory note, 2026-09-22): janky frames Home 7.7 %, Live 15.5 %, Movies 9.6 % (later
~8 %, ~13.5 %, 9 %), and "Home ready" cold start 810 ms → ~460 ms after persisting the landing rows. Those are
directional only: the emulator runs on a desktop CPU.

### 3.1 Bottlenecks found in the code, ranked by expected impact on an old stick

| # | Bottleneck | Evidence | Does native fix it? |
| --- | --- | --- | --- |
| B1 | **All SQLite on the JS thread, inside render.** Each screen builds rows in `useMemo` with synchronous queries. Live landing alone: `listCategories` (JOIN + `GROUP BY` over every channel), recents, favourites, then 10 × `browseChannels`. | `platform/sqlite.ts` (`executeSync`), `screens/Live.tsx` `rows`, `screens/Start.tsx` `rows` | Yes for blocking (queries move to IO threads, UI shows placeholders). Query time itself is unchanged. |
| B2 | **Imports share the UI thread.** `response.json()` of each Xtream category list, M3U line parsing, `parseName`/`displayName`/`classifyCategory` regexes per row, variant grouping, SHA-1 per title, 40 ms slices. The pacing hack pauses the import while keys are pressed, so imports also run slower *because* the user is navigating. | `core/db/applyInSlices.ts`, `apps/mobile/src/platform/pacing.ts`, `core/db/storedKeys.ts` | Yes. Streaming JSON (no whole-body string), parsing on `Dispatchers.Default`, writes on a DB writer thread, no pacing needed. |
| B3 | **XMLTV guide import in JavaScript** (fflate gunzip + sax) for private guide URLs. A 19 MB `.xml.gz` "takes many minutes" on a Fire Stick; inserts flush every 500 rows on the JS thread. | `apps/mobile/src/playback/guideImport.ts`, `core/epg/importEpg.ts`, spec `2026-09-22-guide-profiles-rewind-notes.md` | Yes. `GZIPInputStream` + `XmlPullParser` on a background thread, typically an order of magnitude faster than interpreted JS, with zero UI impact. Still CPU and IO heavy, so keep the 36 h horizon. |
| B4 | **Focus is driven through React.** Every D-pad move runs `Focusable.onFocus` → `setState` (re-render that card), global `lastFocused` bookkeeping, `HomeScreen` `setScrolled` (re-renders the screen) and a 240 ms hero timer that swaps a large image. When B1–B3 or sync occupy the thread, the focus ring lands late: the "slow remote" feeling. | `ui/Focusable.tsx`, `screens/Home.tsx` `focusFor` | Yes. Compose focus is handled on the UI thread; a focus change recomposes only the focused card's modifier state. |
| B5 | **Global `version` bump re-renders every consumer** and recomputes `sources`, which runs three `GROUP BY source_id` counts over channels, movies and series (full index scans), plus the hidden stamp. This happens after every sync that brought anything, every import, and every profile change. | `state/app.tsx` `sources`, `hiddenStamp`, 4 s status poll | Yes. Per-table invalidation flows; counts are recomputed on a background thread only when those tables change. |
| B6 | **Landing shelves are expensive SQL**: per shelf, `ORDER BY CAST(rating AS REAL)` and `lower(raw_name) NOT LIKE '%…%'` × 9 words over the whole movies/series join, plus a `GROUP BY genre` and up to 8 genre queries. They are cached per catalogue (`memoByVersion` + `rows:*` in `schema_meta`) and built in `requestIdleCallback`, but the first build still blocks. | `core/db/homeQueries.ts` | Partly. Off-thread means no freeze, but rows still take as long to appear. Fix with precomputation at import time (follow-up, not parity). |
| B7 | **Sync work on the JS thread**: JSON parse of pulls, AES-GCM per source and profile, the apply transaction, and on unmatched channel rows `channelKeys()`, which FNV-hashes every channel of every source in JS. PBKDF2 (210k) is native in quick-crypto and cached per session, but runs again on every cold start. | `core/sync/*`, `core/sync/channelHistory.ts` | Yes for blocking. PBKDF2 cost on the JVM must be measured; it can be avoided on cold start by caching the derived key wrapped by the Keystore. |
| B8 | **Large images**: hero art at TMDB `w780` drawn 1180 × 1770 design px; non-TMDB artwork arrives at original size (often 2000 px) and is decoded full size; blurred backdrops. | `ui/imageSize.ts`, `screens/Home.tsx` Hero, `ui/DetailActions.tsx` Backdrop | Only if the native image loader is told the target size (Coil `size()`), which then decodes with subsampling. Same network cost. |
| B9 | **Lists**: nested `FlatList`s (vertical list of horizontal lists); JS-side virtualisation; `removeClippedSubviews=false`; Browse re-reads rows `0..limit` on every page (60 → 600). | `screens/Home.tsx`, `screens/Browse.tsx` | Yes with `LazyColumn`/`LazyRow`, stable keys, and paging by offset. |
| B10 | **Player chrome re-renders** on every `timeUpdate` (0.5 s VOD / 1 s live) across a 1,100-line component, plus on every app `version` bump. | `screens/Player.tsx` | Yes. Only the position text and bar read the ticking state. |
| B11 | **Cold start**: native init + Hermes bundle + fonts gate (blank view until Inter loads) + DB open/migrate in render + profile read + sync controller + persisted-rows JSON parse. Then the launch catch-up gate shows the setup screen for 0.7 to 10 s **by design**. | `App.tsx`, `state/app.tsx` | Native removes most framework init; the catch-up gate is product behaviour and stays unless changed deliberately. |
| B12 | **APK and memory**: a local multi-ABI release APK is 52 MB; `libQuickCrypto.so` alone is 10 MB (x86_64). The CI build is armeabi-v7a only and its size was not measured. Hermes heap + RN + Fabric + cached JS rows on a 1 GB device. | `apps/mobile/android/app/build/outputs/apk/release` | Expected a large reduction (a Compose + Media3 + OkHttp + SQLite APK is typically 10–20 MB). Measure. |

### 3.2 What will remain a bottleneck in a native app

- Provider latency and slow bodies (Xtream `get_vod_streams` per category, short EPG per channel).
- SQL cost of the shelves (B6) and of `listCategories` counts on big catalogues. Native hides it; it does not shrink it.
- Video decoding limits of the stick (10-bit HEVC, 4K on 1080p sticks). Media3 is already the decoder today, so
  behaviour is the same.
- Image download and decode for non-TMDB artwork.
- The deliberate launch catch-up wait and the blocking setup screen (product behaviour).
- Compose's own start-up and first-frame costs on 32-bit ARM with 1 GB RAM. This needs R8, Baseline Profiles (applied to
  sideloaded APKs by ProfileInstaller) and care with recomposition. Native is not automatically fast here; the spike
  must measure it.

### 3.3 How to profile (current app and native alike)

| Measure | Command / tool |
| --- | --- |
| Cold and warm start | `adb shell am force-stop <pkg>` then `adb shell am start -W -n <pkg>/<activity>` → `TotalTime` (first frame). Repeat 10×, report the median and p90. |
| Time to usable Home | Current app: existing `[perf]` logs (`adb logcat -s ReactNativeJS \| findstr perf`). Native: log `Trace`/logcat marker when Home rows are on screen. |
| Jank | `adb shell dumpsys gfxinfo <pkg> reset`, run a scripted key sequence (`adb shell input keyevent KEYCODE_DPAD_RIGHT` …), then `dumpsys gfxinfo <pkg>` → janky %, p50/p90/p95/p99 frame time. |
| Key-to-focus latency | Native: compare `KeyEvent.eventTime` with the next `Choreographer` frame after the focus change (debug overlay). Current app: Perfetto trace (Fire OS 7+/API 28+) of input → frame; on older Fire OS use `atrace`/systrace. |
| Memory | `adb shell dumpsys meminfo <pkg>` (PSS, Java/native heap) after a fixed browse script and after 30 min of zapping. |
| CPU | `adb shell top -m 10 -d 1` during import / idle Home. |
| JS profiling (current app, dev build) | Hermes sampling profiler from the dev menu; `[perf]` labels from `platform/perf.ts`. |
| APK size | `ls -l` of the CI artifact; `apkanalyzer` per-lib breakdown. |

Phase 0 wraps all of this in one script so both apps are measured the same way (see `05-sonnet-plan.md`, Phase 0).

## 9. Fire TV compatibility

- **Current minimum** is `minSdk 24` (Android 7.0), with `targetSdk`/`compileSdk 36` (`react-native/gradle/libs.versions.toml`). Fire OS 5
  devices (API 22) are therefore **already unsupported**. The native app keeps minSdk 24 so the supported set does
  not shrink. Raising it to 25 (Fire OS 6) would be harmless in practice but is not needed.
- Device classes to plan for (verify against Amazon's device specifications before relying on them): Fire OS 6 (API 25,
  older 4K sticks), Fire OS 7 (API 28: Stick Lite, Stick 3rd gen, ~1 GB RAM, quad A53), and Fire OS 8 (API 30: newer 4K/4K
  Max). Amazon's newest Vega OS sticks do not run Android APKs at all, for this app or any other.
- **ABI**: release builds are `armeabi-v7a` only today (CI), which every Fire stick runs. Native: ship `armeabi-v7a`,
  and add `arm64-v8a` only if the native libraries (SQLite, Media3 extensions) need it for speed on 64-bit sticks. The
  measured APK budget decides.
- **API 24/25 traps for the native code**: no `PBKDF2WithHmacSHA256` in the platform provider before API 26 (implement
  PBKDF2 over `Mac("HmacSHA256")`, about 20 lines, verified by vectors); no `java.util.Base64` before 26 (use
  `android.util.Base64.NO_WRAP`); no hardware bitmaps before 26; Keystore AES-GCM is fine from 23.
- **SQLite**: the schema needs FTS5. Android's platform SQLite cannot be assumed to have FTS5. Bundle SQLite
  (`androidx.sqlite:sqlite-bundled`, or requery `sqlite-android` as fallback); the spike verifies FTS5 and measures the
  size cost.
- **Compose on low-end**: R8 full mode, Baseline Profile generated on an emulator and shipped in the APK, no
  `Modifier.graphicsLayer` animations on every card, lists with stable keys, images sized to the card. Fire OS 6
  (API 25) has no RenderThread improvements of later Android releases; test there if a device is available.
- **Media3**: use the same version expo-video ships (1.9.x) so codec and extractor behaviour is unchanged; OkHttp data
  source; same `LoadControl` numbers (see PLY-22).
- **Background processing**: Fire OS kills background apps aggressively. The current app does nothing while closed
  (sync, guide and update checks only run in the foreground). Native keeps that; no WorkManager at parity.
- **Network instability**: keep the existing timeouts exactly (20 s to first response from a provider; 15 s total per
  sync request; 60 s to first byte for guides; 45 s download stall for updates; 8 s per backup-server probe).
- **Remote**: Fire TV remotes send `DPAD_*`, `DPAD_CENTER` (repeats while held), `BACK`, `MENU`, `MEDIA_PLAY_PAUSE`,
  `MEDIA_REWIND`, `MEDIA_FAST_FORWARD`. The current app uses all of these except `MENU`.

## 15. Performance benchmarks and targets

**Measured today** (emulator, dev build, not representative): janky frames Home 7.7 %, Live 15.5 %, Movies 9.6 %;
cold start "Home ready" ~460 ms after caching rows. **Everything else must be measured in Phase 0 on the owner's stick**
before targets are final. Targets below are proposals for a Fire TV Stick Lite / 3rd gen class device (Fire OS 7,
~1 GB), release builds, the same account and sources for both apps.

| Metric | How measured | Proposed target (native) | Gate for the spike |
| --- | --- | --- | --- |
| Cold start to first frame | `am start -W` TotalTime, median of 10 | ≤ 1,000 ms | ≤ 70 % of baseline |
| Cold start to interactive Home (cached data, launch catch-up excluded) | logcat marker | ≤ 1,800 ms | ≤ 70 % of baseline |
| Warm start | `am start -W` after Home | ≤ 400 ms | — |
| Key → focus visible, idle | debug overlay / Perfetto | p95 ≤ 50 ms, p99 ≤ 100 ms | p95 ≤ 50 ms |
| Key → focus visible, **during import and guide import** | same, while a source refreshes | p95 ≤ 80 ms, no frame > 250 ms | p95 ≤ 50 % of baseline |
| Janky frames, scripted scroll Home / Live / Movies | `gfxinfo` | ≤ 5 % each | ≤ 60 % of baseline |
| Tab switch to content (warm DB) | marker | ≤ 300 ms | — |
| Browse: category change to first 60 items | marker | ≤ 200 ms | — |
| Live channel start (select → first frame), healthy stream | Media3 `onRenderedFirstFrame` | not worse than baseline; report p50/p90 | not worse |
| Zap (channel up → first frame) | same | not worse than baseline | not worse |
| PSS while browsing (after script) | `meminfo` | ≤ 220 MB | ≤ baseline |
| PSS during 1080p playback | `meminfo` | ≤ 320 MB | ≤ baseline |
| Memory growth over 30 min zapping | `meminfo` | ≤ 20 MB | — |
| CPU on idle Home after 10 s | `top` | < 5 % | — |
| Full import of the owner's live source | timer | ≤ 50 % of baseline wall time | ≤ 70 % |
| 19 MB `.xml.gz` guide import | timer | ≤ 30 % of baseline, zero UI impact | — |
| PBKDF2 210k (sign-in, first sync) | timer | ≤ 3 s; 0 s on later cold starts (cached wrapped key) | measured |
| Release APK (armeabi-v7a) | file size | ≤ 20 MB | measured |
