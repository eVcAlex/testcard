# 18. Implementation plan for a Sonnet coding agent

Read first, in this order: `README.md`, `02-parity.md` (the IDs), `03-architecture.md` §7–8, then the phase you are
on. The feature IDs are the contract.

## Rules of engagement (apply to every phase)

1. **The TypeScript app is the oracle.** When behaviour is unclear, read the TS file named in `02-parity.md` and do
   what it does. Do not improve, redesign, re-word or re-order anything. Ideas go to a GitHub issue labelled
   `after-native`.
2. **Never change** `apps/desktop`, `apps/sync-worker`, `packages/sync-schema`, or production code in `packages/core/src`.
   Allowed additions in `packages/core`: `scripts/make-vectors.ts`, `scripts/make-db-vectors.ts`, `test-vectors/**`,
   `src/__tests__/vectors.test.ts`, a `vectors` script in its `package.json`. `apps/mobile` is frozen: release fixes only,
   and only when the owner asks.
3. **Test first** for anything with a vector: write the Kotlin test that reads the vector, watch it fail, then port.
   Kotlin code that decides an id, key, URL, wire byte or user-visible string must be covered by a vector or a DB golden.
4. **Nothing heavy on the main thread.** Repositories expose `suspend`/`Flow` only. StrictMode `penaltyDeath` stays on in
   debug. Never wrap a DB call in `runBlocking`.
5. **Schema frozen at v15.** Copy SQL verbatim from core. If a query needs to change, stop and ask.
6. **Strings verbatim.** Copy user-visible text exactly, including punctuation and "…" vs "...".
7. **Keep it small.** No DI framework, no navigation library, no extra modules beyond `:core`, `:app` and
   (Phase 16) `:macrobenchmark`. Reuse what exists (the installer Kotlin, the icons and banner in
   `apps/mobile/assets`).
8. **No commits, pushes, publishes, Worker deploys or R2 uploads** unless the owner says so in the session. Leave
   work in the tree and report.
9. At the end of each phase, report: IDs passed, tests added, measurements taken, and anything that differed from TS.

## JS → Kotlin semantics checklist (normalisation, parsing, keys)

| JS | Trap in Kotlin/Java | Do this |
| --- | --- | --- |
| `\s`, `\S`, `\b`, `\w`, `\d` in regexes | Java's are ASCII-only by default; JS `\s` matches Unicode spaces (NBSP, U+2000–200A, U+3000, U+FEFF…), JS `\w`/`\b`/`\d` are ASCII | Write an explicit class for `\s` (`[\t\n\u000B\f\r    -     　﻿]`); keep `\w`, `\b`, `\d` ASCII (Java's default); do **not** use `UNICODE_CHARACTER_CLASS` |
| `/u` flag with astral ranges `[\u{1F300}-\u{1FAFF}]` | Java needs `\x{1F300}` syntax | Translate to `\x{…}`; Java regex works on code points |
| `/i` | Java's is ASCII-only unless `UNICODE_CASE` | Use `RegexOption.IGNORE_CASE` and add `UNICODE_CASE` only where JS `/iu` was used |
| `str.trim()` | Kotlin `trim()` uses `isWhitespace` (no U+FEFF); Java `String.trim()` trims ≤ U+0020 | Write `jsTrim()` matching ECMAScript WhiteSpace + LineTerminator |
| `toLowerCase()` / `toUpperCase()` | Default locale (Turkish İ!) | `lowercase(Locale.ROOT)` / `uppercase(Locale.ROOT)` |
| `split(/\s+/)` | Kotlin `split(Regex)` keeps a leading empty string like JS; `filter` behaviour differs by caller | Mirror the TS line exactly, including any `.filter(...)` |
| `Number(x)` | `""` → 0, `" 12 "` → 12, `"1e3"` → 1000, `"0x10"` → 16, otherwise NaN | `jsNumber()` helper with those rules; `Number.isNaN` checks as in TS |
| `String(n)` for numbers | `1.0` vs `1` | Ints as `toString()`; doubles via a `jsNumberToString` helper if ever needed |
| `charCodeAt`, `for (const c of s)` | UTF-16 unit vs code point | `hash64`/`pinHash`: FNV over UTF-16 units (`s[i].code`) for `channelKeyFor`; `pinHash` iterates code points but only ASCII is fed |
| `Math.imul(a, b) >>> 0` | Overflow/sign | Use `Int` multiplication then `toUInt()`/`and 0xffffffffL`; hex via `toString(16).padStart(8,'0')` |
| `TextEncoder` | Lone surrogates become U+FFFD; Kotlin `toByteArray(UTF_8)` gives `?` | Use `Charsets.UTF_8.newEncoder().onMalformedInput(REPLACE).replaceWith(EF BF BD)`, or test that it never matters |
| `new URL(x)` / `searchParams.set` | Host normalisation, IDNA, form encoding (`+` for space) | Use OkHttp `HttpUrl` for parsing and verify against `normalizeProviderHost` vectors; build query strings with `addQueryParameter` and verify against TS URL vectors |
| Template-string URL concatenation | — | Stream URLs concatenate credentials **raw**, as TS does; never encode them |
| `atob`/`btoa` | — | Standard alphabet with padding; `atob` tolerates whitespace |
| `JSON.stringify` | `undefined` keys dropped | kotlinx.serialization: `explicitNulls = true` where TS writes `null` (`epgUrl`), omit optional fields TS omits (`position`, `pins`, `skips`, `keyHost`); `encodeDefaults` per field |
| `Date` from seconds | — | `Long * 1000`; display in device zone like `getHours()` |
| `localeCompare`, `Intl` | Unused in core sorting; the device language comes from `Intl…locale` | `Locale.getDefault().language` |

---

## Phase 0: Baseline measurement of the current app

- **Objective:** real numbers for the current app on the owner's Fire Stick, using a script that later measures the
  native app the same way.
- **Files:** new `scripts/tv-perf.mjs`; new `docs/superpowers/specs/2026-10-02-native-tv/baseline.md` (results).
- **Dependencies:** none. Needs the owner to connect the stick (`pnpm android stick <ip>`) and approve running against it.
- **Work:**
  1. Write `scripts/tv-perf.mjs <package> <activity>` (Node, reusing the `adb` and env setup of `scripts/android-dev.mjs`):
     - **Cold start ×10:** `am force-stop` then `am start -W` → TotalTime. **Warm start ×10:** HOME key, then `am start -W`.
     - **Key scripts:** `input keyevent` sequences at fixed intervals for Home rows, Live rows, Movies rows and a Browse
       grid. Wrap each with `dumpsys gfxinfo <pkg> reset` / `dumpsys gfxinfo <pkg>` and parse janky % and
       p50/p90/p95/p99.
     - **Memory and CPU:** `dumpsys meminfo <pkg>` (TOTAL PSS, Java heap, native heap) after the scripts; `top -b -n 5 -d 1`
       on idle Home.
     - **Under load:** an option to trigger a source refresh first (by key script) and rerun the key scripts during it.
     - **Logcat markers:** collect `[perf]` lines for the current app and `TC_PERF` lines for the native one.
     - **Output:** JSON to stdout and to `perf-results/<pkg>-<date>.json` (git-ignored).
  2. Record APK size (CI artifact `testcard-firetv.apk`) and `apksigner verify --print-certs` of the APK installed on the
     stick (`adb shell pm path com.evcalex.testcard`, then pull) → which certificate signs it.
  3. Measure with a stopwatch, and note in `baseline.md`: full import time of each source (Sources → Refresh) and guide
     import time (logcat "Guide for X: … in Ns").
- **Tests:** a dry-run mode that parses saved `dumpsys` samples (put fixtures in the script's `__fixtures__`).
- **Acceptance:** `baseline.md` holds every metric in `01-findings.md` §15 with the device model, Fire OS version and app
  versionName.
- **Parity checks:** none (measurement only).
- **Performance checks:** this phase *is* the baseline.
- **Must not change:** any app code. The script only launches and drives the app.

## Phase 1: Test vectors from the TypeScript implementation

- **Objective:** committed input → output vectors for every function the native app must reproduce.
- **Files:** `packages/core/scripts/make-vectors.ts`, `packages/core/scripts/stub-loader.mjs` (resolves `react`,
  `react-native`, `expo*`, `iconoir-react-native` to stubs: `StyleSheet.create = x => x`,
  `Platform = { isTV: true, OS: "android" }`, `Dimensions.get = () => ({ width: 960, height: 540 })`),
  `packages/core/test-vectors/*.json`, `packages/core/src/__tests__/vectors.test.ts`, `packages/core/package.json`
  (add a `"vectors"` script).
  DB vectors (`make-db-vectors.ts`, `test-vectors/db/`) come in Phase 6.
- **Dependencies:** none.
- **Work:**
  1. One JSON file per area: `normalise.json`, `m3u.json`, `xtream.json`, `xmltv.json`, `keys.json`, `crypto.json`,
     `link.json`, `policy.json`, `text.json` (plainReason, explain, titles, sized, monogram, describeAccount,
     accountProblem wording), `captions.json`, `setup.json` (`describeSetup`), `streaminfo.json`, `catchup.json`.
     Format: `[{ "fn": "parseName", "in": [...args], "out": ... }]`.
  2. Inputs: every string in the existing core test files and `categoryGolden.json`, the fixture playlists and guides
     used by `parseM3U.test.ts`/`parseXmltv.test.ts`, plus an "awkward" list:
     - NBSP, BOM, U+3000, styled glyphs `ᵁᴴᴰ`, emoji, `İ`, `ß`;
     - `##### PPV #####`, `(OFFLINE)`, `(1080p50)`, `UK| …`, `[UK] …`;
     - empty strings, 500-char names, `S01E02E03`, `1x02`.
  3. Crypto: stub `crypto.getRandomValues` in the script to return fixed bytes per call, so blobs are deterministic.
     Include: `deriveKey` raw bytes (export via a test-only `deriveBits` with the same parameters),
     `encryptJson`/`decryptJson` of an Xtream payload with every optional field, a playlist payload and a profile
     payload. Include the link code, lookup and sealed secrets.
  4. `vectors.test.ts` regenerates in memory and `expect`s equality with the committed files.
     `pnpm --filter @testcard/core vectors` rewrites them.
- **Tests:** `vectors.test.ts` (plain Node is fine for these; no SQLite).
- **Acceptance:** `pnpm --filter @testcard/core test` passes. Changing any covered TS function without regenerating
  fails the test.
- **Parity checks:** n/a.
- **Performance checks:** n/a.
- **Must not change:** production TS under `packages/core/src` and `apps/mobile/src`.

## Phase 2: Native skeleton and CI

- **Objective:** an empty, correct-by-construction app that installs beside the old one.
- **Files:** `apps/tv-native/**` per `03-architecture.md` §16 (skeleton only), `.github/workflows/tv-native.yml`,
  `.gitignore` entries for Gradle outputs.
- **Dependencies:** none.
- **Work:**
  1. Gradle (Kotlin DSL), version catalogue. `:core` is a Kotlin JVM module with JUnit 5, and its test resources
     include `../../../packages/core/test-vectors`.
  2. `:app` settings:
     - minSdk 24, target and compile 36, applicationId `com.evcalex.testcard.tv`, label "Testcard Beta", banner and icons
       from `apps/mobile/assets`, `LEANBACK_LAUNCHER`, `usesCleartextTraffic=true`, `allowBackup=false`,
       `REQUEST_INSTALL_PACKAGES`;
     - ABI `armeabi-v7a`; R8 full mode in release;
     - signing from the `ANDROID_KEYSTORE_*` env vars when present, as `scripts/sign-release.mjs` does for RN.
  3. `MainActivity` with Compose for TV `MaterialTheme` and the theme tokens from `apps/mobile/src/theme.ts`, and `uiScale`.
     Inter fonts go in `res/font`. Show a "testcard" brand screen.
  4. StrictMode (`penaltyDeath`) in debug. `AppGraph` object.
  5. `tv-native.yml`:
     - on push/PR touching `apps/tv-native/**` or `packages/core/**`: `./gradlew :core:test :app:assembleDebug lint`;
     - manual dispatch: release APK artifact with versionCode `100000 + run_number` (beta builds may use `run_number` while the
       applicationId differs). **No publish step yet.**
- **Tests:** a smoke `androidTest` that the activity launches. `:core:test` runs at least one vector file (`policy.json`)
  to prove the resource wiring.
- **Acceptance:** CI green; the APK installs on the emulator beside `com.evcalex.testcard` and launches from the Fire TV
  home row.
- **Parity checks:** none yet.
- **Performance checks:** record APK size and cold start of the empty app (the floor).
- **Must not change:** `android-apk.yml`, `apps/mobile`.

## Phase 3: Spike

Follow `04-delivery.md` §10 exactly. Put spike-only UI under `app/src/main/kotlin/.../spike/` so it can be deleted.
Crypto and wire code goes straight into its final `:core` places (it is reused in Phase 4). Write `spike.md` with the
S1–S12 table (baseline vs native) and stop for the owner's go/stop decision. **Do not start Phase 4 without it.**

## Phase 4: Core crypto, keys, wire models

- **Objective:** byte-exact crypto, keys and sync JSON.
- **Files:** `:core` `crypto/*`, `sync/Wire.kt`, `sync/RemoteKey.kt`, `sync/Link.kt`, `sync/ChannelHistory.kt` (the key
  function only), `db/ProfileIdentity.kt` (`pinHash`, avatars, colours, `newProfileId`, `nextColour`).
- **Dependencies:** Phase 1, Phase 3 go.
- **Work:**
  - PBKDF2-HMAC-SHA256 over `Mac` (reuse the `Mac` instance; pre-key it with the password).
  - AES-GCM seal/open; Base64; `sha1hex`, `sha256hex`; `normalizeProviderHost`; every `remoteKeyFor*`; `hash64`,
    `channelKeyFor` with U+0001.
  - Link code (`byte % 32`), lookup, open; `pinHash`.
  - kotlinx.serialization models for every schema in `s/index.ts` and `s/guide.ts`, with the emission rules of §8.4
    (an `encodeSource(payload)` that reproduces `collectLocalChanges`' field rules) and validation that mirrors zod
    (min lengths, ints, the source refine rule).
- **Tests:** `crypto.json`, `keys.json` and `link.json` vectors. Decrypt TS blobs, and check that encrypting with the fixed
  IV gives TS-identical blobs. Wire round-trip: parse TS-produced push/pull JSON samples, re-encode, and compare as JSON trees.
  Validation rejects what zod rejects (tombstone/live refine, empty label).
- **Acceptance:** all green on the JVM; PBKDF2 time on the JVM logged.
- **Parity checks:** AUTH-12 (headers built by a helper), PROF-09, SYNC-09.
- **Performance checks:** PBKDF2 on the stick (from the spike); if > 3 s, implement the Keystore-wrapped derived-key cache in Phase 8.
- **Must not change:** iteration counts, salt sizes, encodings, key formulas.

## Phase 5: Normalisation and parsers

- **Objective:** identical names, ids, categories and parsed entries.
- **Files:** `:core` `normalise/*`, `m3u/*`, `xtream/Vod.kt` (DTO mapping), `xtream/Detect.kt` (`extractXtreamCredentials`),
  `xtream/Catchup.kt` (`timeshiftStamp`, `programmeMinutes`, `splitCatchup`), `xmltv/ParseXmltv.kt`, `playback/ProgressPolicy.kt`,
  `text/*`, `playback/Captions.kt`, `playback/StreamInfo.kt`, `importing/SetupProgress.kt`.
- **Dependencies:** Phase 1.
- **Work:** port line by line with the semantics checklist above.
  - M3U parsing works over an `okio.BufferedSource`, line by line, handling `\r\n` and lines split across chunks.
  - XMLTV uses `XmlPullParser`: kxml2 as `compileOnly` + `testImplementation` in `:core`, the platform parser on Android.
    `GZIPInputStream` is chosen by checking the gzip magic bytes, as TS does.
  - Port `classifyCategory` (and keep `CLASSIFIER_VERSION`), `displayName` (and keep `DISPLAY_NAME_VERSION`), and
    `groupVariants` with the NUL key separator.
- **Tests:** `normalise.json`, `m3u.json`, `xtream.json`, `xmltv.json`, `catchup.json`, `policy.json`, `text.json`,
  `captions.json`, `setup.json`, `streaminfo.json`. Add a 20k-line synthetic playlist test to bound memory and time on the JVM.
- **Acceptance:** 100 % of vectors pass; no `TODO` branches.
- **Parity checks:** LIVE-05, IMP-01 (parsing part), EPG-07 helpers, PLY-08 messages, PLY-15 helpers, IMP-02 model.
- **Performance checks:** JVM micro-benchmark of parse + group for 20k entries (record; target < 2 s on the JVM).
- **Must not change:** regex meaning, version constants, id formats.

## Phase 6: Database and repositories

- **Objective:** the v15 database on background threads, every query ported with identical results.
- **Files:** `:core` `db/*`; `packages/core/scripts/make-db-vectors.ts`; fixture inputs under `packages/core/test-vectors/db/in/`;
  outputs under `test-vectors/db/out/`.
- **Dependencies:** Phases 4 and 5.
- **Work:**
  1. Write `Db`:
     - a `BundledSQLiteDriver` writer connection on a single-thread dispatcher and two reader connections;
     - pragmas as `platform/sqlite.ts`;
     - `transaction(tables) {}`, `read {}`, `observe(tables) { }`, and `changes`;
     - a debug assertion that it is never called on the main thread.
  2. Run `schema.sql` (verbatim SCHEMA_SQL) and the migration runner (port `migrateDatabase` semantics and
     `MIGRATIONS` v2..v15, so an older adopted DB can migrate).
  3. Store ids with U+0001 for NUL (`replace('\u0000','\u0001')` at bind time, the reverse where TS reverses it).
  4. Port each query module with **verbatim SQL**: `queries`, `vodQueries`, `seriesQueries`, `homeQueries`,
     `searchQueries`, `progressQueries`, `channelFeeds`, `profiles`, `profileIdentity` (`readProfiles` incl. the legacy
     import), `profileSwap`, `hidden`, `sourcePins`, `sourceOrder`, `sourceContent`, `sourceRemoval`, `channelHistory`
     (collect/apply), and `storedKeys`.
  5. `make-db-vectors.ts` (runs under Electron-as-Node per the repo note):
     - build a fixture DB from fixture inputs through the TS import functions (fake adapters returning fixture JSON);
     - call each query with a set of arguments (including `sourceId` scopes, hidden items, profiles) and write the outputs.
- **Tests:** Kotlin builds the same DB from the same fixture inputs with its own importer stubs (or loads the TS-built
  `.db` file for query-only tests) and asserts each output equals the TS output (order included). A StrictMode-style
  test fails if any `Db` call happens on the test's "main" thread.
- **Acceptance:** all DB vectors pass; FTS5 search returns the same ids in the same order.
- **Parity checks:** PROF-04, PROF-12, PROF-13, SRC-04, SRC-09, SRC-10, HOME-01 (row content), LIVE-06, SRCH-01 (results),
  SER-06/07, PLY-03/04 (feeds, play order), SYNC-04 (apply rules, via unit tests on `applyRemoteChanges`).
- **Performance checks:** time `movieHome`/`seriesHome`/`listCategories` on a 50k-movie fixture on the emulator (record).
- **Must not change:** SQL text, schema, `schema_meta` keys.

## Phase 7: Imports

- **Objective:** a catalogue import with the same rows as TS, run in the background.
- **Files:** `:core` `importing/*`, `xtream/XtreamClient.kt`, `m3u/M3uLoader.kt`, `importing/Maintenance.kt`; `:app` `ImportManager` wiring.
- **Dependencies:** Phases 5 and 6.
- **Work:**
  - Port `importCatalogue`, `importSource`, `importVod`, `importSeries`, `importM3UVod` (incl. `removeVodFromLive`),
    `ensureMovieDetails`, `ensureSeriesEpisodes` (24 h freshness), `keysFor`, `renameChannels`, `reclassifyCategories`.
  - Xtream list calls stream JSON with `JsonReader`, 4 at a time, 20 s to the first response.
  - Transactions of ~1,500 rows on the writer.
  - Progress events with the same stages as `state/setup.ts`.
  - An `ImportManager` with one job per source (a second refresh joins the first; a removal waits for the import).
- **Tests:** a `MockWebServer` provider serving fixture JSON and playlists. The resulting DB is compared with the TS
  import's DB vectors from Phase 6 (all tables, ids included). Re-import idempotence (no rewrites of unchanged rows).
  Failure events per part.
- **Acceptance:** identical DB contents; the importer never touches the main thread; cancellation-safe.
- **Parity checks:** IMP-01, IMP-03 (ordering of import → sync → guide), IMP-04, IMP-05, IMP-06, IMP-07, SRC-05.
- **Performance checks:** import of the owner's source on the stick vs `baseline.md` (target ≤ 50 %); key latency during
  import with the spike UI (p95 ≤ 80 ms).
- **Must not change:** the diff-merge rules (no deletes of absent channels), id formats.

## Phase 8: Sync

- **Objective:** full two-way sync, interoperable with desktop and the RN app.
- **Files:** `:core` `sync/SyncClient.kt`, `SyncController.kt`, `LocalChanges.kt`, `Link.kt` (session), `Hidden.kt`, `Pins.kt`;
  `:app` `platform/KeystoreSecrets.kt`, `Lifecycle.kt`; a test harness `apps/tv-native/core/src/integrationTest/` plus
  `scripts/tv-sync-it.mjs` (starts `wrangler dev` with local D1 from `apps/sync-worker`, runs a TS client script and the Gradle task).
- **Dependencies:** Phases 4, 6 and 7.
- **Work:** port `SyncClient` (OkHttp, headers and timeouts of §8.1) and `SyncController`:
  - `runOnce` with a rerun flag; the 60 s periodic, 3 s / 15 s change and launch rules; `triggerNow`;
  - `setPaused` (cancel in-flight calls); `setProfile`; `reauthenticate`; `forgetSession`;
  - the one-time flags; `onSourcesAdded`; the status flow with `lastChangedAt`.

  Also port `collectLocalChanges` / `applyRemoteChanges` / `applyChannelHistory`, and `LinkSession` (2 s poll, expiry →
  new code). Implement `KeystoreSecrets` with the same key names. Implement the derived-key cache (wrapped by the
  Keystore) if Phase 4 showed PBKDF2 > 3 s.
- **Tests:**
  - Unit: controller timing with a test dispatcher (virtual time).
  - Integration scenarios against the local Worker:
    - (a) TS signs up and adds sources with every optional field, pins, skips, hidden, `epgUrl`, `backupHosts`; Kotlin
      signs in and gets identical decrypted sources;
    - (b) Kotlin edits a source, favourites, recents, progress and profiles, and TS sees them;
    - (c) tombstones both ways;
    - (d) a non-Main profile's rows are prefixed and pulled with `profile=`;
    - (e) deferred rows hold the cursor;
    - (f) an expired token re-authenticates; a rejected re-auth forgets the session with the exact message;
    - (g) link approve via the TS `sealLinkSecrets`, then Kotlin `LinkSession` signs in;
    - (h) channel rows wait in `pending_channel_sync`.
- **Acceptance:** all scenarios green. Manual check on the owner's desktop app with a **test account** (never the real
  one until Phase 16): data appears on both sides.
- **Parity checks:** AUTH-05..12, PROF-11, SRC-01, SRC-09, SRC-10, SYNC-01..09.
- **Performance checks:** a pull of the real account on the stick: wall time and UI unaffected (key latency p95 ≤ 80 ms during it).
- **Must not change:** anything on the wire; push ordering; cursor maths.

## Phase 9: Shell, sign-in, profiles, setup screen

- **Objective:** the app frame that every later screen plugs into.
- **Files:** `:app` `ui/shell/*`, `ui/signin/*`, `ui/profiles/*`, `ui/components/{NavBar,NavTab,SetupOverlay,PinPad,OptionsSheet,MenuRow,Pill,Toast,Avatar,QrCode,FocusCard}.kt`.
- **Dependencies:** Phase 8.
- **Work:**
  - **Shell:** the `ShellViewModel` mirrors `App.tsx`: sections, overlay route with `returnTo`, source pick (`ui:source`),
    profile chooser at launch (2 or more profiles), the setup state (`describeSetup` port), the launch catch-up gate
    (0.7–10 s), the double-Back exit with toast, and the update badge (wired in Phase 15).
  - **Nav bar** per TVUX-01.
  - **Sections and focus:**
    - Section hosting with `SaveableStateHolder`, hoisted list states, and `lastFocusedKey` per section.
    - Focus restore after overlays (retry for 4 frames).
  - **Sign-in screens** per AUTH-01..04. The QR code comes from ZXing core.
  - **Profiles:** Who's watching, the PIN pad and the switch flow per PROF-01..04; the Profiles settings pane per
    PROF-06..10 (it lives in Settings later; build it here).
- **Tests:**
  - Compose UI tests: launch → sign-in → setup → Home placeholder; Back semantics (TVUX-04); the PIN pad (wrong PIN,
    erase, confirm mismatch).
  - Focus traps; the exit toast timing (2.5 s).
- **Acceptance:** the side-by-side scripts `M-signin.md` and `M-profiles.md` pass.
- **Parity checks:** AUTH-01..04, AUTH-09/10, PROF-01..10, IMP-02, SRC-08, TVUX-01..08, TVUX-10.
- **Performance checks:** cold start to the sign-in screen and to Home (cached) vs baseline.
- **Must not change:** wording, order of steps, gate timings.

## Phase 10: Home and Live TV

- **Objective:** HOME-* and LIVE-* with the shared building blocks (Hero, rows, cards, options sheet, Browse).
- **Files:** `:app` `ui/home/*`, `ui/live/*`, `ui/components/{Hero,PosterCard,ChannelCard,ChannelLogo,DetailActions,Fade}.kt`,
  a browse screen shared by Live, Movies and Series; `:core` `guide/GuideRepository.kt` (now/next and listings queues
  from `airing.ts`).
- **Dependencies:** Phase 9.
- **Work:** port `Start.tsx`, `Home.tsx`, `Live.tsx`, `Browse.tsx` and `channelActions.ts` / `pinning.ts` behaviour:
  - **Rows and hero:**
    - Rows exactly as HOME-01 / LIVE-01, with the persisted rows cache.
    - Hero timing: 240 ms; detail fetch after 700 ms.
    - Long press → `OptionsSheet` with the per-row action lists; ignore the release for 800 ms.
  - **Browse:**
    - Layouts: pills (Live) and list (VOD).
    - Paging: 60 per page up to 600. Fetch by `offset` instead of re-reading `0..limit`; the visible result must be identical.
    - The open category per section is remembered.
    - The On-now strip: 350 ms rest, cached 5 min.
    - Pin / Hide with confirmation.
  - **Images:** Coil, with sizes applied.
- **Tests:**
  - DB golden for row content.
  - Compose tests: options sheet action lists per kind and row; Back to the nav bar and top reset; source pick scoping.
  - `GuideRepository` unit tests (latest-wins, limited parallelism, freshness).
- **Acceptance:** `M-home.md` and `M-live.md` side by side.
- **Parity checks:** HOME-01..07, LIVE-01..06, EPG-02/03, SRC-08.
- **Performance checks:** gfxinfo for the Home and Live scripts ≤ 5 % janky; key p95 ≤ 50 ms idle; tab switch ≤ 300 ms.
- **Must not change:** row order, caps, labels, timing constants.

## Phase 11: Player

- **Objective:** PLY-* and catch-up.
- **Files:** `:app` `ui/player/*`, `platform/Media3Player.kt`; `:core` `playback/{ResolveStream,PlaybackHealth,PlayerKeys,Viewing}.kt`.
- **Dependencies:** Phase 10.
- **Work:**
  - **Player setup:** ExoPlayer with the PLY-22 load control, the OkHttp data source with the Media3 UA, and
    `PlayerView` (no controller).
  - **Pure state machines:**
    - `PlaybackHealth` reducer per PLY-03..07.
    - `PlayerKeyReducer` per PLY-10..14 and PLY-20, covering streaks, scrub ticks (150 ms), surfing, carried selection,
      Last-channel memory, panels, the countdown cancel, and media keys directly (D2).
  - **Tracks:** captions and audio selection via `TrackSelectionParameters`; auto-caption and auto-audio once per stream;
    the default subtitle track forced off.
  - **Display:** caption style; Fit/Fill/Stretch per channel (`ui:fit:<id>`); speed.
  - **Saving:** progress every 5 s with the ≥ 2 s rule and on exit; recents on first play.
  - **Next episode:** the card with an 8 s countdown.
  - **Catch-up:** the list and timeshift playback.
  - **Failure screen:** with the account problem and Edit source.
  - **Sync and lists:** pick-up from another TV; the zap list; `keepScreenOn`.
- **Tests:**
  - Reducer scenario tests (a key sequence → expected selection/action), written from the TS handler.
  - The health reducer with a fake clock.
  - URL vectors.
  - Instrumented tests with `MockWebServer` serving a short HLS/TS sample.
- **Acceptance:** `M-player.md` side by side: live (good, dead → failover), VOD resume, episode → next, catch-up,
  captions and audio switching, picture fit memory, play/pause key once, Back order.
- **Parity checks:** PLY-01..25, EPG-06, EPG-07, SYNC-08, ERR-02 (player strings).
- **Performance checks:** select → first frame and zap times vs baseline (not worse); PSS during 1080p ≤ 320 MB; 30-min
  zap test growth ≤ 20 MB.
- **Must not change:** timings (4 s chrome, 12 s stuck, 15 s start, 8 s next, 2 s behind live), step sizes, labels.

## Phase 12: Movies and Series

- **Objective:** MOV-* and SER-*.
- **Files:** `:app` `ui/movies/*`, `ui/series/*`.
- **Dependencies:** Phase 11.
- **Work:**
  - Landing pages and browse via the Phase 10 components.
  - **Movie detail:** versions sheet, watched toggles, Start over, Remove from Continue watching.
  - **Series detail:**
    - Skeletons, the error, Edit source and Try another version flows, and the backup-server retry.
    - Season pills and the episode grid (columns from width), the art fallback chain with the blurred borrowed poster,
      and badges.
    - The initial scroll to the next unwatched episode, and the hold sheet.
    - Borrowed seasons from up to 3 donors.
- **Tests:** DB golden (up next, borrowed seasons, versions, play order); Compose tests for the hold sheet and the
  watched toggles.
- **Acceptance:** `M-movies.md` and `M-series.md` side by side.
- **Parity checks:** MOV-01..04, SER-01..07, IMP-07, PLY-26 flows into the player.
- **Performance checks:** detail open ≤ 300 ms with cached data; episode grid scroll janky ≤ 5 %.
- **Must not change:** shelf rules (de-dup, minimums, language filter), labels.

## Phase 13: Guide grid and XMLTV import

- **Objective:** EPG-01, EPG-02, EPG-04, EPG-05.
- **Files:** `:app` `ui/guide/*`; `:core` `guide/GuideImporter.kt`, `xmltv/GuideFile.kt`.
- **Dependencies:** Phase 10 (and Phase 7 for channels).
- **Work:**
  - The grid per EPG-01: windows, paging rules incl. the 350 ms guard, the details panel, focus kept while rows load.
  - Port `guideImport.ts` (staleness, retry, the shared file via `/guides/register` and `/app/<file>`, direct
    streaming parse with the 36 h horizon, delete-then-insert in slices, "never during an import", `dropUnusedGuides`)
    using `importEpg`/`importGuideFile` semantics.
- **Tests:** DB golden of `programmes` after importing a fixture guide (TS vs Kotlin); a staleness/retry state test;
  Compose test for paging at the edges.
- **Acceptance:** `M-guide.md` side by side; the owner's 19 MB guide imports without key latency impact.
- **Parity checks:** EPG-01, EPG-02, EPG-04, EPG-05.
- **Performance checks:** guide import time ≤ 30 % of baseline; key p95 during the import ≤ 80 ms.
- **Must not change:** windows, caps, horizons, retry and stale intervals.

## Phase 14: Search

- **Objective:** SRCH-*.
- **Files:** `:app` `ui/search/*`.
- **Dependencies:** Phases 10 and 12.
- **Work:**
  - The keyboard opens on entry. 2-character minimum, 200 ms debounce.
  - Results come from `searchAll` (already ported), with source names when mixed.
  - The last query is remembered, the empty texts are kept, and the channel zap list is the results.
- **Tests:** DB golden of results for 30 queries; a Compose test of the keyboard focus flow.
- **Acceptance:** `M-search.md`.
- **Parity checks:** SRCH-01, SRCH-02.
- **Performance checks:** results ≤ 150 ms after the debounce on the stick.
- **Must not change:** FTS query construction, limits, ordering.

## Phase 15: Settings, source editing, updater

- **Objective:** SET-*, SRC-02..07, SRC-11, UPD-*.
- **Files:** `:app` `ui/settings/*` (Sources, Hidden, Profiles, Captions, Account and updates), `ui/components/SourceForm.kt`,
  `platform/Updater.kt`, `platform/Installer.kt` + `InstallResultReceiver.kt` (copied from
  `apps/mobile/modules/testcard-installer`, Expo wrapper removed); `:core` `sync/SourceEditor.kt` (from `sourceEdit.ts`),
  `xtream/Account.kt` (`describeAccount`, `accountProblem`), `ServerPicker.kt` (from `hosts.ts`).
- **Dependencies:** Phase 9 (most panes) and Phase 8.
- **Work:** the panes per SET-01..04. The source form follows SRC-02/03 validation exactly; remove, refresh and the
  account lines follow SRC-06; the backup picker follows SRC-07.

  The updater:
  - **Manifest:** the native beta reads `apks.firetvNative`; after cutover it reads `firetv`.
  - **Checks:** auto check (8 s, 6 h, foreground) and the toggle.
  - **Prompt:** with notes; Later skips that version.
  - **Download:** to cache with a 45 s stall abort.
  - **Permission:** the flow and resume on return; install through `PackageInstaller`.
- **Tests:** a validation table from `sourceEdit.ts` (vectors where pure); manifest parse and the skip rule; a
  `MockWebServer` download with a stall; a UI Automator test for the install permission dialog on an emulator.
- **Acceptance:** a real update of the beta from build n to n+1 on the stick through the app's own prompt.
  `M-settings.md` and `M-updates.md`.
- **Parity checks:** SRC-02..07, SRC-11, SET-01..04, UPD-01..04, AUTH-10.
- **Performance checks:** none special.
- **Must not change:** messages, intervals, manifest semantics for the RN app (do not edit `apks.firetv` before cutover).

## Phase 16: Full parity and performance pass

- **Objective:** prove parity and the targets.
- **Files:** `apps/tv-native/parity/*.md` (all ticked), `macrobenchmark/`, the Baseline Profile, a strings diff script
  `apps/tv-native/parity/strings-diff.mjs`.
- **Dependencies:** all feature phases.
- **Work:**
  - Run every side-by-side script and tick every ID.
  - Generate and ship the Baseline Profile; run `tv-perf.mjs` against the native package.
  - Fix gaps.
  - Write `parity-report.md` (each ID → test names and script result) and `perf-report.md` (baseline vs native for each §15 metric).
- **Acceptance:** zero unticked IDs; §15 targets met, or each miss explicitly waived by the owner; the intentional
  differences D1–D8 signed off.
- **Must not change:** scope. This phase is fixes only.

## Phase 17: Data adoption and session carry-over

- **Objective:** an in-place update from the RN app keeps everything.
- **Files:** `:app` `platform/Adoption.kt` and tests; a fixture folder holding a pulled copy of the stick's
  `files/SQLite/testcard.db` (+ `-wal`) and SharedPreferences (only with the owner's consent; keep it out of git).
- **Dependencies:** Phases 6 and 8.
- **Work:**
  1. Detect the expo-sqlite DB path (verify the exact path in the expo-sqlite source), open it in place, and migrate if
     it is older than v15.
  2. Read expo-secure-store entries: verify its storage format and Keystore alias from the expo-secure-store Android
     source in `apps/mobile/node_modules`. Re-wrap the values with the native key; verify; then delete the old entries.
  3. On any failure keep the DB and go to code sign-in.
  4. Check that the RN app (rebuilt with a higher versionCode for the rollback test) opens the DB written by native.
- **Tests:** an instrumented test with a fixture DB; a re-import after adoption keeps every channel id (no duplicate
  channels, favourites intact); a rollback rehearsal on the emulator.
- **Acceptance:** a rehearsal on the stick: install the RN app, use it, update to the native build under
  `com.evcalex.testcard` through the in-app updater, and confirm favourites (including channel ones), progress, profiles,
  pins, captions and the source pick are intact without signing in.
- **Must not change:** the old data until the new copies verify.

## Phase 18: Beta, then cutover

- **Objective:** ship safely.
- **Work:**
  1. **Beta (owner's go needed):** publish to `apks.firetvNative` and run it for 2 weeks; issues go to GitHub.
  2. **Cutover (owner's go needed):** build under `com.evcalex.testcard` with versionCode `100000 + run`, the same
     certificate, and publish to `apks.firetv` with notes.
  3. Keep an RN rollback APK (versionCode `200000 + run`) built and **not** published.
- **Acceptance:** the stick runs native as `com.evcalex.testcard` with its data intact; no P1 issues for 4 weeks.

## Phase 19: Retire the React Native TV app

- **Objective:** one TV codebase.
- **Work** (owner's go needed):
  - Delete `apps/mobile`, `patches/expo-video@57.0.4.patch`, the `pnpm.patchedDependencies` entry and
    `android-apk.yml` (or retarget it at native); remove `scripts/android-dev.mjs` parts that only serve Expo.
  - Mark ADR 0009 "Superseded by ADR 0012" and ADR 0012 "Accepted, done".
  - Keep `packages/core`, the vectors, the Worker and the desktop app as they are.
- **Acceptance:** CI green; `pnpm install` no longer pulls React Native; the README and CONTEXT.md updated
  (Fire TV = `apps/tv-native`).
