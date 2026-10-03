# Phase 3 spike: status and what is left for you

Written 2026-10-02. The spike code is built and runs on the Android TV emulator. **Nothing has run on a Fire Stick or
against your real account**, so the S1–S8 and S12 numbers that decide go/stop do not exist yet. Nothing is committed.

## What was built (all in `apps/tv-native`)

| Spike scope item (04-delivery §10.1) | State |
| --- | --- |
| 1 Skeleton: `:core` + `:app`, Compose for TV, `com.evcalex.testcard.tv`, label "Testcard (native spike)", armeabi-v7a release, R8, StrictMode `penaltyDeath` in debug | Done. Debug and R8 release both build and launch on the emulator without crashing. |
| 2 Crypto: PBKDF2 over `Mac`, AES-GCM, sha1/sha256, `normalizeProviderHost`, remote keys, link code and lookup | Done in their final `:core` places. **Byte-exact against the TS vectors**, including identical sealed blobs for a fixed IV (`crypto.json`, `keys.json`, `link.json`). |
| 3 Email/password sign-in, salt, derive key | Done (`SyncApi`, `SpikeController`). Tested against a fake Worker; **not against the real one**. |
| 4 Pull only: decrypt sources, store logins in the Keystore, insert `sources` rows | Done for **Xtream and M3U** sources. Pins, skips, hidden and content switches are not applied (sync phase). |
| 5 Bundled SQLite opens schema v15 verbatim; FTS5 checked | Done. `schema.sql` is generated from `SCHEMA_SQL` by the vectors test (drift fails it). A JVM test matches a channel through `channels_fts`. |
| 6 Import one live source in the background | Done for Xtream and M3U (streaming EXTM3U parse and entry classifier, vector-tested; films and episodes left out): same SQL as `importSource.ts`, 4 provider calls at a time, 1,500-row transactions on the single writer thread, unchanged channels and variant lists not rewritten (tested). No classification beyond `parseName`, no VOD, no guide. |
| 7 Live screen: LazyColumn of category rows of LazyRow channel cards (Coil logos), category grid up to 600 | Done, with a Refresh button for the busy-time measurement. Hidden-channel filtering is left out. |
| 8 Play one channel with Media3 (live load control 60 s / 2.5 s / 48 MB), Up/Down zap, Back exits | Done, **never run against a real stream**. |
| 9 Debug overlay: key-to-frame latency, frame time, heap | Done. Also logged with the `TC_PERF` tag. |

Name parsing, display names and `groupVariants` ids were ported too (the spike needs the real channel ids), and all 937
`normalise.json` vectors pass.

## Checks that ran

- `:core:test` (JVM, real bundled SQLite, MockWebServer): vectors for crypto/keys/link/names/grouping/policy, plus an end-to-end
  test (sign-in → salt → pull → decrypt → store → import → read → stream URL → FTS5 → idempotent re-import → U+0001 ids). All pass.
- `:app:connectedDebugAndroidTest` on the `tv1080` emulator: launches to the sign-in screen with StrictMode on. Passes.
  StrictMode caught two real main-thread violations on the way (OkHttp client creation, SharedPreferences); both fixed.
- R8 release build (x86_64 variant of it) launches on the emulator.

## The 12 measurements

| # | Measurement | Result |
| --- | --- | --- |
| S1–S2 | Cold start / rows on screen | **Not measured.** Needs the stick. Emulator cold start 380–520 ms (release) is not comparable. |
| S3–S4 | Key latency idle / during import | **Not measured.** The overlay and `TC_PERF` logging are in place; `scripts/tv-perf.mjs <package> <activity>` drives it. |
| S5 | Jank | Not measured (`gfxinfo` via the script). |
| S6 | Import wall time | Not measured. Needs your source. |
| S7 | Zap / first frame | Not measured. `first_frame ms=` is logged. |
| S8 | PSS | Not measured. |
| S9 | PBKDF2 210k on the stick | Not measured. Logged as `TC_PERF pbkdf2 ms=` on sign-in. |
| S10 | Release APK (armeabi-v7a, R8) | **4.3 MB** (target ≤ 20 MB). |
| S11 | FTS5 present, search ids match TS | FTS5 present: yes (tested). Matching TS ids for 20 queries: **not done** (needs the DB goldens of Phase 6). |
| S12 | Decrypted sources equal the TS client's | Not done against the real account. The crypto and wire are proven byte-exact by the vectors. |

## To finish the decision (needs you)

1. `pnpm android stick <ip>` (or USB), then install the APK: CI artifact from the **TV native** workflow ("Run workflow"), or
   `gradle :app:assembleRelease` in `apps/tv-native` with the Android SDK at `C:/Android/sdk`.
2. Open "Testcard (native spike)", sign in with your **test account** first (the spike only pulls, it never writes to the
   account), and watch `adb logcat -s TC_PERF`.
3. Run `node scripts/tv-perf.mjs com.evcalex.testcard.tv .MainActivity --keys live` on the stick, then the same for the
   React Native app (`com.evcalex.testcard`), once idle and once while Refresh is importing.
4. Fill the table above and apply the decision rule: S11 and S12 must pass; go if S3 and S4 pass and three of S1, S2, S5, S6 pass;
   stop if S4 fails.

## Known gaps worth knowing about

- The spike reads its dependency versions from a catalogue written without a build at the time; they now resolve and build, but are
  not the newest.
- One reader connection (the plan has two).
- A session token and salt are not persisted: after a restart the app goes straight to the cached Live screen if channels
  exist, otherwise back to sign-in.
- Key-to-frame latency is measured to the start of the next frame (input delay plus the wait for a frame), the same way on every
  build, which is a proxy for "focus visible" rather than the exact figure Perfetto would give.

## Update 2026-10-03

The full app now exists (Phases 4-15 and 17 in code): see `apps/tv-native/parity/parity-report.md` for what is proven and what is not. The 12 spike
measurements above are still **not taken**; they need the release build signed in on the stick, then `scripts/tv-perf.mjs`.
