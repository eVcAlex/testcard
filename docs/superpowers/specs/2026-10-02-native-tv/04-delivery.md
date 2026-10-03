# Delivery: spike, phases, rollout, risks

## 10. Spike / proof of concept

**Question it answers:** on the owner's Fire Stick, does a native Compose + Media3 app with background database,
import and sync clearly beat the current app where it hurts: key response while busy, start-up and scrolling? And does
it stay compatible with the account?

**Prerequisite:** Phase 0 baseline numbers for the current app on the same stick, from the same script.

### 10.1 Scope (all of it, nothing more)

1. `apps/tv-native` skeleton: `:core` + `:app`, Compose for TV, applicationId `com.evcalex.testcard.tv`, label "Testcard
   (native spike)", armeabi-v7a, R8 on, StrictMode in debug.
2. Crypto: PBKDF2-HMAC-SHA256, AES-GCM seal and open, `sha1hex`, `normalizeProviderHost`, `remoteKeyFor`, link code and
   lookup. These must pass the TS vectors (Phase 1 provides the crypto subset first).
3. Sign-in by **email/password** (the code sign-in is optional in the spike) → token → salt → derive key.
4. Sync **pull only**: decrypt sources, store their credentials in the Keystore, insert the `sources` rows. No push. This
   avoids writing to the account at all.
5. Database: the bundled SQLite opens schema v15 verbatim; FTS5 is checked by a query.
6. Import of **one live source** (Xtream or M3U, whichever the owner uses): parse, `parseName`, `groupVariants` ids
   (vectors), upsert in transactions on the writer thread. No VOD, no classification beyond `parseName`, no guide.
7. A Live screen: a `LazyColumn` of categories with `LazyRow`s of channel cards (logo via Coil, name, number), focus
   ring, D-pad. Plus a category grid of ≤600 items.
8. Play one channel with Media3 using the same LoadControl numbers; Back exits; Up/Down zap through the row.
9. A debug overlay with key-to-frame latency, frame time and heap.

Out of scope: profiles, VOD, guide, settings, updates, push sync, code sign-in polish, visual fidelity.

### 10.2 Measurements (same stick, same account, release builds, both apps)

| # | Measurement | Method | Pass bar |
| --- | --- | --- | --- |
| S1 | Cold start to first frame | `am start -W` ×10, median | ≤ 70 % of the baseline app's |
| S2 | Cold start to channel rows on screen (data already imported) | logcat marker | ≤ 70 % of baseline "Live rows" |
| S3 | Key → focus visible, idle, 100 Right presses at 150 ms intervals | overlay / Perfetto | p95 ≤ 50 ms |
| S4 | Same **while the source re-imports** | trigger a refresh, then run S3 | p95 ≤ 50 % of the baseline app's p95 under the same load; no frame > 250 ms |
| S5 | Janky frames scrolling the Live rows and the 600-item grid | `gfxinfo` | ≤ 60 % of baseline |
| S6 | Import wall time for the source | timer | ≤ 70 % of baseline |
| S7 | Live start (select → first frame) and zap time, 10 channels | Media3 `onRenderedFirstFrame` | not worse than baseline (p50 and p90) |
| S8 | PSS after browsing script; after 10 min playback | `meminfo` | ≤ baseline |
| S9 | PBKDF2 210k on the stick | timer | report; must be ≤ 3 s or the cached-wrapped-key path is required |
| S10 | APK size (armeabi-v7a, release) | file size | report; target ≤ 20 MB |
| S11 | FTS5 present; channel search returns the same ids as TS for 20 queries | test | must pass |
| S12 | Sources decrypted from the real account match the TS client's output | compare JSON | must pass |

**Decision rule:** S11 and S12 must pass. If S3 and S4 pass and at least three of S1, S2, S5 and S6 pass, **go**. If S4
fails (busy-time responsiveness is the main reason for the rewrite), **stop** and prefer ADR alternative B: keep
React Native and move DB, import, guide and sync into a Kotlin module with an async API. Other mixed results go to the
owner with the numbers.

**Abandonment cost:** about 2–4 agent days of work. The parts that survive any outcome are the test vectors (Phase 1)
and the crypto/sync wire code. Alternative B would need them too.

## 11. Migration phases (overview)

Order follows real dependencies: vectors before ports, data before screens, Live before VOD (the spike and the
player need it), player before Movies and Series, profiles inside the shell (they change what every query reads), and
settings and updates last (sources arrive by sync, so add/edit is not needed early). The full per-phase instructions
are in `05-sonnet-plan.md`.

| Phase | Name | Depends on | Definition of done |
| --- | --- | --- | --- |
| 0 | Baseline measurement | — | `scripts/tv-perf.mjs` exists; baseline numbers for the current app on the stick are recorded in `baseline.md`; the signing cert of the installed app is identified |
| 1 | Test vectors from TS | — | Vectors generated and committed; `vectors.test.ts` fails on drift; no production TS changed |
| 2 | Native skeleton + CI | — | Empty Compose TV app builds in CI, installs beside the old one, StrictMode on, `:core:test` runs vectors |
| 3 | Spike | 0, 1 (crypto subset), 2 | §10 measurements recorded; go/stop decision written in `spike.md` and signed off by the owner |
| 4 | Core crypto, keys, wire models | 1, 3 | All crypto, key and link vectors pass; `Wire.kt` round-trips TS JSON samples |
| 5 | Normalisation and parsers | 1 | All normalisation, M3U, Xtream DTO and XMLTV vectors pass |
| 6 | Database and repositories | 4, 5 | Schema v15, migration runner, every query module ported; DB golden vectors pass; StrictMode clean |
| 7 | Imports | 5, 6 | Catalogue, VOD, series, M3U VOD, lazy details and maintenance match the TS import outputs (DB golden); timing recorded |
| 8 | Sync | 4, 6, 7 | Cross-client integration scenarios pass both directions against a local Worker; controller timing rules unit-tested |
| 9 | Shell, sign-in, profiles, setup | 8 | AUTH-*, PROF-*, IMP-02, TVUX-01..06, 10 pass their tests and the side-by-side scripts |
| 10 | Home and Live (landing, browse, channel actions, now/next) | 9 | HOME-*, LIVE-*, EPG-03 pass |
| 11 | Player | 10 | PLY-*, EPG-06/07, SYNC-08 pass; key reducer scenarios pass; device script passes |
| 12 | Movies and Series | 11 | MOV-*, SER-*, IMP-07 pass |
| 13 | Guide grid and XMLTV import | 10 | EPG-01/02/04/05 pass; guide import ≤ 30 % of baseline time with no UI impact |
| 14 | Search | 10, 12 | SRCH-* pass (identical result ids and order) |
| 15 | Settings, source editing, updater | 9 | SRC-02..07, SET-*, UPD-* pass; a real in-place update from beta n to n+1 works on the stick |
| 16 | Full parity pass and performance pass | all | Every ID in `02-parity.md` ticked by its test and by the side-by-side script; §15 targets met or waived in writing; Baseline Profile shipped |
| 17 | Data adoption and session carry-over | 6, 8 | The native build under the old package name opens the old app's DB in place and keeps the user signed in (or falls back to code sign-in); tested on a copy of a real device DB |
| 18 | Beta, then cutover | 16, 17 | Beta channel on the stick for ≥ 2 weeks with no P1 issues; then `apps.firetv` points to native |
| 19 | Retire the RN TV app | 18 + 4 weeks stable | `apps/mobile` removed, the ADR 0009 status updated to superseded, CI cleaned up |

## 13. Rollout and rollback

### 13.1 During development (Phases 2–16)

- The native app installs **beside** the old one: applicationId `com.evcalex.testcard.tv`, label "Testcard Beta",
  its own banner tint. It has its own database, Keystore and sign-in (code sign-in makes this a 30-second job).
- It is signed with the same release keystore as the old app (from the repo secrets), so the cutover later is an update.
- Built by a new manual workflow `tv-native.yml`. Publishing is a **separate, explicit step** that writes
  `testcard-tv-native-<run>.apk` and adds `apks.firetvNative` to `latest.json`. Only native beta builds read that key. The old app
  only reads `apks.firetv`, so it is unaffected.
- Nothing is published, pushed or deployed without the owner's go (standing project rule).
- No feature flags: the native app is a separate install, and parity work is tracked by ID, not by flags.

### 13.2 Cutover (Phase 18): in-place update that keeps data

Why in place: a fresh install loses data that never reaches the account. Unpushed local-only settings are minor.
**Channel favourites and recently watched channels, though, cannot be recovered from the account** because of the
channel-key defect (SYNC-09): they only match on the device that made them. Adopting the old database file keeps
them, and keeps the source UUIDs that make those keys line up.

1. Build the native app with applicationId **`com.evcalex.testcard`** and a versionCode above every RN build
   (scheme: `100000 + run_number` for native; RN builds stay below 100000).
2. Sign it with the **same certificate** as the installed RN app. Phase 0 checks which certificate that is
   (`apksigner verify --print-certs`). If it is the public Expo/RN debug key, the native build uses the same debug
   keystore for this one transition, and the switch to the private key is a separate, announced uninstall-once event
   (ADR 0010 already describes that catch).
3. Point `apks.firetv` in `latest.json` at the native APK with notes. The RN app's own updater offers it, downloads it
   and installs it through `PackageInstaller`. No manual sideload is needed.
4. On first launch the native app adopts the data (Phase 17):
   - open expo-sqlite's database file in place, check `schema_meta.version` is 15 (or older and migratable), and run
     the same migration runner;
   - read the account password and source logins from expo-secure-store's encrypted SharedPreferences with the
     existing Keystore key (same UID). The exact storage format is verified in Phase 17. If any read fails, keep the DB
     but show the code sign-in; sources' logins arrive again by sync;
   - keep `ui:*` settings, `server:*`, `epg:*`, `rows:*`, profile stash, pins, pending channel rows as they are;
   - delete the old secure-store entries only after the native copies are written and verified.
5. Users do not need to sign in again if step 4 succeeds; at worst they scan one QR code. Catalogue, favourites,
   progress and settings are all kept.

### 13.3 Rollback

- **Before cutover:** uninstall or ignore the beta. Nothing is shared with the old app.
- **After cutover:** Android refuses a lower versionCode, so rollback means publishing the RN app again **with a higher
  versionCode** (e.g. `200000 + run`) through `apks.firetv`. The native app's updater installs it like any update.
  This is safe only because the schema stays frozen at v15 and the native app keeps the same `schema_meta` keys and
  secret names. Phase 17 adds a test that the RN app opens a database written by the native app. The rollback build
  must also read the native app's Keystore-wrapped secrets, or fall back to sign-in; the plan accepts a re-sign-in
  on rollback.
- **Kill switch:** the update manifest is the only distribution channel, so editing `latest.json` stops or reverses a
  rollout within one update-check cycle (≤ 6 h, or at the next launch).

### 13.4 Staging

The owner's stick(s) are the whole user base today (sideloaded, private). "Staged release" therefore means:

- beta on one stick for 2 weeks;
- cutover on that stick first;
- a week later, any other stick on the account.

A larger audience would add a cohort field to the manifest. That is not needed now.

## 14. Risk register

| Risk | Impact | Likelihood | Mitigation | Detection |
| --- | --- | --- | --- | --- |
| Functionality silently lost | High | Medium | 136-ID feature inventory; every phase lists the IDs it must pass; side-by-side device scripts; strings diff; no cutover until Phase 16 is fully ticked | Parity checklist in `apps/tv-native/parity/`; beta on the real stick |
| Sync incompatibility (crypto, payload, keys) | Critical (data loss across devices) | Medium | Byte-level vectors from TS; cross-client tests against a local Worker in both directions; spike pull-only; push enabled only after Phase 8 passes | X tests; a desktop check that sources and favourites made on native appear and vice versa |
| ID drift (normalisation regex differences JS vs Java) | High (orphaned favourites/progress, duplicate channels after adoption) | High without vectors | Vectors over real catalogue names plus awkward Unicode; port regexes with the JS-semantics checklist; `DISPLAY_NAME_VERSION`/`CLASSIFIER_VERSION` unchanged | Vector tests; adoption test compares ids of a re-import against the adopted DB |
| Authentication differences (Origin header, re-auth, salt) | High | Low | Spec §8; X tests including expired-token scenarios | X tests |
| Playback regressions (codecs, failover, timing) | High | Medium | Same Media3 version and LoadControl; PlaybackHealth reducer tests; device script across live/VOD/episode/catch-up and dead channels | Side-by-side device runs; beta logs |
| EPG regressions (parsing, time zones, catch-up stamps) | Medium | Medium | XMLTV vectors with offsets; `timeshiftStamp` vectors; compare `programmes` rows with TS for one guide | D tests; guide grid side by side |
| Fire TV compatibility (API 24/25 gaps, FTS5, 32-bit) | High | Medium | minSdk 24 kept; PBKDF2/Base64 workarounds; spike checks FTS5 and runs on the real stick | Spike S9–S11; CI on API 24 and 28 emulators |
| Memory on 1 GB sticks | High | Medium | Sized image requests; bounded caches; one player instance; no hidden composed sections; leak checks | `meminfo` in Phase 16; 30-min zap test |
| Startup time worse than expected (Compose on 32-bit) | Medium | Medium | R8, Baseline Profile, lazy init in `AppGraph`, no network before first frame | Spike S1; macrobenchmark trend |
| Compose performance (recomposition storms, focus jank) | High | Medium | Stable UI models, `remember` keyed lambdas, `derivedStateOf` for focus visuals, layout inspector recomposition counts | Spike S3–S5; Phase 16 gfxinfo |
| Duplicated business logic drifting (TS vs Kotlin) | High (long term) | High | Vectors fail TS CI on any change; rule: core changes land with vector updates; the native CI runs vectors on every core change | `vectors.test.ts` drift failure; `tv-native.yml` triggered by `packages/core/**` |
| Local data migration (adoption) fails | High (loss of channel favourites) | Medium | Phase 17 tests on copies of real DBs; never delete old data until new copies verify; fall back to sign-in | Adoption test suite; first-launch log |
| Update path (signing cert, versionCode) | High (users stranded on the old app) | Medium | Phase 0 cert check; versionCode scheme; real in-place update rehearsed in Phase 15 and 17 | Rehearsal on the stick |
| Longer development time than planned | Medium | High | Spike gate; phases ship value to beta incrementally; ADR alternative B as fallback | Phase burn-down per ID |
| Maintaining desktop TS + TV Kotlin | Medium | High | One spec (TS) and one vectors set; Kotlin has no logic without a vector or DB golden behind it; new features implemented TS-first | PR checklist |
| Phone app implications | Low | Low | No phone build ships today; the native project is TV-only; ADR 0012 records that a phone app, if wanted, starts from `:core` | ADR review |
| Hidden behaviour in Expo libraries (UA, buffering, media session, keep-awake) | Medium | Medium | Documented in PLY-22..25 from expo-video source; re-checked in Phase 11 | Side-by-side player script |
| Schema change during migration breaks rollback | High | Low | Schema frozen at v15 until retirement; any change goes through core and both apps | Code review rule |
| Channel-key defect fixed mid-migration | Medium | Low | If fixed, fix in TS + vectors first; Kotlin follows the vectors | Vector diff |
