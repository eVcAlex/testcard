# Parity report (native Fire TV app)

Status on 2026-10-02. One row per ID group of `docs/superpowers/specs/2026-10-02-native-tv/02-parity.md` §11. **Nothing here has
run on a Fire Stick yet**, and nothing has run against the owner's real account, so every "device" column below is the
`tv1080` emulator (x86_64, fake provider on `scripts/tv-fake-provider.mjs`, local `wrangler dev`) and every "not ticked" is a
real gap, not a formality.

Legend. **Auto** = a test that fails if the behaviour changes: *vec* = shares test vectors generated from the TypeScript (the
oracle), *gold* = DB golden (same inputs, same rows as the TS), *unit* = JVM test, *it* = `SyncIntegrationTest` (two devices against
a real local Worker), *inst* = instrumented on the emulator. **Emu** = seen working on the emulator. **Gap** = not yet proven.

| ID | Where it lives (native) | Auto | Emu | Gap |
| --- | --- | --- | --- | --- |
| AUTH-01 code sign-in | `ui/signin/SignIn.kt`, `core/sync/LinkSession.kt`, `Link.kt`, `ui/components/QrCode` | vec (code, lookup, sealed secrets) | code + QR + countdown shown; `LaunchTest` inst | a phone completing a link against the real Worker |
| AUTH-02 account from the phone | Worker page, unchanged | – | – | none (not TV code) |
| AUTH-03/04 form, sign-up confirm | `SignIn.kt` | – | form + confirm shown | keyboard focus flow by remote on a stick |
| AUTH-05/06/08/09/12 sign-up, error words, re-auth, status gate, client | `core/sync/SyncController.kt`, `SyncApi.kt` | it (sign-up, sign-in, wrong password, unknown account), unit (`SyncScheduleTest`: expired session re-signs-in quietly, refused ends session with the message) | signed up/in on the emulator | error words for 409/422/5xx only by reading |
| AUTH-07 persistence | `sync_state` + `platform/KeystoreSecrets.kt` | inst (`AdoptionTest` writes/reads through the Keystore) | relaunch resumes | – |
| AUTH-10 sign out | `ui/settings/Settings.kt` AccountPane | – | – | the modal and the cleared state were not driven |
| PROF-01..03, 05..10 chooser, PIN pad, settings | `ui/profiles/Profiles.kt`, Settings Profiles pane | vec (`pinHash`) | chooser, pane seen | PIN wrong/erase/mismatch by remote |
| PROF-04, 11, 12, 13 swap, sync, legacy import, tables | `core/db/Profiles.kt`, `ProfileSwap`, `AppController.switchProfile` | gold (stash round trip), vec | – | per-profile pulls between two devices (not in `it`) |
| SRC-01, 09, 10 apply/remove sources, content, order | `SyncController.applySource`, `SourceSettings.kt` | it (arrives with login, removal follows), gold | – | content-switch and order edits across devices |
| SRC-02/03 source form | `SourceEditor.kt`, `SourceFormDialog` | unit (validation via vectors where pure) | dialog drawn | **saving a source through the form was not driven by remote** |
| SRC-04, 05 remove, refresh in flight | `AppController.removeSource/refreshSource` | gold, it | – | Remove button in the pane |
| SRC-06, 11 account lines | `core/xtream/Account.kt`, Sources pane | vec | "Expires 31 Dec 2026 · 0 of 2 streams in use" shown | – |
| SRC-07 backup servers | `core/sync/ServerPicker.kt` | – | – | needs a provider with two addresses |
| SRC-08 source pick | `AppController.pickSource`, `ui:source` | – | – | – |
| IMP-01..07 import, setup overlay, maintenance, keys, VOD details | `core/importing/*`, `setup/Setup.kt`, `SetupOverlay` | vec + gold (the full import of the provider world equals the TS database, both kinds) | import of both fake sources, setup screen | timing on the stick; a real provider's size |
| SYNC-01 timers | `SyncController` | unit (`SyncScheduleTest`: coalescing at 3 s, 15 s gap, 60 s tick, pause) | – | – |
| SYNC-02..06 collect/apply | `LocalChanges.kt`, `ChannelHistory.kt`, `SourcePayload.kt` | vec, gold; `it` (two devices, real local Worker): sources with their encrypted logins, removals, movie favourites and recents, progress | – | channel favourites/recents across devices with **different source ids** never match: the account key contains the local source id (SYNC-09, kept as the TS has it; idea for an `after-native` issue). Pins, hidden, skips, profiles not in `it` |
| SYNC-07, 09 change poll, channel key | `AppController`, `ChannelHistory.kt` | vec (incl. U+0001) | – | – |
| SYNC-08 pick-up from another TV | `ui/player/Playing.kt` | – | – | not driven |
| HOME-01..07 | `ui/home/*`, `core/db/HomeQueries.kt` | gold (row content and order) | Home rows, hero, focus | scroll snapping feel; persisted rows cache is **not** built (rows are re-read on entry) |
| LIVE-01..06 | `ui/sections/Sections.kt`, `Browse` | gold | Live rows, categories, hidden | favourite reorder |
| EPG-01 guide grid | `ui/sections/Guide.kt` | – | grid, focus, paging | **programme blocks with real listings** (fake provider has no EPG for listed channels) |
| EPG-02/03 airing queues | `core/guide/GuideRepository.kt` | unit | – | – |
| EPG-04/05 guide import | `GuideImporter.kt`, `epg/*` | vec (XMLTV), gold | – | a real guide file's timing |
| EPG-06, 07 programme bar, catch-up | `Playing.kt`, `playback/Catchup.kt` | vec (`timeshiftStamp`, entries) | – | **catch-up playback** |
| PLY-01 resolve stream | `playback/ResolveStream.kt` | vec (URLs incl. odd passwords) | VOD plays (sample.mp4) | – |
| PLY-02..08 health, feeds, failure words | `PlaybackHealth.kt`, `PlayerFormat.kt`, `Playing.kt` | unit (`PlayerStateTest`, state machine), vec | failure screen shapes | **live zap, feed fallback with a real stream** |
| PLY-09..14 controls and keys | `PlayerKeys.kt`, `ui/player/*` | unit (key reducer) | VOD transport, scrub shown | live controls, long-press behaviours |
| PLY-15/16 captions, audio | `playback/Captions.kt`, `Viewing.kt`, Media3 tracks | vec (`autoCaptionTrack`, `speaks`, style) | Captions pane + preview | **track panels on a stream with tracks** |
| PLY-17/18 fit, speed | `Viewing.kt` | vec | – | – |
| PLY-19..21 progress, recents, next episode | `core/db/Progress.kt`, `Playing.kt` | gold | progress saved on the sample | **next-episode countdown** |
| PLY-22..25 load control, keep awake, UA | `platform/Media3Player.kt` | – | – | review only |
| MOV-01..04, SER-01..07 | `ui/detail/*`, `ui/browse/*`, `VodQueries.kt`, `SeriesQueries.kt` | gold | both detail pages shown | borrowed seasons with real data |
| SRCH-01/02 | `ui/search/SearchScreen.kt`, `SearchQueries.kt` | gold (same ids, same order) | results as you type | keyboard auto-open by remote |
| SET-01..04 | `ui/settings/*` | – | Sources, Hidden, Profiles, Captions, Account panes | Edit/Remove/Hidden interactions |
| UPD-01..04 updater | `core/update/*`, `platform/Updater.kt`, `Installer.kt`, `ui/settings/UpdatePrompt.kt` | unit (`UpdateTest`: manifest, skip rule, download, stall, kept download) | check, prompt with notes, permission screen, download, system install confirmation, against a local manifest | **a real update on the stick**; the "Later skips that version" path by remote |
| TVUX-01..10 | `ui/shell/*`, `ui/components/*` | inst (`LaunchTest`) | nav bar, Back, double-Back exit, source pick | focus restore after covered shell |
| ERR-01 crash screen (D1) | `ui/ErrorActivity.kt`, handler in `TestcardApp.kt` | – | rehearsed with the debug `crash` extra; Try again restarts | – |
| A11Y-01..05 | `ui/theme/Theme.kt` | `strings-diff.mjs` (0 of 296 RN strings missing) | – | – |
| Data adoption (Phase 17) | `platform/Adoption.kt`, `core/db/Migrations.kt`, `core/adopt/*` | vec (migrations from v7, v10, v13 databases equal the TS), unit (secure-store format), inst (`AdoptionTest`) | – | **the rehearsal on the stick** (install the RN app, use it, update in place) |

## Differences from the TypeScript (intentional, all small)

- **Adoption keeps the old secure-store entries.** The plan says delete them after verifying; they are kept so a rollback to the
  React Native app still finds its logins. Delete them in the build after the rollback window.
- **Migrations skip nothing but run `renameChannels` on open**, as the TS does through `migrateDatabase`; category
  reclassification runs in the background (same as the TS's deferred maintenance).
- **D1 crash screen** exists (the RN one was never mounted), shown by a separate process because Compose has no error boundary.
- The updater reads `apks.firetvNative` (`-PapkKey=firetv` at cutover).
- No persisted rows cache yet (HOME-05): rows are rebuilt on entry; measure on the stick before deciding to add one.

## Also in place

- `parity/strings-diff.mjs` (run in CI): every user-facing string of the RN app and the shared core is in the Kotlin or in `strings-allow.txt` with a reason. 0 of 296 missing.
- A hand-written baseline profile (`app/src/main/baseline-prof.txt`, installed by profileinstaller). A measured one needs a macrobenchmark run on the stick.
- Not done: macrobenchmark module, `tv-perf.mjs` numbers on the stick, the side-by-side `M-*.md` scripts, the rehearsals on the stick (adoption, a real update).
