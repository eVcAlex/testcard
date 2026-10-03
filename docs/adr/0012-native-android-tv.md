# ADR 0012: A native Kotlin + Compose for TV app replaces the Expo Fire TV app

## Status

Proposed (2026-10-02). Gated on a baseline measurement of the current app on a Fire Stick and on a spike that must beat
it; see `docs/superpowers/specs/2026-10-02-native-tv/`. Would supersede ADR 0009 once the cutover is done.

## Context

ADR 0009 chose one Expo / `react-native-tvos` app so the TV could reuse `packages/core` (parsing, import,
classification, sync) without porting it. That worked for building quickly, and the app now has far more than its first
version: profiles, the guide grid, catch-up, feed failover, search, source editing, in-app updates and code sign-in.

The trade-off has stopped paying on old Fire Sticks. Core speaks better-sqlite3's synchronous API. On the TV, that means
every query, import write, guide insert and sync apply runs **synchronously on the one JavaScript thread** that also
renders the UI and answers the remote. The same thread also handles the XMLTV gunzip and parse, JSON parsing of
catalogues, name normalisation and remote-key hashing. The code base carries a stack of mitigations for this:

- imports pause while keys are pressed (`platform/pacing.ts`);
- work is cut into 40 ms transaction slices;
- rows are built in idle callbacks and persisted across launches;
- global data versions keep hidden screens from re-querying;
- guide fetches are "latest only";
- a blocking setup screen covers every import.

Each one hides work rather than moving it. On a slow stick, the visible symptom is a focus ring that lands late
whenever anything else is happening.

Native Android does not make queries, images or providers faster by itself. It does make it possible to run all of that
work off the UI thread, which a single-threaded JS runtime cannot.

## Decision

1. **A new native app, `apps/tv-native`**: Kotlin, Jetpack Compose with Compose for TV (`androidx.tv:tv-material`),
   coroutines, Media3 ExoPlayer, OkHttp, Coil, kotlinx.serialization, and a bundled SQLite through `androidx.sqlite`.
   Two modules: `:core` (pure JVM: models, normalisation, parsers, crypto, sync, SQL and repositories) and `:app`
   (UI, player, Keystore, updater). No DI framework, no navigation library.
2. **Nothing heavy on the main thread, enforced.** One writer connection on a single-thread dispatcher, two WAL reader
   connections, parsing on `Dispatchers.Default`, every repository API `suspend`/`Flow`, StrictMode `penaltyDeath` in
   debug builds, which is also what the instrumented tests run.
3. **The TypeScript core stays the specification.** Its code is not run on the TV. Its behaviour is shared through
   **generated test vectors** (`packages/core/test-vectors`, produced by `packages/core/scripts/make-vectors.ts` from the real TS
   functions, checked by a vitest that fails on drift) and **DB golden outputs**, which the Kotlin tests must reproduce. SQL
   text is copied verbatim. The schema stays at v15 until the React Native app is retired; any schema change lands in
   core first.
4. **Wire compatibility is mandatory and needs no backend change**:
   - PBKDF2-HMAC-SHA256 at 210,000 iterations, AES-256-GCM with a 12-byte IV and an appended 128-bit tag, base64 blob/iv;
   - the `sync-schema` payloads with the same optional-field rules;
   - last write wins on client `updatedAt` with client-derived cursors;
   - `p.<id>.` profile prefixes; the same link-code protocol; `Origin` and Bearer headers.

   PBKDF2 is implemented over `HmacSHA256`, because the platform lacks `PBKDF2WithHmacSHA256` below API 26 and the
   minSdk stays 24.
5. **Parity before cutover.** A 136-ID feature inventory; every ID tied to a test and to a side-by-side
   device script. Intentional differences are listed and signed off; the default is the current behaviour.
6. **Rollout keeps the user's data.**
   - **During development:** the app installs beside the old one as `com.evcalex.testcard.tv`.
   - **Cutover:** the native build takes over `com.evcalex.testcard` with a higher versionCode and the same signing
     certificate. It is delivered by the old app's own updater, and it adopts the old database and Keystore secrets in
     place.
   - **Rollback:** an RN build with a still higher versionCode.

## Alternatives considered

- **A. Keep optimising React Native.** Most cheap wins are already taken (see the mitigations above). The remaining
  cost is structural.
- **B. React Native UI with a native Kotlin worker module** (async SQLite, import, guide and sync in Kotlin). This
  removes most busy-time blocking and keeps the existing UI. Focus visuals still go through JS on every key, and it
  creates a third code base (TS core, Kotlin worker, RN UI). **This is the fallback if the spike fails.**
- **C. Kotlin Multiplatform for desktop and TV.** The desktop app is Electron/TypeScript and works. Rewriting it is out
  of proportion.
- **D. Run `packages/core` in an embedded JS engine on a background thread.** It keeps exact behaviour for free, but
  keeps interpreted-JS speed for the heaviest work (parsing, import), needs a JS↔SQLite bridge, and adds a runtime to the
  APK. Rejected in favour of vectors.
- **E. Room for the database.** Rejected: `CHECK` constraints, FTS5 tables with triggers and dynamically built SQL do not
  fit Room's entity and verification model, and the parity lever is verbatim SQL. Room 2.7 shares the same driver API,
  so it can be adopted later.

## Consequences

- **Performance goals** (proposed; to be calibrated against the Phase 0 baseline on a Fire OS 7, ~1 GB stick):
  - cold start to first frame ≤ 1 s;
  - key-to-focus p95 ≤ 50 ms when idle and ≤ 80 ms during an import;
  - janky frames ≤ 5 % on Home, Live and Movies;
  - live start and zap no worse than today;
  - PSS ≤ 220 MB browsing and ≤ 320 MB playing;
  - guide import ≤ 30 % of today's time with no UI impact;
  - APK ≤ 20 MB.
- **Risks:** silent feature loss, sync or ID drift between TypeScript and Kotlin, regex semantics, adoption failures,
  signing certificate and versionCode mistakes, Compose cost on 32-bit sticks, and a longer schedule. The mitigations
  are in the plan's risk register: vectors, cross-client tests against a local Worker, side-by-side device scripts, a
  rehearsed cutover, and the spike gate.
- **Two implementations of core logic exist** for as long as both the desktop app and the TV app live. New behaviour
  is written in TypeScript first, vectors are regenerated, and the Kotlin port follows. The `tv-native` CI runs on
  every change to `packages/core`.
- **`apps/mobile`** is frozen for features during the migration (release fixes only) and deleted after the cutover has
  been stable for four weeks, with its expo-video patch and the Expo parts of the Android scripts. No phone app ships
  today. A future phone app would start from `:core`.
- **`packages/core`** is unchanged for desktop and the Worker. It gains the vectors script, the committed vectors and a
  drift test. Its TV-only accommodations (slice pacing hook, U+0001 handling) stay, since they are harmless and the
  native app keeps the U+0001 id convention so an adopted database still matches.
- **Desktop** is unchanged. It keeps syncing with TVs through the same Worker and payloads.
- **Worker / backend** is unchanged. The release manifest gains an optional `apks.firetvNative` key during the beta.
  `apks.firetv` moves to the native APK at cutover.
- **Known defects carried over unchanged,** to be fixed separately if wanted:
  - channel favourites, recents and hidden channels hash a device-specific source UUID, so they do not match across
    devices;
  - the RN app's crash screen was never mounted (the native app will mount one, as that commit intended).
