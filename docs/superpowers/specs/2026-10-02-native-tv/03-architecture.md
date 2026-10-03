# Architecture: core reuse, native design, sync wire spec, project layout

## 6. `packages/core` reuse analysis

Kotlin on Android cannot import TypeScript. "Shared" therefore means one of three things: code that keeps serving the
desktop and Worker unchanged, **behaviour** shared through generated test vectors, or **SQL text** copied verbatim.
Running core inside an embedded JS engine on the TV was considered and rejected (ADR 0012, alternative D): it keeps a JS
runtime, a bridge to SQLite, and interpreted-JS parsing speed, which are the costs we are removing.

### A. Remains shared without modification

These serve desktop and the Worker exactly as today. The native app treats them as the **specification**.

| Module | Role after migration |
| --- | --- |
| `packages/sync-schema` (all) | The wire contract. The Kotlin `@Serializable` models mirror it field for field (§8). |
| `packages/core` as a whole | Desktop and Worker keep importing it unchanged. Its tests remain the behavioural oracle. |
| `c/sync/linkCrypto.ts` constants | The contract the Worker's `/link` page is already held to (`linkPageContract.test.ts`); Kotlin reproduces it. |
| `c/epg/buildGuide.ts` | Used by the daily guide job (`scripts/build-guides.mjs`), not by any client. |
| `c/db/openDatabase.ts` | Desktop only. |

### B. Can be shared after (small, additive) refactoring

Nothing is restructured. These are additions only, so desktop behaviour cannot change:

| Addition | Why |
| --- | --- |
| `packages/core/scripts/make-vectors.ts` + `packages/core/test-vectors/**` + `src/__tests__/vectors.test.ts` | Generates the input → output pairs both implementations are tested against; the vitest fails when committed vectors are stale. |
| `packages/core/scripts/make-db-vectors.ts` (+ fixture inputs) | Query-level golden outputs (Home shelves, browse, search, series detail, play order, feeds, profile swap). Runs under Electron-as-Node like the existing DB tests. |
| Crypto/link functions accept an injected IV/salt/code **only in the vectors script** (via `crypto.getRandomValues` stub), not by changing signatures | Deterministic crypto vectors without touching production code. |
| (Optional) a `zod-to-json-schema` export of `sync-schema` | A machine-readable contract for review. Not required by tests. |

### C. Must be rewritten in Kotlin (behaviour proven by vectors)

| Area | TS modules | Notes for the port |
| --- | --- | --- |
| Normalisation | `normalise/parseName`, `displayName`, `groupVariants`, `classifyCategory`, `genres`, `splitTitle`, `titleKey` | **IDs depend on these** (`groupVariants` keys contain `parseName().normalised`). Regex semantics must match JS exactly (see the pitfalls list in `05-sonnet-plan.md`). Keep `CLASSIFIER_VERSION` and `DISPLAY_NAME_VERSION` identical. |
| M3U | `source/m3u/parseM3U`, `adapter`, `classifyEntry` | Stream with OkHttp `BufferedSource.readUtf8Line()`; same attribute regex; last-comma display name; `Uncategorised` default; category id `${sourceId}:cat:${group}`. |
| Xtream | `source/xtream/client`, `vod`, `detect`, `catchup`, `inTurn`, `fetchResponding` | Streaming JSON (`JsonReader`) for list calls; 4 requests at a time; 20 s to first response; stream URLs concatenated raw; `base64Decode` for EPG text. |
| Imports | `db/importCatalogue`, `importSource`, `importVod`, `importSeries`, `importM3UVod`, `importVodDetails`, `storedKeys`, `categoryClassification`, `channelNames` | Same SQL upserts (verbatim). Same diff rules. Transactions sized by rows, without the pacing. |
| Queries | `db/queries`, `vodQueries`, `seriesQueries`, `homeQueries`, `searchQueries`, `progressQueries`, `channelFeeds`, `profiles`, `profileIdentity`, `profileSwap` | **SQL text copied verbatim.** The TS around it (de-dup, borrowed seasons, up-next, play order) is ported and proven by DB vectors. |
| Sync | `sync/client`, `syncController`, `localChanges`, `channelHistory`, `credentialCrypto`, `remoteKey`, `hidden`, `sourcePins`, `sourceOrder`, `sourceContent`, `sourceRemoval`, `linkSession`, `linkCrypto` | Wire spec in §8. Algorithms copied step by step, including the one-time flags. |
| EPG | `epg/parseXmltv`, `importEpg`, `importGuideFile`, `nowNext` | `XmlPullParser` + `GZIPInputStream` (gzip detected by magic bytes, as in TS). |
| Policy | `playback/progressPolicy` | 30 s floor, 95 % watched. |
| TV-app logic that lives outside core today | `m/src/state/setup.ts`, `hosts.ts`, `account.ts`, `sourceEdit.ts`; `m/src/playback/airing.ts`, `guideImport.ts`, `captions.ts`, `viewing.ts`, `resolveStream.ts`, `streamInfo.ts`; `m/src/ui/plainReason.ts`, `titles.ts`, `imageSize.ts`, `ChannelLogo.monogram`; `m/src/screens/player/format.ts`, `usePlaybackHealth.ts` | Pure functions → vectors. The vectors script imports them from `apps/mobile/src` under a Node loader that resolves `react`, `react-native`, `expo*` and `iconoir-react-native` to empty stubs (some live in files that also import those, e.g. `monogram` in `ChannelLogo.tsx`, `describeAccount` in `account.ts`), so **no app code changes**. `usePlaybackHealth` is ported as a state machine and tested by scenario. |

### D. Replace entirely (platform plumbing with no behaviour to keep)

| TS / RN piece | Native replacement |
| --- | --- |
| `m/src/platform/sqlite.ts` (sync adapter) | `androidx.sqlite` connections with a bundled SQLite (FTS5) on background dispatchers |
| `c/db/applyInSlices.ts` pacing (`setSlicePause`), `yieldToEventLoop` | Coroutines; write transactions of ~1,500 rows so readers (WAL) are never starved |
| `m/src/state/memoByVersion.ts`, global `version` / `catalogue` stamps | Per-table invalidation `Flow`s; catalogue-derived rows recomputed only when catalogue tables change |
| `m/src/platform/polyfills.ts` (quick-crypto, streaming fetch) | `javax.crypto`, OkHttp (keeping `User-Agent: node` for provider and API calls) |
| `m/src/platform/secrets.ts` (expo-secure-store) | Keystore-wrapped AES-GCM values in private SharedPreferences, same key names |
| expo-video + patch | Media3 ExoPlayer + `PlayerView` (`useController=false`) with `CaptionStyleCompat` |
| `m/modules/testcard-installer` (Expo module wrapper) | **The same Kotlin** with the Expo `Module` wrapper removed (K reuse) |
| expo-file-system download, expo-application version | OkHttp download to `cacheDir`, `PackageInfo` |
| `react-native-tvos` focus, `TVFocusGuideView`, `useTVEventHandler` | Compose focus system, `FocusRequester`, `focusRestorer`, `onPreviewKeyEvent` |
| `m/src/platform/pacing.ts`, `perf.ts` | Not needed; use `androidx.tracing` sections and logcat markers |

## 7. Native architecture

### 7.1 Shape

```
apps/tv-native/
  core/   pure Kotlin (JVM) library: no Android imports
          model · normalise · m3u · xtream · xmltv · crypto · sync (wire + controller) · db (SQL + repositories)
  app/    Android application: Compose UI, ViewModels, Media3 player, Keystore secrets, updater, wiring
  macrobenchmark/   (from Phase 16) start-up and scroll benchmarks, Baseline Profile generator
```

Two code modules, on purpose. `:core` holds everything that can be proven on the JVM in seconds with the shared
vectors, and it includes the database code, because `androidx.sqlite`'s bundled driver runs on the JVM too. `:app` holds
only what needs Android. No DI framework: `AppController`, built once for the process, holds the singletons.

### 7.2 Layers

| Layer | Contents | Rules |
| --- | --- | --- |
| Presentation (`:app`) | One `ViewModel` per screen exposing `StateFlow<UiState>`; Compose screens; a `ShellViewModel` for section, overlay route, source pick, profile chooser, setup state, exit hint | No DB, network or parsing calls; it only collects flows and calls repository `suspend` functions via `viewModelScope`. |
| Domain (`:core`) | Pure functions and state machines: normalisation, policy, setup progress model, playback-health reducer, player key reducer, guide paging | No I/O. Unit-tested with vectors. |
| Data (`:core`) | `Db` (connections, dispatchers, transactions, change notifications), repositories mirroring core's query modules (`ChannelRepository`, `VodRepository`, `SeriesRepository`, `HomeRepository`, `SearchRepository`, `ProfileRepository`, `SourceRepository`, `GuideRepository`), `CatalogueImporter`, `GuideImporter`, `SyncController`, `XtreamClient`, `M3uLoader` | Every public function is `suspend` or returns a `Flow`; it switches to the right dispatcher internally. |
| Platform (`:app`) | `KeystoreSecrets` (implements core's `SecretStore`), `Media3Player`, `Updater`/`Installer`, lifecycle hooks (foreground → catch-up, guides, update check) | Implements interfaces declared in `:core`. |

### 7.3 Threads: nothing heavy on the UI thread

| Work | Where it runs |
| --- | --- |
| SQLite writes | One **writer** connection confined to a single-thread dispatcher (`Dispatchers.IO.limitedParallelism(1)`). All write transactions are serialised there, as SQLite requires anyway. |
| SQLite reads | Two **reader** connections (WAL) on `Dispatchers.IO.limitedParallelism(2)`. |
| Parsing (JSON, M3U, XMLTV), normalisation, classification, hashing, PBKDF2/AES | `Dispatchers.Default` |
| Network | OkHttp, called through suspending wrappers |
| UI | Main thread: composition, layout, draw, focus, key handling |

Enforcement: StrictMode `detectDiskReads/DiskWrites/Network().penaltyDeath()` in debug and in instrumented tests. `Db`
asserts `Looper.myLooper() != Looper.getMainLooper()` in debug. Room is not used (see 7.5).

### 7.4 Database

- **Schema:** `SCHEMA_SQL` v15 copied verbatim into `core/src/main/resources/schema.sql`, plus the forward-only
  migration runner semantics of `migrateDatabase.ts`. **Schema changes stay frozen at v15 until the React Native app
  is retired.** Any change lands in `packages/core` first, so both apps can open the same file (needed for adoption and
  rollback, §13).
- **ID conventions identical to the current TV app**: the grouping-key separator NUL is stored as **U+0001** (as the
  expo adapter does), so an adopted database matches and `channelKeyFor`'s normalisation applies.
- **SQLite build:** `androidx.sqlite:sqlite-bundled` (`BundledSQLiteDriver`). The spike verifies FTS5, the `rank` ordering
  and its APK cost. If FTS5 is missing or too large, the fallback is requery `sqlite-android` (its own SQLite with FTS5).
- **Pragmas** as today: WAL, `synchronous=NORMAL`, `temp_store=MEMORY`, `cache_size=-16000`, `foreign_keys=ON`.
- **Invalidation:** each write transaction declares the tables it touched; `Db.changes: SharedFlow<Set<String>>`
  emits after commit; `Db.observe(tables) { query }` re-runs the query (debounced 50 ms) on a reader. This replaces both
  `version` (any synced table) and the `catalogue` stamp (catalogue tables only), exactly as precise as today or better.
- **Persisted landing rows** (`schema_meta rows:movies` / `rows:series`): kept as a cold-start optimisation (HOME-05).

### 7.5 Why not Room

Room was evaluated as requested and is **not appropriate here**:

- The schema uses `CHECK` constraints, FTS5 virtual tables and triggers. Room entities cannot express the first two, and Room
  query verification cannot see FTS5 tables (every search query would need `@SkipQueryVerification`/`@RawQuery`).
- Many queries are built dynamically (`channelShown`'s `NOT IN (...)` list, the shelves' `WHERE` assembly), which Room's
  compile-time model does not fit.
- The main parity lever is "SQL copied verbatim from core". Room would push towards rewriting queries.

What Room would have provided, invalidation and connection pooling, is about 150 lines on top of `androidx.sqlite`.
Room 2.7 sits on the same driver API, so adopting it later remains possible.

### 7.6 Sync and authentication

- `SyncClient` (OkHttp): base URL `https://testcard-sync.evcalex.workers.dev`, headers per §8. `SyncController`: the same
  state machine as `c/sync/syncController.ts` (`runOnce` with a rerun flag, pause/abort, profile, re-auth,
  `onSourcesAdded`), with coroutine timers in an application scope. It exposes `status: StateFlow<SyncStatus>` instead of
  being polled every 4 s.
- `SecretStore` interface (`getCredentials`, `saveCredentials`, `deleteCredentials`, `load/save/clearAccountPassword`)
  implemented with an Android Keystore AES-256-GCM key (alias `testcard.secrets`) wrapping values in a private
  SharedPreferences file. Key names are kept: `testcard.account-password`, `testcard.source.<id>`.
- **Derived-key cache:** the PBKDF2 output is cached in memory per (salt, password), as TS does. Additionally it may be stored
  wrapped by the Keystore so a cold start does not re-derive. This is invisible to the user; the spike decides whether
  it is needed.

### 7.7 Player

- One `ExoPlayer` per player session, reused across zaps (`setMediaItem` + `prepare`) instead of remounting per channel.
  This is invisible to the user and faster.
- `DefaultLoadControl` with the same numbers as PLY-22. OkHttp data source with `Util.getUserAgent(context, "Testcard")`.
  Media3 version matches expo-video (1.9.x) at first.
- `PlayerView` inside `AndroidView`, `useController = false`, `resizeMode` for Fit/Fill/Stretch, `subtitleView`
  styled with `CaptionStyleCompat` and `setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * scale)`.
- `PlaybackHealth`: the `usePlaybackHealth.ts` rules as a pure reducer fed by player events (status, playing, errors,
  timers), unit-tested by scenario.
- Keys go through a pure `PlayerKeyReducer` (rows, selection, surfing, streak seek, scrub, panels, next-episode
  countdown), fed from `onPreviewKeyEvent`. A `DPAD_CENTER` repeat after the long-press timeout counts as `longSelect`.
- `keepScreenOn = true` on the player view while playing.

### 7.8 Navigation and focus

- No navigation library. `ShellViewModel` holds `section` and `overlay: Route?`, mirroring `App.tsx` (an overlay
  route with `returnTo`).
- Visited sections keep their state through `rememberSaveableStateHolder`, with hoisted `LazyListState`s and a
  `lastFocusedKey` per section. When an overlay closes, focus is restored to the stored key's `FocusRequester`, retried
  on the next frames, as the RN app retries at 0/120/300/600 ms.
- Lists: `androidx.compose.foundation` `LazyColumn`/`LazyRow`/`LazyVerticalGrid` with stable keys, `focusRestorer()`
  on each row, and a `BringIntoViewSpec` that places the focused row under the top band (HOME-07). Use Compose for TV
  (`androidx.tv:tv-material`) for `Surface`/`Card` focus visuals; the old `TvLazy*` lists are deprecated.
- Focus traps for sheets and pickers with `focusProperties { exit = { FocusRequester.Cancel } }` and `focusGroup()`.
- Long press: track `KEYCODE_DPAD_CENTER` down and repeat in `onPreviewKeyEvent`; a repeat (or ≥ long-press timeout) fires
  the options sheet and swallows the matching up (HOME-04, SER-05).

### 7.9 Images and caching

Coil 3 on the shared OkHttp client:

- Disk cache of 150 MB in `cacheDir`; memory cache of 15 % of the heap.
- Every request carries an explicit `size()` (card or hero), and `sized()` (TMDB w342/w780) is applied first.
- `allowRgb565(true)` for posters. Crossfade only on the hero (300 ms), as today.
- Channel logos use the monogram fallback on error.

### 7.10 Background work

There is no work while the app is closed, matching today. An application-scope `CoroutineScope` runs:

- imports (one job per source, de-duplicated);
- the guide queue (one source at a time, never during an import);
- the backup-server check (+10 s);
- guide refresh (+60 s, on foreground);
- the update check (+8 s, every 6 h, on foreground when stale);
- the sync timers.

WorkManager is not used at parity.

## 8. Sync and encryption: verified wire specification

Verified in `c/sync/*`, `s/index.ts`, `w/routes/*`. Kotlin must match this byte for byte where it says "exactly".

### 8.1 Transport

| Item | Value |
| --- | --- |
| Base URL | `https://testcard-sync.evcalex.workers.dev` |
| Headers (all `/auth`, `/sync`, `/guides` calls) | `Origin: <baseUrl>` (needed for better-auth's CSRF check). `Authorization: Bearer <session token>` on authed calls. `Content-Type: application/json` when a body is sent. |
| Timeout | 15 s for the whole request, body included (`AbortController`). `setPaused(true)` aborts all in-flight calls. |
| Errors | Non-2xx → error carrying `status` and the body text. 404 on `GET /sync/salt` means "no salt yet". |
| User-Agent | The TV sends `user-agent: node` on every `fetch` (polyfill), so keep it for API and provider calls. Media requests use the Media3 UA (PLY-24). |

### 8.2 Authentication

| Call | Request | Response |
| --- | --- | --- |
| Sign up | `POST /auth/sign-up/email {email, password, name: email}` | `{user:{id}, token}`. Then `POST /sync/salt {salt}` (set-once; 409 if it exists). |
| Sign in | `POST /auth/sign-in/email {email, password}` | `{user:{id}, token}`. Then `GET /sync/salt` → `{salt}`; on 404, generate and set one (defensive). |
| Sign out | `POST /auth/sign-out {}` (authed), best-effort | — |
| Session | better-auth, 30 days, bearer plugin, unsigned raw token | — |
| Expiry handling | 401 on a sync → one silent `sign-in` with the stored password. 4xx → forget the session and set "Your session expired. Sign in again to keep syncing." Network error → keep the session. | — |

### 8.3 Key derivation and sealing (exactly)

| Parameter | Value |
| --- | --- |
| Salt | 16 random bytes, standard base64 with padding (`btoa`). Per account, stored server-side, not secret. |
| KDF | PBKDF2, PRF HMAC-SHA-256, **210,000** iterations, password = UTF-8 bytes of the string, salt = base64-decoded bytes, output 256 bits |
| Cipher | AES-256-GCM, **12-byte** random IV, **128-bit** tag appended to the ciphertext (WebCrypto layout), no AAD |
| Encoding | `blob` = base64(ciphertext‖tag), `iv` = base64(iv), standard alphabet with padding, no line breaks |
| Plaintext | UTF-8 `JSON.stringify(value)`. Key order and whitespace are irrelevant to readers (they `JSON.parse` and validate with zod). |
| Kotlin notes | Implement PBKDF2 yourself over `Mac.getInstance("HmacSHA256")` (`PBKDF2WithHmacSHA256` is missing below API 26). Use `Cipher.getInstance("AES/GCM/NoPadding")` with `GCMParameterSpec(128, iv)`, whose output is ciphertext‖tag like WebCrypto. Use `android.util.Base64.NO_WRAP` in `:app`, and in `:core` a tiny standard-alphabet Base64 or `java.util.Base64` (JVM). Test against TS vectors in both directions. |

### 8.4 Payloads inside the seal

**Source**, one of two shapes (zod union, Xtream first):

```
Xtream:   { host, username, password, backupHosts: string[], keyHost?, content: {live,movies,series},
            position?, pins?, skips?, epgUrl: string|null, hidden: SourceHidden[] }
Playlist: { playlistUrl, content, position?, pins?, skips?, epgUrl: string|null, hidden }
```

When writing (as `collectLocalChanges` does):

- Always: `content`, `epgUrl` (blank → `null`, never `""`) and `hidden`.
- Xtream: always `backupHosts` (possibly `[]`); `keyHost` = `sources.base_url` when not null.
- `position`: only when `sort_order` is not null.
- `pins`: **only when the profile watching is Main** (all of them, ordered by `pinned_at, rowid`).
- `skips`: only when non-empty.
- `label` = the source name (min 1 char).

When reading: absent optional fields mean "keep what you have". `epgUrl: null` means none.

**Profile:** `{name, colour, avatar|null, pin|null, position}`. `remoteKey` = the profile id; Main is `main`.

### 8.5 Rows, keys and cursors

| Item | Rule |
| --- | --- |
| Row shape | `{remoteKey, updatedAt, deletedAt|null}` plus `addedAt` (favourites), `playedAt` (recents), `position|null` (channel favourites), `{itemType, positionSecs, durationSecs|null, watched}` (progress). Tombstones of favourites/recents reuse `deletedAt` as `updatedAt` and `addedAt`/`playedAt`. |
| Source key | Xtream `sha1hex(normHost + "|source")`, where normHost = lowercase hostname + `:port` unless the port is "", 80 or 443 (WHATWG `URL` parsing, so match its host normalisation, IDNA included). M3U `sha1hex("m3u|" + url.trim())`. |
| Title keys | Xtream: movie `sha1hex(normHost|streamId)`, series `sha1hex(normHost|seriesId)`, episode `sha1hex(normHost|episodeId)`, with normHost from the source's `base_url` (identity host). M3U: `sha1hex("m3u|"+url.trim()+"|movie|"+movieKey)`, `"…|series|"+seriesKey`, `"…|episode|"+…`. |
| Channel key | `"ch." + hash64(sourceRemoteKey + "|" + channelIdWithoutSourcePrefix)`, with U+0001 read as NUL. hash64 = two FNV-1a 32-bit passes (seeds `0x811c9dc5`, `0x9747b28c`, prime `0x01000193`) over **UTF-16 code units**, each as 8 hex chars. (Device-dependent; see SYNC-09.) |
| Hidden channel key | The channel id less `"<sourceId>:"` (stored as is). |
| Profile prefix | Non-Main rows: `p.<profileId>.` + key. Pull adds `&profile=<id>` for non-Main. Main's pull has no `profile` param, and the server returns keys not starting `p.`. |
| Push cursor | Push rows with `updated_at > last_pushed_at`. Then `last_pushed_at = max(old, response.newCursor)`; clear tombstones with `deleted_at <=` the largest `deletedAt` pushed. |
| Pull cursor | `GET /sync/pull?since=<last_pulled_at>` (`0` once while `sync_source_edits_reread` is unset). New cursor = `serverCursor`, or `min(serverCursor, deferredBeforeMs − 1)` when rows for missing titles were skipped. |
| Conflicts | Last write wins on `updatedAt` (strictly greater replaces), on the server and on each client. Sources: an existing local source with `sync_updated_at >= updatedAt` is left alone. A removal is ignored if the local source was re-added later. |
| `lastChangedAt` | Set when a pull returned any rows; drives screen refresh and the guide queue. |
| Timing | Periodic 60 s; change-triggered 3 s after, at least 15 s apart; one run at a time with one queued rerun; paused ⇒ no runs. |
| One-time flags | `schema_meta`: `sync_source_edits_reread`, `sync_epg_urls_sent`. |

### 8.6 Link (code) sign-in

| Step | Detail |
| --- | --- |
| Code | 8 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` via `byte % 32` |
| Lookup | base64(PBKDF2-SHA256(code UTF-8, salt = UTF-8 `"testcard-link-lookup-v1"`, 210,000, 256 bits)) |
| Start | `POST /link/start {lookup, salt}` (salt = 16 random bytes, base64) → `{expiresAt}` (10 min). 409 = "Try again." |
| Poll | `GET /link/poll?lookup=<urlencoded>` every 2 s. 404 means expired, so make a new code. `{status:"waiting"}`, or `{status:"ready", blob, iv}` (**one-shot**: the server deletes it on read). |
| Open | AES-GCM with the key = PBKDF2-SHA256(code, base64-decoded salt, 210,000) → `{email, password}`, then a normal sign-in |

### 8.7 Guides and updates (same Worker)

- `POST /guides/register {url}` (authed) → `{file}`. Only for `isSharableGuideUrl` addresses: https, no credentials,
  query or hash, not localhost/IP, path ending `.xml`, `.xml.gz` or `.gz`, at most 500 chars.
  File name = `"guide-" + sha256hex(url)[0,32] + ".json"`.
- `GET /app/<file>` serves the guide JSON `{at, c: {tvgId: [[start,end,title],…]}}` (gzip content-encoding; OkHttp
  decodes it) and the update manifest `latest.json` (no-cache) and the APKs.

### 8.8 Backend changes required

**None** for the native app to interoperate. Two optional, non-code changes for the rollout (§13):

- a new manifest key `apks.firetvNative` written by a new release step;
- later, pointing `apks.firetv` at the native APK.

`w/routes/release.ts` already allows `.apk` and `.json`. If the channel-key defect is ever fixed, the fix changes clients
only (core + both apps) and needs a re-key migration, not a Worker change.

## 16. Proposed project structure

The repository groups by deliverable under `apps/` (`desktop`, `mobile`, `sync-worker`) and shared libraries under
`packages/`. pnpm's workspace glob `apps/*` only picks up folders with a `package.json`, so a Gradle project without one
is ignored by pnpm.

```
apps/tv-native/                       new: the native Fire TV app (Gradle, Kotlin)
  settings.gradle.kts
  build.gradle.kts
  gradle/libs.versions.toml           one version catalogue (Compose BOM, tv-material, Media3 1.9.x, OkHttp, Coil 3, kotlinx.serialization, androidx.sqlite)
  core/
    build.gradle.kts                  kotlin("jvm"); test resources include ../../../packages/core/test-vectors
    src/main/kotlin/com/evcalex/testcard/core/
      model/        Source, Channel, Movie, Series, Episode, Programme, Profile …
      normalise/    ParseName.kt, DisplayName.kt, GroupVariants.kt, ClassifyCategory.kt, SplitTitle.kt, TitleKey.kt, Genres.kt
      m3u/          ParseM3u.kt, ClassifyEntry.kt, M3uLoader.kt
      xtream/       XtreamClient.kt, Vod.kt, Detect.kt, Catchup.kt, Account.kt
      xmltv/        ParseXmltv.kt, GuideFile.kt
      crypto/       Pbkdf2.kt, Seal.kt (AES-GCM), Base64.kt, Hashes.kt (sha1/sha256/fnv)
      sync/         Wire.kt (@Serializable mirrors of sync-schema), SyncClient.kt, SyncController.kt, LocalChanges.kt,
                    ChannelHistory.kt, RemoteKey.kt, Link.kt, Hidden.kt, Pins.kt, SourceOrder.kt, SourceContent.kt, SourceRemoval.kt
      db/           Db.kt (connections, dispatchers, changes), Schema.kt (+ resources/schema.sql), Migrations.kt,
                    ChannelQueries.kt, VodQueries.kt, SeriesQueries.kt, HomeQueries.kt, SearchQueries.kt, ProgressQueries.kt,
                    Profiles.kt, ProfileSwap.kt, ChannelFeeds.kt
      importing/    CatalogueImporter.kt, ImportSource.kt, ImportVod.kt, ImportSeries.kt, ImportM3uVod.kt, VodDetails.kt,
                    StoredKeys.kt, Maintenance.kt, SetupProgress.kt
      guide/        GuideRepository.kt (now/next + listings queues), GuideImporter.kt
      playback/     ResolveStream.kt, PlaybackHealth.kt, PlayerKeys.kt, Captions.kt, Viewing.kt, StreamInfo.kt, ProgressPolicy.kt
      text/         PlainReason.kt, Titles.kt, ImageSize.kt, Monogram.kt, Format.kt
      SecretStore.kt                  interface implemented in :app
    src/test/kotlin/…                 vector tests, DB golden tests, sync integration tests
  app/
    build.gradle.kts                  com.android.application; applicationId com.evcalex.testcard.tv (beta) → com.evcalex.testcard (cutover)
    src/main/AndroidManifest.xml      LEANBACK_LAUNCHER, banner, INTERNET, REQUEST_INSTALL_PACKAGES, usesCleartextTraffic, allowBackup=false
    src/main/kotlin/com/evcalex/testcard/tv/
      TestcardApp.kt  AppGraph.kt  MainActivity.kt
      platform/       KeystoreSecrets.kt, Installer.kt + InstallResultReceiver.kt (from modules/testcard-installer), Updater.kt, Lifecycle.kt
      ui/theme/       Colors.kt, Type.kt, Scale.kt (uiScale), Fonts (Inter 400/500/600 in res/font)
      ui/components/  FocusCard.kt, NavBar.kt, NavTab.kt, MenuRow.kt, Pill.kt, OptionsSheet.kt, PinPad.kt, PosterCard.kt, ChannelCard.kt,
                      ChannelLogo.kt, Hero.kt, DetailActions.kt, Backdrop.kt, Fade.kt, SetupOverlay.kt, Toast.kt, QrCode.kt, Avatar.kt
      ui/shell/       ShellScreen.kt, ShellViewModel.kt, SourcePicker.kt
      ui/signin/  ui/profiles/  ui/home/  ui/live/  ui/guide/  ui/movies/  ui/series/  ui/search/  ui/settings/  ui/player/  ui/update/
    src/main/res/                     banner, launcher icons (from apps/mobile/assets), fonts
    src/androidTest/                  Compose UI tests, StrictMode gate
  macrobenchmark/                     (Phase 16) start-up, scroll, key-latency benchmarks; Baseline Profile generator
  parity/                             manual side-by-side device scripts (M-*.md) and the strings diff
.github/workflows/tv-native.yml       new: build, :core:test, lint on push/PR touching apps/tv-native or packages/core; manual APK build + publish step
packages/core/scripts/make-vectors.ts, make-db-vectors.ts      new (additive)
packages/core/test-vectors/                                     new (generated, committed)
scripts/tv-perf.mjs                                             new: Phase 0 device measurement script (works for either app)
```

**Untouched:** `apps/desktop`, `apps/sync-worker`, `packages/sync-schema`, and all of `packages/core/src` except the new
vectors test. `apps/mobile` is frozen for features during the migration and gets only release fixes (ADR 0012). It is
deleted at retirement (Phase 19).
