# Native Fire TV app: investigation and migration plan

Status: **proposal, not started**. Written 2026-10-02 from a read of the repository at `49e0d31` (main). Nothing here has
been run on a Fire TV device; every device number below is either quoted from earlier emulator work or is a target to
be measured. The companion decision record is [`docs/adr/0012-native-android-tv.md`](../../../adr/0012-native-android-tv.md).

## 1. Executive summary

The Fire TV app (`apps/mobile`, Expo 57 + `react-native-tvos` 0.86, Hermes, New Architecture) runs **everything on one
JavaScript thread**: every SQLite read and write (`expo-sqlite` `executeSync` through the better-sqlite3-shaped adapter in
`apps/mobile/src/platform/sqlite.ts`), the whole catalogue import (JSON/M3U parsing, name normalisation, classification,
variant grouping, remote-key hashing), the XMLTV guide import (gunzip + SAX in JavaScript), sync (decrypting, applying,
hashing every channel key), React reconciliation for every D-pad move, and the player's chrome. The codebase already
contains a long list of workarounds for exactly this: import "pacing" that pauses the import whenever a remote key was
pressed in the last 600 ms (`platform/pacing.ts`), 40 ms transaction slices (`core/db/applyInSlices.ts`),
`requestIdleCallback` row builds, rows persisted across launches, data-version gating so hidden sections do not re-query,
"latest only" guide fetches, and a blocking "Getting Testcard ready" screen during every import. Those mitigations are
the ceiling of the current architecture: they hide work, they do not move it off the thread the remote depends on.

A native Kotlin + Jetpack Compose (Compose for TV) + Media3 app would fix the structural problem: database, import,
guide, sync and crypto run on background dispatchers, so the UI thread only handles focus, layout and drawing. It will
**not** by itself fix query cost (the Movies/Series shelves scan whole tables with `LIKE` and `CAST`), image decode cost,
provider latency, decoder limits or the deliberate 10-second launch catch-up. Those need the targeted work listed in
[`01-findings.md`](01-findings.md) §3.

`packages/core` cannot run on the TV once React Native is gone. Its **behaviour** can be kept, though: the TypeScript
core becomes the reference implementation, and a set of generated **test vectors** (inputs and outputs produced by the
TS code) is checked into the repository and run by both the vitest suite and the Kotlin JVM tests. That is how
"wire-compatible" and "same IDs" become something a test proves rather than something we hope.

Sync compatibility was verified against the code, not the docs. It is PBKDF2-HMAC-SHA256 with 210,000 iterations over
the UTF-8 password and a base64 16-byte per-account salt, giving an AES-256-GCM key. Each seal uses a random 12-byte IV
and a 128-bit tag appended to the ciphertext, with no AAD, and stores base64 `blob` + `iv`. Pushes and pulls are
last-write-wins on client `updatedAt`, with the cursor built from client timestamps. Details are in
[`03-architecture.md`](03-architecture.md) §8. **No backend change is needed.** Two Android-specific traps were found:
`PBKDF2WithHmacSHA256` is not in the platform crypto provider below API 26 (the app's minSdk is 24), and
`java.util.Base64` is API 26+. Both have simple workarounds.

Three existing defects matter to the migration. They are documented, not fixed, by this plan:

1. **Channel favourites, recently watched channels and hidden channels do not sync between devices.** A channel's
   account key (`core/sync/channelHistory.ts` `channelKeyFor`) hashes the channel id less its source prefix. The
   real id still contains the device's own random source UUID twice (`<src>:channel:<src>\0<src>:<cat>\0<name>\0<cc>`).
   Reproduced: one channel on one account gave `ch.6002e48cbe993fe7` on one device and `ch.9db36d6688d87dbd` on another.
   The unit test passes only because it uses simplified ids. The consequence for migration is that a fresh install
   of any app (old or new) loses that TV's channel favourites, so the cutover must adopt the old database in place
   (see [`04-delivery.md`](04-delivery.md) §13).
2. **The crash screen is not mounted.** Commit `00039e0` added `ui/ErrorBoundary.tsx` and imports it in `App.tsx`,
   but never renders it. A render error still leaves a blank screen.
3. **CONTEXT.md is stale** in places, for example "a change of server changes the source's remote key". The code keeps
   the key. This plan follows the code.

## Recommendation

**Proceed, but behind two gates.** Gate 1 (Phase 0) measures the current app on a real Fire Stick with a repeatable
script, because the repository has no device numbers at all, only emulator ones. Gate 2 is the spike in
[`04-delivery.md`](04-delivery.md) §10: a small native build that signs in, syncs, imports one live source, lists
channels and plays one. It must beat the Phase 0 baseline on the same stick by the margins in §15 of
[`01-findings.md`](01-findings.md), above all key-to-focus latency *while an import runs*. If the spike does not clear
those margins, stop and take the cheaper fallback instead: keep React Native but move SQLite, import, guide and sync into
a Kotlin worker module (alternative B in the ADR).

The full migration is large: about 8k lines of TypeScript core logic and 11k lines of TV UI to reproduce, without losing
any of the 136 feature IDs inventoried in [`02-parity.md`](02-parity.md). It is incremental, though. The old app ships
unchanged throughout, the native app runs side by side under its own package until it reaches parity, and the
cutover is an in-place update that keeps the user's data.

## Documents

| File | Contents (headings follow the brief's numbering) |
| --- | --- |
| [`01-findings.md`](01-findings.md) | 2 Current architecture, 3 Performance findings, 9 Fire TV compatibility, 15 Benchmarks and targets |
| [`02-parity.md`](02-parity.md) | 4 Feature inventory, 5 Parity matrix, 12 Testing and parity strategy, intentional-differences register |
| [`03-architecture.md`](03-architecture.md) | 6 `packages/core` reuse, 7 Native architecture, 8 Sync and encryption wire spec, 16 Project structure |
| [`04-delivery.md`](04-delivery.md) | 10 Spike, 11 Migration phases, 13 Rollout and rollback, 14 Risk register |
| [`05-sonnet-plan.md`](05-sonnet-plan.md) | 18 Step-by-step implementation plan for a Sonnet agent |
| [`../../../adr/0012-native-android-tv.md`](../../../adr/0012-native-android-tv.md) | 17 ADR draft (Proposed) |

Feature IDs (`AUTH-03`, `PLY-12` …) are defined in `02-parity.md` and used everywhere else. Every phase in
`05-sonnet-plan.md` names the IDs it must make pass.
