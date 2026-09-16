# Device sync — design

## Scope

VOD-only cross-device sync: playback progress, watched state, favourites, and recently-watched
for movies and series (the Phase 4b data model), plus the Xtream credentials needed to add a
Source without re-typing them on a new device. Requires an account. Built multi-tenant from day
one (row-scoped by `user_id`) even though the only user initially is the author — no rework
needed if the app is released publicly later.

Out of scope for this design: live-channel/EPG sync (Sources' live-TV data stays local-only),
realtime push (v1 is polling, not websockets), OAuth/social login (email+password only to
start), a merge-conflict UI (resolution is always automatic last-write-wins), and the mobile/
Firestick clients themselves — this covers the sync layer and its desktop integration; those
clients don't exist yet and consume the same API later.

## Architecture

- **Backend**: Cloudflare Workers (API) + D1 (SQLite) for storage + `better-auth` (mounted in
  the Worker, backed by D1) for accounts/sessions. No self-hosted server to patch, no second
  vendor beyond Cloudflare.
- **Client transport**: `wretch` wraps every request; `zod` schemas validate every response at
  runtime, not just at the type level.
- **Shared contract**: a new `packages/sync-schema` package holds the zod schemas (and their
  inferred types) for every sync payload. Both the Worker and `packages/core` import it, so a
  shape change breaks the build on both sides instead of drifting silently.
- **Client-side sync logic lives in `packages/core`**, not `apps/desktop` — per the existing
  "packages/core has zero Electron/React dependency, it's the only part a future Android/
  Firestick app reuses" rule (`CONTEXT.md`). A future mobile client gets sync for free by
  depending on `packages/core` + `packages/sync-schema`; it doesn't reimplement the protocol.

## Portable content identity

Local movie/episode ids are `idFor(source.id, provider_stream_id)`, where `source.id` is a
per-device UUID — two devices pointed at the same Xtream provider produce *different* local ids
for the same movie. Sync needs a device-independent key:

```
remoteKey = sha1(normalizedProviderHost + '|' + provider_stream_id)
```

`normalizedProviderHost` strips scheme/port/trailing-slash variation so the same panel reached
two slightly different ways still collapses to one key. Every syncable row carries `remote_key`
alongside its existing local id, computed once at import time — local ids and FK relationships
are untouched; `remote_key` is purely a sync-layer addition.

## Server-side data model (D1)

`users` / `sessions` are owned and migrated by `better-auth` — not detailed here.

```sql
CREATE TABLE sources (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remote_key        TEXT NOT NULL,        -- sha1(normalizedHost), one row per distinct provider
  label             TEXT NOT NULL,
  credentials_blob  TEXT NOT NULL,        -- AES-GCM ciphertext of {host, username, password} JSON
  credentials_iv    TEXT NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER               -- tombstone; NULL = live
);
CREATE UNIQUE INDEX idx_sources_user_remote ON sources(user_id, remote_key);

-- One shape per syncable local table: movie_favourites, movie_recents, series_favourites,
-- series_recents, playback_progress. All scoped by user_id, keyed by remote_key, carrying a
-- tombstone so deletions propagate on the next pull instead of only additions.
CREATE TABLE movie_favourites (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remote_key  TEXT NOT NULL,
  added_at    INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (user_id, remote_key)
);
-- movie_recents, series_favourites, series_recents: same shape, played_at/added_at as applicable.

CREATE TABLE playback_progress (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remote_key    TEXT NOT NULL,             -- movie or episode, disambiguated by item_type
  item_type     TEXT NOT NULL CHECK (item_type IN ('movie', 'episode')),
  position_secs INTEGER NOT NULL,
  duration_secs INTEGER,
  watched       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  PRIMARY KEY (user_id, remote_key, item_type)
);
```

## Local schema additions (client-side, next `SCHEMA_VERSION` bump)

- `remote_key TEXT` added to `movie_favourites`, `movie_recents`, `series_favourites`,
  `series_recents`, `playback_progress` (populated on write, backfilled once on migration for
  existing rows).
- A new local-only `sync_tombstones (table_name TEXT, remote_key TEXT, deleted_at INTEGER)`
  table. Existing delete paths (unfavourite, etc.) keep their current hard-delete behaviour
  unchanged; the same handler additionally inserts a tombstone row here. The push step reads
  tombstones to tell the server what to soft-delete, then prunes acknowledged ones. This keeps
  today's favourites/recents delete semantics and tests untouched.
- A new local `sync_state (last_pulled_at INTEGER, last_pushed_at INTEGER)` singleton row
  tracking sync cursors.

## Sync protocol

Pull-based polling for v1 — no websockets. Conflict resolution is last-write-wins on
`updated_at`; there is no merge UI, since "which device watched further" or "favourited more
recently" always has one correct answer for this data.

```
GET  /sync/pull?since=<cursor>
     -> { sources[], progress[], favourites[], recents[], serverCursor }
        (rows include deleted_at; a non-null value means "apply as a local delete")

POST /sync/push
     body: SyncPushRequest { sources[], progress[], favourites[], recents[], deletions[] }
     -> upserts by (user_id, remote_key[, item_type]) comparing updated_at,
        applies deletions as tombstones, returns { newCursor }
```

Trigger points: app start, network reconnect, every few minutes while foregrounded, and shortly
after a significant local mutation (favourite toggled, progress checkpoint written) — debounced,
not per-keystroke.

## Auth

`better-auth` mounted at `/auth/*` in the Worker, D1-backed, email+password to start (OAuth
providers can be added later without a schema change). The client stores the resulting session
token; the `wretch` instance attaches it as a bearer header on every sync/API call. Desktop gains
a new "Account" area (sign up / sign in / sign out) — separate from the existing Sources screen,
since an account and a Source are different concepts (one account, many Sources).

## Credential encryption

The client derives an AES-GCM key from the account password via PBKDF2 (Web Crypto API) and a
per-user salt generated at sign-up and stored server-side (the salt isn't secret). The full
Xtream credential payload — host, username, password — is encrypted client-side as one JSON blob
before upload; the Worker/D1 only ever stores ciphertext + IV, never a readable IPTV login. This
extends the existing stance in `CONTEXT.md` that credentials are never stored in the clear, even
locally.

Trade-off, stated explicitly: if the account password is lost with no separate recovery
mechanism, synced source credentials are unrecoverable. That's the intended consequence of real
client-side encryption rather than a gap to patch — a password reset resets account access but
cannot recover the old encryption key.

## API surface (Worker, all bodies/responses zod-validated via `packages/sync-schema`)

- `POST /auth/sign-up`, `POST /auth/sign-in`, `POST /auth/sign-out` — `better-auth` defaults.
- `GET /sync/pull?since=<cursor>` — see protocol above.
- `POST /sync/push` — see protocol above.

## Client integration (`packages/core`)

New `packages/core/src/sync/` module:

```ts
pushLocalChanges(client: SyncClient, cursor: number): Promise<{ newCursor: number }>
pullRemoteChanges(client: SyncClient, cursor: number): Promise<SyncPullResponse>
applyRemoteChanges(db, changes: SyncPullResponse): void   // same diff-and-merge shape as importSource.ts
encryptCredentials(payload, key): { blob: string; iv: string }
decryptCredentials(blob, iv, key): SourceCredentials
```

New `window.testcard.sync.*` IPC namespace mirroring existing namespaces: `status()`,
`triggerNow()`, `signIn()`, `signUp()`, `signOut()`.

## Error handling

- Sync is best-effort and silent by default: a failed pull/push never blocks playback or
  browsing, and just retries on the next trigger — same philosophy as EPG import's
  best-effort Refresh (`CONTEXT.md`).
- On push, the server's `updated_at` comparison always wins ties; the client's next pull then
  overwrites its local row. There is no client-side merge step.
- An expired session surfaces only when the user opens the Account screen or manually triggers
  a sync — a background failed sync logs and waits for the next cycle rather than interrupting.
- Lost account password: synced source credentials are unrecoverable (see Credential encryption
  above); this needs explicit UI copy at password-reset time, exact wording deferred to
  implementation.

## Testing

- `packages/sync-schema`: `schema.parse()` fixture tests for every DTO.
- `packages/core/src/sync`: pure-function tests for the last-write-wins comparator, `remoteKey`
  derivation, and push/pull payload construction — no live network, matching the existing
  "pure-function unit tests, no DB-backed tests" pattern from the Phase 4b spec.
- Worker: `vitest-pool-workers`/Miniflare tests per endpoint — auth required, push/pull
  round-trip, deletion propagation.
- Hardware checklist: sign up on device A, favourite a title + build progress, pull on device B
  and confirm state matches; unfavourite on B, confirm A's next pull removes it; add a Source's
  credentials on A, confirm B decrypts and can use them after pull.

## Carry-overs (explicitly out of scope)

Live-channel/EPG sync, realtime push (websockets), OAuth/social login, a conflict-resolution UI
beyond automatic last-write-wins, the mobile/Firestick clients themselves (this design covers
only the sync layer + its desktop integration), and any billing/payment concerns for a public
release.
