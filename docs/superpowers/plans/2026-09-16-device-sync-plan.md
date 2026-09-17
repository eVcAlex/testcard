# Device Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync VOD progress/watched-state/favourites/recents and Xtream source credentials across a user's devices via an account, so "continue watching" and favourited titles carry over from desktop to a future phone/Firestick client.

**Architecture:** A new Cloudflare Worker (`apps/sync-worker`, Hono + D1 + `better-auth`) exposes `/auth/*`, `/sync/pull`, `/sync/push`. Every payload crossing that boundary is defined once as a zod schema in a new shared package (`packages/sync-schema`) imported by both the Worker and the client. `packages/core` gains a `sync/` module (portable content-identity hashing, client-side AES-GCM credential encryption, a `wretch`-based `SyncClient`, and local-change collection/application) — framework-free, so a future mobile client reuses it unchanged. `apps/desktop` wires this behind a new `sync.*` IPC namespace and an Account screen, and stamps `remote_key`/`updated_at` onto every syncable row at the point each is already written (catalog import, favourite toggle, progress checkpoint) rather than backfilling separately.

**Tech Stack:** TypeScript, Cloudflare Workers + D1 (SQLite) + Hono + `better-auth`, `wretch`, `zod`, `better-sqlite3` (client), Electron, `vitest` + `@cloudflare/vitest-pool-workers`.

**Spec:** docs/superpowers/specs/2026-09-16-device-sync-design.md

## Global Constraints

- **Depends on Phase 4b being merged first** (docs/superpowers/plans/2026-09-14-vod-series-plan.md) — that plan lands `SCHEMA_VERSION` 4 with `movies`, `series`, `episodes`, `movie_favourites`, `movie_recents`, `series_favourites`, `series_recents`, `playback_progress`. This plan bumps `SCHEMA_VERSION` 4 → 5. If Task 1 of that plan produced schema text that differs from what's quoted here, adapt Task 2's edits to match the actual merged text — the *columns added* are what matters, not exact surrounding whitespace.
- VOD-only — no live-channel/EPG data is synced (see spec "Scope").
- Conflict resolution is last-write-wins by `updated_at`, polling-only sync (no websockets) — see spec "Sync protocol".
- Xtream credentials are encrypted client-side (AES-GCM, PBKDF2-derived key from the account password) before upload; the Worker/D1 never stores plaintext (see spec "Credential encryption"). M3U sources carry no login credential and are out of scope for sync.
- Every payload crossing the client↔Worker boundary is validated by a `packages/sync-schema` zod schema on both ends, not just typed.
- `packages/core` stays framework-free (no Electron/DOM-only APIs) — sync client logic lives there, not in `apps/desktop`, so a future mobile/Firestick client reuses it unchanged (see spec "Architecture").
- Follow this codebase's established conventions: the existing `hasColumn`/`addColumn` helpers in `packages/core/src/db/migrations.ts` for `ALTER TABLE`, prepared-statement + `db.transaction()` for multi-row writes, readonly interfaces, no `any` outside narrow JSON-parsing boundaries, JSDoc explaining *why* not *what*.
- No DB-backed unit tests in `packages/core` (ADR 0003/0005 — `better-sqlite3`'s native binding is Electron's ABI). DB-touching sync code is verified via the Task 16 hardware checklist; only pure functions get unit tests.
- Source *removal* does not propagate across devices in this plan (see Task 13's `applyRemoteChanges`) — only add/update does. A tombstone-based removal sync (mirroring Task 6's favourite tombstones) is a reasonable follow-up, not included here.

---

## Task 1: `packages/sync-schema` — shared zod contract

**Files:**
- Create: `packages/sync-schema/package.json`
- Create: `packages/sync-schema/tsconfig.json`
- Create: `packages/sync-schema/src/index.ts`
- Test: `packages/sync-schema/src/index.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `SourceCredentialsPayloadSchema`/`SourceCredentialsPayload`, `SyncSourceSchema`/`SyncSource`, `SyncFavouriteSchema`/`SyncFavourite`, `SyncRecentSchema`/`SyncRecent`, `SyncProgressSchema`/`SyncProgress`, `SyncPullResponseSchema`/`SyncPullResponse`, `SyncPushRequestSchema`/`SyncPushRequest`, `SyncPushResponseSchema`/`SyncPushResponse` — imported by every later task in both `apps/sync-worker` and `packages/core`.

- [ ] **Step 1: Write `packages/sync-schema/package.json`**

```json
{
  "name": "@testcard/sync-schema",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Write `packages/sync-schema/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `packages/sync-schema/src/index.ts`**

```ts
import { z } from "zod";

/**
 * An Xtream login as it exists client-side, before encryption. Never crosses the wire in this
 * shape — see `SyncSourceSchema`, which carries only its ciphertext.
 */
export const SourceCredentialsPayloadSchema = z.object({
  host: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});
export type SourceCredentialsPayload = z.infer<typeof SourceCredentialsPayloadSchema>;

/**
 * One syncable row shape, reused for every table: identified by `remoteKey` (device-independent,
 * see `packages/core/src/sync/remoteKey.ts`), timestamped for last-write-wins, and soft-deleted
 * via `deletedAt` so removals propagate instead of only additions (see design spec "Sync
 * protocol").
 */
const SyncedRowSchema = z.object({
  remoteKey: z.string().min(1),
  updatedAt: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().nullable(),
});

export const SyncSourceSchema = SyncedRowSchema.extend({
  label: z.string().min(1),
  /** AES-GCM ciphertext (base64) of a `SourceCredentialsPayload`. The server never sees plaintext. */
  credentialsBlob: z.string().min(1),
  /** AES-GCM IV (base64), one per encryption. */
  credentialsIv: z.string().min(1),
});
export type SyncSource = z.infer<typeof SyncSourceSchema>;

export const SyncFavouriteSchema = SyncedRowSchema.extend({
  addedAt: z.number().int().nonnegative(),
});
export type SyncFavourite = z.infer<typeof SyncFavouriteSchema>;

export const SyncRecentSchema = SyncedRowSchema.extend({
  playedAt: z.number().int().nonnegative(),
});
export type SyncRecent = z.infer<typeof SyncRecentSchema>;

export const SyncProgressSchema = SyncedRowSchema.extend({
  itemType: z.enum(["movie", "episode"]),
  positionSecs: z.number().int().nonnegative(),
  durationSecs: z.number().int().positive().nullable(),
  watched: z.boolean(),
});
export type SyncProgress = z.infer<typeof SyncProgressSchema>;

export const SyncPullResponseSchema = z.object({
  sources: z.array(SyncSourceSchema),
  movieFavourites: z.array(SyncFavouriteSchema),
  movieRecents: z.array(SyncRecentSchema),
  seriesFavourites: z.array(SyncFavouriteSchema),
  seriesRecents: z.array(SyncRecentSchema),
  progress: z.array(SyncProgressSchema),
  serverCursor: z.number().int().nonnegative(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;

export const SyncPushRequestSchema = z.object({
  sources: z.array(SyncSourceSchema),
  movieFavourites: z.array(SyncFavouriteSchema),
  movieRecents: z.array(SyncRecentSchema),
  seriesFavourites: z.array(SyncFavouriteSchema),
  seriesRecents: z.array(SyncRecentSchema),
  progress: z.array(SyncProgressSchema),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

export const SyncPushResponseSchema = z.object({
  newCursor: z.number().int().nonnegative(),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;
```

- [ ] **Step 4: Write `packages/sync-schema/src/index.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { SyncPullResponseSchema, SyncPushRequestSchema, SyncSourceSchema } from "./index.js";

describe("SyncSourceSchema", () => {
  it("accepts a fully-populated source row", () => {
    const parsed = SyncSourceSchema.parse({
      remoteKey: "abc123",
      label: "My Provider",
      credentialsBlob: "base64ciphertext",
      credentialsIv: "base64iv",
      updatedAt: 1_700_000_000_000,
      deletedAt: null,
    });
    expect(parsed.label).toBe("My Provider");
  });

  it("rejects a row missing credentialsIv", () => {
    expect(() =>
      SyncSourceSchema.parse({
        remoteKey: "abc123",
        label: "My Provider",
        credentialsBlob: "base64ciphertext",
        updatedAt: 1_700_000_000_000,
        deletedAt: null,
      }),
    ).toThrow();
  });
});

describe("SyncPullResponseSchema", () => {
  it("accepts an empty-but-well-formed response", () => {
    const parsed = SyncPullResponseSchema.parse({
      sources: [],
      movieFavourites: [],
      movieRecents: [],
      seriesFavourites: [],
      seriesRecents: [],
      progress: [],
      serverCursor: 1_700_000_000_000,
    });
    expect(parsed.serverCursor).toBe(1_700_000_000_000);
  });
});

describe("SyncPushRequestSchema", () => {
  it("accepts a progress row with a null duration (unknown length)", () => {
    const parsed = SyncPushRequestSchema.parse({
      sources: [],
      movieFavourites: [],
      movieRecents: [],
      seriesFavourites: [],
      seriesRecents: [],
      progress: [
        {
          remoteKey: "movie:xyz",
          itemType: "movie",
          positionSecs: 120,
          durationSecs: null,
          watched: false,
          updatedAt: 1_700_000_000_000,
          deletedAt: null,
        },
      ],
    });
    expect(parsed.progress[0]?.itemType).toBe("movie");
  });
});
```

- [ ] **Step 5: Install and run tests**

```bash
pnpm install
pnpm --filter @testcard/sync-schema test
```

Expected: 3 test files... 3 tests, all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sync-schema
git commit -m "Add @testcard/sync-schema: shared zod contract for device sync"
```

## Task 2: Local schema — `SCHEMA_VERSION` 4 → 5

**Files:**
- Modify: `packages/core/src/db/schema.ts`
- Modify: `packages/core/src/db/migrations.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `remote_key` on `movies`, `episodes`, `series`, `sources`; `remote_key`/`updated_at` on `movie_favourites`, `movie_recents`, `series_favourites`, `series_recents`; `remote_key`/`deleted_at` on `playback_progress`; new `sync_tombstones` and `sync_state` tables. `SCHEMA_VERSION = 5`.

- [ ] **Step 1: Bump `SCHEMA_VERSION`**

In `packages/core/src/db/schema.ts`:

```ts
export const SCHEMA_VERSION = 5;
```

- [ ] **Step 2: Add `remote_key`/sync columns to `sources`** — find the `sources` table block:

```sql
CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('xtream', 'm3u')),
  name          TEXT NOT NULL,
  base_url      TEXT,           -- xtream only
  playlist_url  TEXT,           -- m3u only
  epg_url       TEXT,           -- explicit XMLTV URL, either kind, optional
  refresh_interval_hours INTEGER, -- NULL = manual refresh only
  created_at    INTEGER NOT NULL,
  last_refreshed_at INTEGER
);
```

Replace with:

```sql
CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('xtream', 'm3u')),
  name          TEXT NOT NULL,
  base_url      TEXT,           -- xtream only
  playlist_url  TEXT,           -- m3u only
  epg_url       TEXT,           -- explicit XMLTV URL, either kind, optional
  refresh_interval_hours INTEGER, -- NULL = manual refresh only
  created_at    INTEGER NOT NULL,
  last_refreshed_at INTEGER,
  remote_key    TEXT,           -- sha1(normalizedHost) — xtream only, see sync/remoteKey.ts
  sync_updated_at INTEGER,      -- sync clock; NULL until first pushed
  sync_deleted_at INTEGER       -- sync tombstone; NULL = live
);
CREATE INDEX IF NOT EXISTS idx_sources_remote_key ON sources(remote_key);
```

(Named `sync_updated_at`/`sync_deleted_at` rather than `updated_at`/`deleted_at` — `sources` already has domain columns like `last_refreshed_at` with their own meaning, so the sync-clock columns get an unambiguous prefix here specifically.)

- [ ] **Step 3: Add `remote_key` to the Phase 4b catalog tables** — find the `movies` table block:

```sql
CREATE TABLE IF NOT EXISTS movies (
  id                  TEXT PRIMARY KEY,   -- idFor(source.id, vod stream_id)
  source_id           TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  category_id         TEXT NOT NULL REFERENCES movie_categories(id) ON DELETE CASCADE,
  provider_stream_id  TEXT NOT NULL,
  name                TEXT NOT NULL,
  poster_url          TEXT,
  container_extension TEXT,
  rating              TEXT,
  plot                TEXT,
  duration_secs       INTEGER,
  details_fetched_at  INTEGER,
  first_seen_at       INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movies_category ON movies(category_id);
```

Replace with:

```sql
CREATE TABLE IF NOT EXISTS movies (
  id                  TEXT PRIMARY KEY,   -- idFor(source.id, vod stream_id)
  source_id           TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  category_id         TEXT NOT NULL REFERENCES movie_categories(id) ON DELETE CASCADE,
  provider_stream_id  TEXT NOT NULL,
  name                TEXT NOT NULL,
  poster_url          TEXT,
  container_extension TEXT,
  rating              TEXT,
  plot                TEXT,
  duration_secs       INTEGER,
  details_fetched_at  INTEGER,
  first_seen_at       INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL,
  remote_key          TEXT   -- sha1(normalizedHost + providerStreamId), see sync/remoteKey.ts
);
CREATE INDEX IF NOT EXISTS idx_movies_category ON movies(category_id);
CREATE INDEX IF NOT EXISTS idx_movies_remote_key ON movies(remote_key);
```

Find the `series` table block:

```sql
CREATE TABLE IF NOT EXISTS series (
  id                   TEXT PRIMARY KEY,  -- idFor(source.id, series_id)
  source_id            TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  category_id          TEXT NOT NULL REFERENCES series_categories(id) ON DELETE CASCADE,
  provider_series_id   TEXT NOT NULL,
  name                 TEXT NOT NULL,
  poster_url           TEXT,
  rating               TEXT,
  plot                 TEXT,
  episodes_fetched_at  INTEGER,
  first_seen_at        INTEGER NOT NULL,
  last_seen_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_series_category ON series(category_id);
```

Replace with:

```sql
CREATE TABLE IF NOT EXISTS series (
  id                   TEXT PRIMARY KEY,  -- idFor(source.id, series_id)
  source_id            TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  category_id          TEXT NOT NULL REFERENCES series_categories(id) ON DELETE CASCADE,
  provider_series_id   TEXT NOT NULL,
  name                 TEXT NOT NULL,
  poster_url           TEXT,
  rating               TEXT,
  plot                 TEXT,
  episodes_fetched_at  INTEGER,
  first_seen_at        INTEGER NOT NULL,
  last_seen_at         INTEGER NOT NULL,
  remote_key           TEXT   -- sha1(normalizedHost + providerSeriesId), see sync/remoteKey.ts
);
CREATE INDEX IF NOT EXISTS idx_series_category ON series(category_id);
CREATE INDEX IF NOT EXISTS idx_series_remote_key ON series(remote_key);
```

Find the `episodes` table block:

```sql
CREATE TABLE IF NOT EXISTS episodes (
  id                   TEXT PRIMARY KEY,  -- idFor(season.id, provider episode id)
  season_id            TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  series_id            TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  provider_episode_id  TEXT NOT NULL,
  episode_number       INTEGER NOT NULL,
  name                 TEXT NOT NULL,
  container_extension  TEXT,
  duration_secs        INTEGER,
  plot                 TEXT
);
CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id);
```

Replace with:

```sql
CREATE TABLE IF NOT EXISTS episodes (
  id                   TEXT PRIMARY KEY,  -- idFor(season.id, provider episode id)
  season_id            TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  series_id            TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  provider_episode_id  TEXT NOT NULL,
  episode_number       INTEGER NOT NULL,
  name                 TEXT NOT NULL,
  container_extension  TEXT,
  duration_secs        INTEGER,
  plot                 TEXT,
  remote_key           TEXT   -- sha1(normalizedHost + providerEpisodeId), see sync/remoteKey.ts
);
CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id);
CREATE INDEX IF NOT EXISTS idx_episodes_remote_key ON episodes(remote_key);
```

- [ ] **Step 4: Add sync columns to favourites/recents/progress and two new tables** — find the block (immediately before `schema_meta`):

```sql
CREATE TABLE IF NOT EXISTS movie_favourites (movie_id TEXT PRIMARY KEY, added_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS movie_recents (movie_id TEXT PRIMARY KEY, played_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_movie_recents_played_at ON movie_recents(played_at DESC);

CREATE TABLE IF NOT EXISTS series_favourites (series_id TEXT PRIMARY KEY, added_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS series_recents (series_id TEXT PRIMARY KEY, played_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_series_recents_played_at ON series_recents(played_at DESC);

CREATE TABLE IF NOT EXISTS playback_progress (
  item_type     TEXT NOT NULL CHECK (item_type IN ('movie', 'episode')),
  item_id       TEXT NOT NULL,
  position_secs INTEGER NOT NULL,
  duration_secs INTEGER,
  watched       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (item_type, item_id)
);
```

Replace with:

```sql
CREATE TABLE IF NOT EXISTS movie_favourites (
  movie_id    TEXT PRIMARY KEY,
  added_at    INTEGER NOT NULL,
  remote_key  TEXT,
  updated_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_movie_favourites_remote_key ON movie_favourites(remote_key);

CREATE TABLE IF NOT EXISTS movie_recents (
  movie_id    TEXT PRIMARY KEY,
  played_at   INTEGER NOT NULL,
  remote_key  TEXT,
  updated_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_movie_recents_played_at ON movie_recents(played_at DESC);
CREATE INDEX IF NOT EXISTS idx_movie_recents_remote_key ON movie_recents(remote_key);

CREATE TABLE IF NOT EXISTS series_favourites (
  series_id   TEXT PRIMARY KEY,
  added_at    INTEGER NOT NULL,
  remote_key  TEXT,
  updated_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_series_favourites_remote_key ON series_favourites(remote_key);

CREATE TABLE IF NOT EXISTS series_recents (
  series_id   TEXT PRIMARY KEY,
  played_at   INTEGER NOT NULL,
  remote_key  TEXT,
  updated_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_series_recents_played_at ON series_recents(played_at DESC);
CREATE INDEX IF NOT EXISTS idx_series_recents_remote_key ON series_recents(remote_key);

CREATE TABLE IF NOT EXISTS playback_progress (
  item_type     TEXT NOT NULL CHECK (item_type IN ('movie', 'episode')),
  item_id       TEXT NOT NULL,
  position_secs INTEGER NOT NULL,
  duration_secs INTEGER,
  watched       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  remote_key    TEXT,
  deleted_at    INTEGER,
  PRIMARY KEY (item_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_playback_progress_remote_key ON playback_progress(remote_key);

-- Local-only record of a delete the sync push step still needs to tell the server about.
-- Existing delete paths (unfavourite, source removal) keep their current hard-delete behaviour
-- unchanged; they additionally insert a row here. Pruned once the push that reported it succeeds.
CREATE TABLE IF NOT EXISTS sync_tombstones (
  table_name  TEXT NOT NULL,
  remote_key  TEXT NOT NULL,
  deleted_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_tombstones_table ON sync_tombstones(table_name);

-- Singleton row (id always 1) tracking this device's sync cursors.
CREATE TABLE IF NOT EXISTS sync_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_pulled_at  INTEGER NOT NULL DEFAULT 0,
  last_pushed_at  INTEGER NOT NULL DEFAULT 0,
  account_email   TEXT,      -- NULL = signed out
  session_token   TEXT,
  sync_salt       TEXT       -- base64 PBKDF2 salt; not secret, safe to persist (see Task 9)
);
```

- [ ] **Step 5: Append the version-5 migration** in `packages/core/src/db/migrations.ts`, after the `version: 4` entry:

```ts
  {
    version: 5,
    up: (db) => {
      // Device sync — remote_key/sync-clock columns added to every syncable table so the sync
      // client can find "what changed since the last cursor" without a full-table diff. See the
      // design spec's "Local schema additions".
      addColumn(db, "sources", "remote_key TEXT");
      addColumn(db, "sources", "sync_updated_at INTEGER");
      addColumn(db, "sources", "sync_deleted_at INTEGER");
      addColumn(db, "movies", "remote_key TEXT");
      addColumn(db, "series", "remote_key TEXT");
      addColumn(db, "episodes", "remote_key TEXT");

      for (const table of ["movie_favourites", "movie_recents", "series_favourites", "series_recents"] as const) {
        addColumn(db, table, "remote_key TEXT");
        addColumn(db, table, "updated_at INTEGER");
      }
      addColumn(db, "playback_progress", "remote_key TEXT");
      addColumn(db, "playback_progress", "deleted_at INTEGER");

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sources_remote_key ON sources(remote_key);
        CREATE INDEX IF NOT EXISTS idx_movies_remote_key ON movies(remote_key);
        CREATE INDEX IF NOT EXISTS idx_series_remote_key ON series(remote_key);
        CREATE INDEX IF NOT EXISTS idx_episodes_remote_key ON episodes(remote_key);
        CREATE INDEX IF NOT EXISTS idx_movie_favourites_remote_key ON movie_favourites(remote_key);
        CREATE INDEX IF NOT EXISTS idx_movie_recents_remote_key ON movie_recents(remote_key);
        CREATE INDEX IF NOT EXISTS idx_series_favourites_remote_key ON series_favourites(remote_key);
        CREATE INDEX IF NOT EXISTS idx_series_recents_remote_key ON series_recents(remote_key);
        CREATE INDEX IF NOT EXISTS idx_playback_progress_remote_key ON playback_progress(remote_key);

        CREATE TABLE IF NOT EXISTS sync_tombstones (
          table_name  TEXT NOT NULL,
          remote_key  TEXT NOT NULL,
          deleted_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sync_tombstones_table ON sync_tombstones(table_name);

        CREATE TABLE IF NOT EXISTS sync_state (
          id              INTEGER PRIMARY KEY CHECK (id = 1),
          last_pulled_at  INTEGER NOT NULL DEFAULT 0,
          last_pushed_at  INTEGER NOT NULL DEFAULT 0,
          account_email   TEXT,
          session_token   TEXT,
          sync_salt       TEXT
        );
      `);
    },
  },
```

- [ ] **Step 6: Verify the migration test needs no change** — same reasoning as the Phase 4b plan's Task 1 Step 3: appending a contiguous `version: 5` entry and bumping `SCHEMA_VERSION` to `5` satisfies `migrations.test.ts`'s contiguity assertion automatically. Run `pnpm --filter @testcard/core test` to confirm; make no edit to that test file.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/db/migrations.ts
git commit -m "Add device-sync schema: remote_key/sync-clock columns, sync_tombstones, sync_state"
```

## Task 3: `packages/core/src/sync/remoteKey.ts` — portable content identity

**Files:**
- Create: `packages/core/src/sync/remoteKey.ts`
- Test: `packages/core/src/__tests__/remoteKey.test.ts`

**Interfaces:**
- Consumes: nothing new (Web Crypto's `globalThis.crypto.subtle`, available in Node 20+, Electron's main process, and Cloudflare Workers alike — the reason this is safe to put in framework-free `packages/core`)
- Produces: `normalizeProviderHost(rawHost: string): string`, `remoteKeyFor(providerHost: string, providerId: string): Promise<string>` — consumed by Tasks 4–6.

- [ ] **Step 1: Write `packages/core/src/sync/remoteKey.ts`**

```ts
/**
 * Two devices pointed at the same Xtream provider assign different *local* ids to the same
 * movie (`idFor(source.id, stream_id)` — `source.id` is a per-device UUID). Sync needs a
 * device-independent key instead: a hash of the provider's own host + its own stream/series/
 * episode id, which is the same on every device that points at that provider. See the design
 * spec's "Portable content identity".
 */

/** Strips scheme/port/trailing-slash noise so the same panel reached two ways still collapses. */
export function normalizeProviderHost(rawHost: string): string {
  const withScheme = rawHost.includes("://") ? rawHost : `http://${rawHost}`;
  const url = new URL(withScheme);
  const isDefaultPort = url.port === "" || url.port === "80" || url.port === "443";
  return `${url.hostname.toLowerCase()}${isDefaultPort ? "" : `:${url.port}`}`;
}

/** `sha1(normalizedHost + '|' + providerId)`, hex-encoded. */
export async function remoteKeyFor(providerHost: string, providerId: string): Promise<string> {
  const data = new TextEncoder().encode(`${normalizeProviderHost(providerHost)}|${providerId}`);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
```

- [ ] **Step 2: Write `packages/core/src/__tests__/remoteKey.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { normalizeProviderHost, remoteKeyFor } from "../sync/remoteKey.js";

describe("normalizeProviderHost", () => {
  it("strips scheme, default port, and case", () => {
    expect(normalizeProviderHost("http://Example.com:80")).toBe("example.com");
    expect(normalizeProviderHost("https://Example.com:443")).toBe("example.com");
  });

  it("keeps a non-default port", () => {
    expect(normalizeProviderHost("http://example.com:8080")).toBe("example.com:8080");
  });

  it("treats a bare host (no scheme) the same as an http:// one", () => {
    expect(normalizeProviderHost("example.com")).toBe(normalizeProviderHost("http://example.com"));
  });
});

describe("remoteKeyFor", () => {
  it("is stable for the same host+id regardless of how the host was spelled", () => {
    const a = remoteKeyFor("http://example.com:80", "501");
    const b = remoteKeyFor("EXAMPLE.com", "501");
    return Promise.all([a, b]).then(([keyA, keyB]) => {
      expect(keyA).toBe(keyB);
      expect(keyA).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  it("differs for a different provider id", async () => {
    const a = await remoteKeyFor("example.com", "501");
    const b = await remoteKeyFor("example.com", "502");
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @testcard/core test -- remoteKey
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/sync/remoteKey.ts packages/core/src/__tests__/remoteKey.test.ts
git commit -m "Add remoteKeyFor: device-independent content identity for sync"
```

## Task 4: Stamp `remote_key` onto movies/series/episodes at import time

**Files:**
- Modify: `packages/core/src/db/importVod.ts`
- Modify: `packages/core/src/db/importSeries.ts`
- Modify: `packages/core/src/db/importVodDetails.ts`

**Interfaces:**
- Consumes: `remoteKeyFor` (Task 3)
- Produces: every `movies`/`series`/`episodes` row now carries a populated `remote_key`, read synchronously by Task 6's favourite/recent/progress writers.

- [ ] **Step 1: Stamp movies** — in `packages/core/src/db/importVod.ts`, the upsert loop currently does `upsertMovie.run({...})` per movie inside the `db.transaction()` callback. Compute each movie's `remote_key` *before* entering the transaction (remote-key hashing is async; `better-sqlite3` transactions must be synchronous), then pass it through:

Change the page-draining loop to also compute remote keys:

```ts
  const pages: { category: Category; movies: readonly Movie[] }[] = [];
  for (const category of categories) {
    pages.push({ category, movies: await fetchMovies(source, category, getCredentials) });
  }

  const providerHost = source.kind === "xtream" ? source.baseUrl : "";
  const remoteKeys = new Map<string, string>();
  for (const page of pages) {
    for (const movie of page.movies) {
      remoteKeys.set(movie.id, await remoteKeyFor(providerHost, movie.providerStreamId));
    }
  }
```

Add the import at the top of the file:

```ts
import { remoteKeyFor } from "../sync/remoteKey.js";
```

Update `upsertMovie`'s SQL to write it and read it back out of `remoteKeys` when running:

```ts
  const upsertMovie = db.prepare(`
    INSERT INTO movies (
      id, source_id, category_id, provider_stream_id, name, poster_url,
      container_extension, rating, first_seen_at, last_seen_at, remote_key
    ) VALUES (
      @id, @sourceId, @categoryId, @providerStreamId, @name, @posterUrl,
      @containerExtension, @rating, @firstSeenAt, @lastSeenAt, @remoteKey
    )
    ON CONFLICT(id) DO UPDATE SET
      category_id          = excluded.category_id,
      provider_stream_id   = excluded.provider_stream_id,
      name                 = excluded.name,
      poster_url           = excluded.poster_url,
      container_extension  = excluded.container_extension,
      rating                = excluded.rating,
      details_fetched_at   = NULL,
      last_seen_at         = excluded.last_seen_at,
      remote_key            = excluded.remote_key
  `);
```

And in the transaction body, pass `remoteKey: remoteKeys.get(movie.id)` alongside the existing params.

- [ ] **Step 2: Stamp series** — apply the identical pattern to `packages/core/src/db/importSeries.ts`: compute `remoteKeyFor(providerHost, series.providerSeriesId)` for each series before the transaction, add `remote_key` to `upsertSeries`'s column list/`ON CONFLICT` clause, and pass it through.

- [ ] **Step 3: Stamp episodes** — in `packages/core/src/db/importVodDetails.ts`'s `ensureSeriesEpisodes`, after `fetchSeriesDetails` returns `{ seasons, episodes }` and before the `db.transaction()` call, compute each episode's key:

```ts
  const providerHost = source.kind === "xtream" ? source.baseUrl : "";
  const episodeRemoteKeys = new Map<string, string>();
  for (const episode of episodes) {
    episodeRemoteKeys.set(episode.id, await remoteKeyFor(providerHost, episode.providerEpisodeId));
  }
```

Add the import (`import { remoteKeyFor } from "../sync/remoteKey.js";`) and update `insertEpisode`'s SQL/bind call to include `remote_key`:

```ts
  const insertEpisode = db.prepare(`
    INSERT INTO episodes (id, season_id, series_id, provider_episode_id, episode_number, name, container_extension, duration_secs, plot, remote_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
```

```ts
    for (const episode of episodes) {
      insertEpisode.run(
        episode.id,
        episode.seasonId,
        episode.seriesId,
        episode.providerEpisodeId,
        episode.episodeNumber,
        episode.name,
        episode.containerExtension ?? null,
        episode.durationSecs ?? null,
        episode.plot ?? null,
        episodeRemoteKeys.get(episode.id) ?? null,
      );
    }
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/db/importVod.ts packages/core/src/db/importSeries.ts packages/core/src/db/importVodDetails.ts
git commit -m "Stamp remote_key onto movies/series/episodes at import time"
```

## Task 5: Stamp `remote_key` onto Xtream sources

**Files:**
- Modify: `apps/desktop/src/main/ipc.ts`

**Interfaces:**
- Consumes: `remoteKeyFor` (Task 3)
- Produces: every Xtream `sources` row carries a populated `remote_key`, read by Task 13's local-change collector.

- [ ] **Step 1: Add the import** to `apps/desktop/src/main/ipc.ts`:

```ts
import { remoteKeyFor } from "@testcard/core";
```

(This requires `remoteKeyFor` to be re-exported from `packages/core/src/index.ts` — add `export { remoteKeyFor, normalizeProviderHost } from "./sync/remoteKey.js";` there if it isn't already exported.)

- [ ] **Step 2: Stamp on add** — the xtream branch of `sources.add` currently does:

```ts
          await saveCredentials(id, verified.credentials);
          db.prepare(
            `INSERT INTO sources (id, kind, name, base_url, epg_url, refresh_interval_hours, created_at)
             VALUES (?, 'xtream', ?, ?, ?, ?, ?)`,
          ).run(id, name, verified.credentials.baseUrl, epg !== "" ? epg : null, interval, Date.now());
```

Replace with:

```ts
          await saveCredentials(id, verified.credentials);
          const remoteKey = await remoteKeyFor(verified.credentials.baseUrl, "source");
          db.prepare(
            `INSERT INTO sources (id, kind, name, base_url, epg_url, refresh_interval_hours, created_at, remote_key, sync_updated_at)
             VALUES (?, 'xtream', ?, ?, ?, ?, ?, ?, ?)`,
          ).run(id, name, verified.credentials.baseUrl, epg !== "" ? epg : null, interval, Date.now(), remoteKey, Date.now());
```

(`"source"` is a constant discriminator, not a provider stream id — a Source's remote key only needs to identify *the provider*, not a piece of content on it, so there's nothing else to hash in.)

- [ ] **Step 3: Stamp on update** — the xtream branch of `sources.update` currently does:

```ts
        db.prepare(`UPDATE sources SET name = ?, base_url = ?, epg_url = ?, refresh_interval_hours = ? WHERE id = ?`).run(
          name,
          credentials.baseUrl,
          epg,
```

Replace with:

```ts
        const remoteKey = await remoteKeyFor(credentials.baseUrl, "source");
        db.prepare(`UPDATE sources SET name = ?, base_url = ?, epg_url = ?, refresh_interval_hours = ?, remote_key = ?, sync_updated_at = ? WHERE id = ?`).run(
          name,
          credentials.baseUrl,
          epg,
```

(Adjust the trailing bound-parameter list a few lines below to add `remoteKey, Date.now()` before `sourceId`.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/ipc.ts packages/core/src/index.ts
git commit -m "Stamp remote_key onto Xtream sources on add/update"
```

## Task 6: Stamp `remote_key`/`updated_at` onto favourite/recent/progress writes

**Files:**
- Modify: `packages/core/src/db/vodQueries.ts`
- Modify: `packages/core/src/db/seriesQueries.ts`
- Modify: `packages/core/src/db/progressQueries.ts`

**Interfaces:**
- Consumes: `movies.remote_key` / `series.remote_key` (Task 4, already stored — no async call needed here, just an indexed `SELECT`)
- Produces: `toggleMovieFavourite`, `recordMovieRecent`, `toggleSeriesFavourite`, `recordSeriesRecent`, `setPlaybackProgress` all now write `remote_key` + `updated_at`; un-favouriting writes a `sync_tombstones` row. Signatures are unchanged (still synchronous) — read below for why.

Since `movies.remote_key`/`series.remote_key` are already populated by import time (Task 4), copying one into a favourite/recent/progress row is a plain indexed `SELECT` — no `await remoteKeyFor(...)` needed here, so these functions stay synchronous and every existing caller (Phase 4b's IPC handlers) needs no signature change.

- [ ] **Step 1: `packages/core/src/db/vodQueries.ts`** — `toggleMovieFavourite` currently:

```ts
export function toggleMovieFavourite(db: Database.Database, movieId: string): boolean {
  const existing = db.prepare(`SELECT 1 FROM movie_favourites WHERE movie_id = ?`).get(movieId);
  if (existing) {
    db.prepare(`DELETE FROM movie_favourites WHERE movie_id = ?`).run(movieId);
    return false;
  }
  db.prepare(`INSERT INTO movie_favourites (movie_id, added_at) VALUES (?, ?)`).run(movieId, Date.now());
  return true;
}
```

Replace with:

```ts
export function toggleMovieFavourite(db: Database.Database, movieId: string): boolean {
  const existing = db.prepare(`SELECT 1 FROM movie_favourites WHERE movie_id = ?`).get(movieId);
  if (existing) {
    const row = db.prepare(`SELECT remote_key FROM movie_favourites WHERE movie_id = ?`).get(movieId) as { remote_key: string | null };
    db.prepare(`DELETE FROM movie_favourites WHERE movie_id = ?`).run(movieId);
    if (row.remote_key !== null) {
      db.prepare(`INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) VALUES ('movie_favourites', ?, ?)`).run(row.remote_key, Date.now());
    }
    return false;
  }
  const movie = db.prepare(`SELECT remote_key FROM movies WHERE id = ?`).get(movieId) as { remote_key: string | null } | undefined;
  db.prepare(`INSERT INTO movie_favourites (movie_id, added_at, remote_key, updated_at) VALUES (?, ?, ?, ?)`).run(
    movieId,
    Date.now(),
    movie?.remote_key ?? null,
    Date.now(),
  );
  return true;
}
```

And `recordMovieRecent`:

```ts
export function recordMovieRecent(db: Database.Database, movieId: string): void {
  const movie = db.prepare(`SELECT remote_key FROM movies WHERE id = ?`).get(movieId) as { remote_key: string | null } | undefined;
  db.prepare(
    `INSERT INTO movie_recents (movie_id, played_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(movie_id) DO UPDATE SET played_at = excluded.played_at, remote_key = excluded.remote_key, updated_at = excluded.updated_at`,
  ).run(movieId, Date.now(), movie?.remote_key ?? null, Date.now());
}
```

- [ ] **Step 2: `packages/core/src/db/seriesQueries.ts`** — apply the identical pattern to `toggleSeriesFavourite`/`recordSeriesRecent`, substituting `series_favourites`/`series_recents`/`series_id`/`series`.

- [ ] **Step 3: `packages/core/src/db/progressQueries.ts`** — `setPlaybackProgress` currently upserts by `(item_type, item_id)`. It needs the owning movie's or episode's `remote_key`:

```ts
export function setPlaybackProgress(
  db: Database.Database,
  itemType: "movie" | "episode",
  itemId: string,
  positionSecs: number,
  durationSecs: number | null,
): void {
  const table = itemType === "movie" ? "movies" : "episodes";
  const item = db.prepare(`SELECT remote_key FROM ${table} WHERE id = ?`).get(itemId) as { remote_key: string | null } | undefined;
  const watched = isWatched(positionSecs, durationSecs);
  db.prepare(
    `INSERT INTO playback_progress (item_type, item_id, position_secs, duration_secs, watched, updated_at, remote_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_type, item_id) DO UPDATE SET
       position_secs = excluded.position_secs, duration_secs = excluded.duration_secs,
       watched = excluded.watched, updated_at = excluded.updated_at, remote_key = excluded.remote_key`,
  ).run(itemType, itemId, positionSecs, durationSecs, watched ? 1 : 0, Date.now(), item?.remote_key ?? null);
}
```

(`table` is restricted to the `"movies" | "episodes"` literal union already in `itemType`'s type, not external input — safe to interpolate.)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/db/vodQueries.ts packages/core/src/db/seriesQueries.ts packages/core/src/db/progressQueries.ts
git commit -m "Stamp remote_key/updated_at on favourite/recent/progress writes; tombstone on unfavourite"
```

## Task 7: `packages/core/src/sync/credentialCrypto.ts` — client-side credential encryption

**Files:**
- Create: `packages/core/src/sync/credentialCrypto.ts`
- Test: `packages/core/src/__tests__/credentialCrypto.test.ts`

**Interfaces:**
- Consumes: `SourceCredentialsPayload`/`SourceCredentialsPayloadSchema` (Task 1)
- Produces: `EncryptedPayload`, `generateSalt(): string`, `encryptCredentials(payload, password, saltBase64): Promise<EncryptedPayload>`, `decryptCredentials(encrypted, password, saltBase64): Promise<SourceCredentialsPayload>` — consumed by Task 13.

- [ ] **Step 1: Write `packages/core/src/sync/credentialCrypto.ts`**

```ts
import { SourceCredentialsPayloadSchema, type SourceCredentialsPayload } from "@testcard/sync-schema";

/**
 * Client-side AES-GCM encryption of Xtream credentials, keyed by the account password (never
 * the account password itself, and never sent anywhere) — the Worker/D1 only ever stores
 * ciphertext. See the design spec's "Credential encryption". If the account password is lost
 * with no separate recovery flow, this is intentionally unrecoverable — see the spec's stated
 * trade-off; that's what makes this real encryption rather than security theatre.
 */

export interface EncryptedPayload {
  readonly blob: string; // base64 AES-GCM ciphertext
  readonly iv: string; // base64 96-bit IV
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** A fresh per-account salt, generated once at sign-up and stored server-side (not secret). */
export function generateSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

async function deriveKey(password: string, saltBase64: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromBase64(saltBase64), iterations: 210_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptCredentials(
  payload: SourceCredentialsPayload,
  password: string,
  saltBase64: string,
): Promise<EncryptedPayload> {
  const key = await deriveKey(password, saltBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(SourceCredentialsPayloadSchema.parse(payload)));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { blob: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) };
}

export async function decryptCredentials(
  encrypted: EncryptedPayload,
  password: string,
  saltBase64: string,
): Promise<SourceCredentialsPayload> {
  const key = await deriveKey(password, saltBase64);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(encrypted.iv) },
    key,
    fromBase64(encrypted.blob),
  );
  return SourceCredentialsPayloadSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
}
```

- [ ] **Step 2: Add `@testcard/sync-schema` as a dependency** — in `packages/core/package.json`, add to `"dependencies"`:

```json
    "@testcard/sync-schema": "workspace:*",
```

- [ ] **Step 3: Write `packages/core/src/__tests__/credentialCrypto.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { decryptCredentials, encryptCredentials, generateSalt } from "../sync/credentialCrypto.js";

describe("credentialCrypto", () => {
  it("round-trips a credentials payload through encrypt/decrypt", async () => {
    const salt = generateSalt();
    const payload = { host: "http://example.com", username: "alex", password: "hunter2" };
    const encrypted = await encryptCredentials(payload, "correct horse battery staple", salt);
    const decrypted = await decryptCredentials(encrypted, "correct horse battery staple", salt);
    expect(decrypted).toEqual(payload);
  });

  it("produces a different ciphertext each time (random IV)", async () => {
    const salt = generateSalt();
    const payload = { host: "http://example.com", username: "alex", password: "hunter2" };
    const first = await encryptCredentials(payload, "pw", salt);
    const second = await encryptCredentials(payload, "pw", salt);
    expect(first.blob).not.toBe(second.blob);
  });

  it("fails to decrypt with the wrong password", async () => {
    const salt = generateSalt();
    const encrypted = await encryptCredentials({ host: "http://example.com", username: "alex", password: "hunter2" }, "right-password", salt);
    await expect(decryptCredentials(encrypted, "wrong-password", salt)).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm install
pnpm --filter @testcard/core test -- credentialCrypto
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync/credentialCrypto.ts packages/core/src/__tests__/credentialCrypto.test.ts packages/core/package.json
git commit -m "Add client-side AES-GCM credential encryption for device sync"
```

## Task 8: `apps/sync-worker` scaffold + D1 schema

**Files:**
- Create: `apps/sync-worker/package.json`
- Create: `apps/sync-worker/tsconfig.json`
- Create: `apps/sync-worker/wrangler.toml`
- Create: `apps/sync-worker/migrations/0001_sync_tables.sql`

**Interfaces:**
- Consumes: nothing new
- Produces: the `sources`, `movie_favourites`, `movie_recents`, `series_favourites`, `series_recents`, `playback_progress` D1 tables (server-side), consumed by Tasks 10–11. `Env` binding shape (`{ DB: D1Database }`), consumed by every later Worker task.

- [ ] **Step 1: Write `apps/sync-worker/package.json`**

```json
{
  "name": "@testcard/sync-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "db:migrate:local": "wrangler d1 migrations apply testcard-sync --local",
    "db:migrate:remote": "wrangler d1 migrations apply testcard-sync --remote"
  },
  "dependencies": {
    "@testcard/sync-schema": "workspace:*",
    "better-auth": "^1.2.7",
    "hono": "^4.6.14",
    "kysely": "^0.27.4",
    "kysely-d1": "^0.3.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.6.4",
    "@cloudflare/workers-types": "^4.20250109.0",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4",
    "wrangler": "^3.99.0"
  }
}
```

- [ ] **Step 2: Write `apps/sync-worker/tsconfig.json`** (a standalone config — the Workers runtime target differs from Node, so this doesn't extend `tsconfig.base.json`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `apps/sync-worker/wrangler.toml`**

```toml
name = "testcard-sync"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "testcard-sync"
database_id = "REPLACE_WITH_WRANGLER_D1_CREATE_OUTPUT"
migrations_dir = "migrations"
```

Note in this step (not a code placeholder — an infra provisioning step that has to happen once, outside the codebase): run `npx wrangler d1 create testcard-sync`, then paste the `database_id` it prints into `wrangler.toml` above.

- [ ] **Step 4: Write `apps/sync-worker/migrations/0001_sync_tables.sql`**

```sql
CREATE TABLE IF NOT EXISTS sources (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  remote_key        TEXT NOT NULL,
  label             TEXT NOT NULL,
  credentials_blob  TEXT NOT NULL,
  credentials_iv    TEXT NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_user_remote ON sources(user_id, remote_key);

-- One salt per account, generated client-side at sign-up (see Task 9's /sync/salt) and fetched
-- by every other device on first sign-in, so every device derives the same AES-GCM key from the
-- account password. Not secret — losing it doesn't help an attacker without the password too.
CREATE TABLE IF NOT EXISTS sync_salts (
  user_id TEXT PRIMARY KEY,
  salt    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS movie_favourites (
  user_id     TEXT NOT NULL,
  remote_key  TEXT NOT NULL,
  added_at    INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (user_id, remote_key)
);

CREATE TABLE IF NOT EXISTS movie_recents (
  user_id     TEXT NOT NULL,
  remote_key  TEXT NOT NULL,
  played_at   INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (user_id, remote_key)
);

CREATE TABLE IF NOT EXISTS series_favourites (
  user_id     TEXT NOT NULL,
  remote_key  TEXT NOT NULL,
  added_at    INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (user_id, remote_key)
);

CREATE TABLE IF NOT EXISTS series_recents (
  user_id     TEXT NOT NULL,
  remote_key  TEXT NOT NULL,
  played_at   INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (user_id, remote_key)
);

CREATE TABLE IF NOT EXISTS playback_progress (
  user_id       TEXT NOT NULL,
  remote_key    TEXT NOT NULL,
  item_type     TEXT NOT NULL CHECK (item_type IN ('movie', 'episode')),
  position_secs INTEGER NOT NULL,
  duration_secs INTEGER,
  watched       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  PRIMARY KEY (user_id, remote_key, item_type)
);
```

- [ ] **Step 5: Commit**

```bash
git add apps/sync-worker
git commit -m "Scaffold apps/sync-worker: Hono + D1, sync tables migration"
```

## Task 9: Worker — `better-auth` accounts

**Files:**
- Create: `apps/sync-worker/src/auth.ts`
- Create: `apps/sync-worker/src/index.ts`

**Interfaces:**
- Consumes: `Env` (Task 8's D1 binding)
- Produces: `createAuth(db: D1Database)`, `Env`, a Hono `app` default export mounting `/auth/*`, `/sync/salt`, and a `requireSession` middleware that sets `c.set("userId", ...)` — consumed by Tasks 10–11. `handleGetSalt`/`handleSetSalt` — consumed by Task 12.

- [ ] **Step 1: Write `apps/sync-worker/src/auth.ts`**

```ts
import { betterAuth } from "better-auth";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";

/**
 * One `better-auth` instance per request (Workers have no persistent module-level state across
 * requests) — cheap: it just wraps the D1 binding already handed to us, no connection to open.
 */
export function createAuth(db: D1Database) {
  return betterAuth({
    database: { db: new Kysely({ dialect: new D1Dialect({ database: db }) }), type: "sqlite" },
    emailAndPassword: { enabled: true },
    session: { expiresIn: 60 * 60 * 24 * 30 }, // 30 days
  });
}
```

- [ ] **Step 2: Write `apps/sync-worker/src/routes/salt.ts`**

```ts
import type { Context } from "hono";
import { z } from "zod";
import type { Env } from "../index.js";

/**
 * Every device must derive the *same* AES-GCM key from the account password, which means every
 * device needs the same PBKDF2 salt. The device that signs up generates one (client-side, via
 * `packages/core/src/sync/credentialCrypto.ts#generateSalt`) and stores it here once; every other
 * device fetches it on first sign-in, before it can encrypt or decrypt anything. The salt itself
 * isn't secret — see the design spec's "Credential encryption" — so storing it server-side in the
 * clear is fine; only the password that derives a key from it matters.
 */

const SetSaltBodySchema = z.object({ salt: z.string().min(1) });

export async function handleGetSalt(c: Context<{ Bindings: Env; Variables: { userId: string } }>): Promise<Response> {
  const row = await c.env.DB.prepare(`SELECT salt FROM sync_salts WHERE user_id = ?`).bind(c.get("userId")).first<{ salt: string }>();
  if (!row) return c.json({ error: "no salt set for this account yet" }, 404);
  return c.json({ salt: row.salt });
}

/** Set-once: refuses to overwrite an existing salt, since changing it would strand every other device's key derivation. */
export async function handleSetSalt(c: Context<{ Bindings: Env; Variables: { userId: string } }>): Promise<Response> {
  const { salt } = SetSaltBodySchema.parse(await c.req.json());
  const result = await c.env.DB
    .prepare(`INSERT INTO sync_salts (user_id, salt) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING`)
    .bind(c.get("userId"), salt)
    .run();
  if (result.meta.changes === 0) return c.json({ error: "salt already set for this account" }, 409);
  return c.json({ ok: true });
}
```

- [ ] **Step 3: Write `apps/sync-worker/src/index.ts`**

```ts
import { Hono } from "hono";
import { createAuth } from "./auth.js";
import { handlePull } from "./routes/pull.js";
import { handlePush } from "./routes/push.js";
import { handleGetSalt, handleSetSalt } from "./routes/salt.js";

export interface Env {
  readonly DB: D1Database;
}

type AppEnv = { Bindings: Env; Variables: { userId: string } };

const app = new Hono<AppEnv>();

app.on(["GET", "POST"], "/auth/*", (c) => createAuth(c.env.DB).handler(c.req.raw));

async function requireSession(c: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>): Promise<Response | void> {
  const session = await createAuth(c.env.DB).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", session.user.id);
  await next();
}

app.get("/sync/pull", requireSession, handlePull);
app.post("/sync/push", requireSession, handlePush);
app.get("/sync/salt", requireSession, handleGetSalt);
app.post("/sync/salt", requireSession, handleSetSalt);

export default app;
```

- [ ] **Step 4: Generate `better-auth`'s own migration** — run its CLI to produce the SQL for its `user`/`session`/`account`/`verification` tables, then place the output as `apps/sync-worker/migrations/0000_better_auth.sql` (numbered before `0001_sync_tables.sql` so it applies first):

```bash
cd apps/sync-worker
npx @better-auth/cli generate --config src/auth.ts --output migrations/0000_better_auth.sql
```

- [ ] **Step 5: Apply migrations locally and typecheck**

```bash
pnpm --filter @testcard/sync-worker db:migrate:local
pnpm --filter @testcard/sync-worker typecheck
```

Expected: both succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/sync-worker/src/auth.ts apps/sync-worker/src/index.ts apps/sync-worker/src/routes/salt.ts apps/sync-worker/migrations/0000_better_auth.sql
git commit -m "Mount better-auth (D1-backed) and /sync/salt in the sync Worker"
```

## Task 10: Worker — `GET /sync/pull`

**Files:**
- Create: `apps/sync-worker/src/routes/pull.ts`

**Interfaces:**
- Consumes: `Env`, `AppEnv`-shaped `Context` (Task 9); `SyncPullResponseSchema` (Task 1)
- Produces: `handlePull(c): Promise<Response>` — mounted at `GET /sync/pull` by Task 9's `index.ts`.

- [ ] **Step 1: Write `apps/sync-worker/src/routes/pull.ts`**

```ts
import type { Context } from "hono";
import { SyncPullResponseSchema } from "@testcard/sync-schema";
import type { Env } from "../index.js";

interface Row {
  readonly [key: string]: unknown;
}

export async function handlePull(c: Context<{ Bindings: Env; Variables: { userId: string } }>): Promise<Response> {
  const userId = c.get("userId");
  const since = Number(c.req.query("since") ?? "0");
  const db = c.env.DB;

  const [sources, movieFavourites, movieRecents, seriesFavourites, seriesRecents, progress] = await Promise.all([
    db
      .prepare(
        `SELECT remote_key AS remoteKey, label, credentials_blob AS credentialsBlob, credentials_iv AS credentialsIv,
                updated_at AS updatedAt, deleted_at AS deletedAt
         FROM sources WHERE user_id = ? AND updated_at > ?`,
      )
      .bind(userId, since)
      .all<Row>(),
    db
      .prepare(`SELECT remote_key AS remoteKey, added_at AS addedAt, updated_at AS updatedAt, deleted_at AS deletedAt
                FROM movie_favourites WHERE user_id = ? AND updated_at > ?`)
      .bind(userId, since)
      .all<Row>(),
    db
      .prepare(`SELECT remote_key AS remoteKey, played_at AS playedAt, updated_at AS updatedAt, deleted_at AS deletedAt
                FROM movie_recents WHERE user_id = ? AND updated_at > ?`)
      .bind(userId, since)
      .all<Row>(),
    db
      .prepare(`SELECT remote_key AS remoteKey, added_at AS addedAt, updated_at AS updatedAt, deleted_at AS deletedAt
                FROM series_favourites WHERE user_id = ? AND updated_at > ?`)
      .bind(userId, since)
      .all<Row>(),
    db
      .prepare(`SELECT remote_key AS remoteKey, played_at AS playedAt, updated_at AS updatedAt, deleted_at AS deletedAt
                FROM series_recents WHERE user_id = ? AND updated_at > ?`)
      .bind(userId, since)
      .all<Row>(),
    db
      .prepare(
        `SELECT remote_key AS remoteKey, item_type AS itemType, position_secs AS positionSecs, duration_secs AS durationSecs,
                watched, updated_at AS updatedAt, deleted_at AS deletedAt
         FROM playback_progress WHERE user_id = ? AND updated_at > ?`,
      )
      .bind(userId, since)
      .all<Row>(),
  ]);

  const response = SyncPullResponseSchema.parse({
    sources: sources.results,
    movieFavourites: movieFavourites.results,
    movieRecents: movieRecents.results,
    seriesFavourites: seriesFavourites.results,
    seriesRecents: seriesRecents.results,
    progress: progress.results.map((row) => ({ ...row, watched: Boolean(row.watched) })),
    serverCursor: Date.now(),
  });

  return c.json(response);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/sync-worker/src/routes/pull.ts
git commit -m "Add GET /sync/pull"
```

## Task 11: Worker — `POST /sync/push` + Worker tests

**Files:**
- Create: `apps/sync-worker/src/routes/push.ts`
- Create: `apps/sync-worker/vitest.config.ts`
- Create: `apps/sync-worker/test/apply-migrations.ts`
- Test: `apps/sync-worker/test/sync.test.ts`

**Interfaces:**
- Consumes: `Env` (Task 9); `SyncPushRequestSchema`/`SyncPushResponseSchema` (Task 1)
- Produces: `handlePush(c): Promise<Response>` — mounted at `POST /sync/push` by Task 9's `index.ts`. Last-write-wins upsert: a push only overwrites a row if its `updatedAt` is newer than what's stored.

- [ ] **Step 1: Write `apps/sync-worker/src/routes/push.ts`**

```ts
import type { Context } from "hono";
import { SyncPushRequestSchema, SyncPushResponseSchema } from "@testcard/sync-schema";
import type { Env } from "../index.js";

type FavouriteOrRecentTable = "movie_favourites" | "movie_recents" | "series_favourites" | "series_recents";

function upsertFavouriteOrRecent(
  db: D1Database,
  table: FavouriteOrRecentTable,
  timestampColumn: "added_at" | "played_at",
  userId: string,
  remoteKey: string,
  timestamp: number,
  updatedAt: number,
  deletedAt: number | null,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ${table} (user_id, remote_key, ${timestampColumn}, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, remote_key) DO UPDATE SET
         ${timestampColumn} = excluded.${timestampColumn}, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
       WHERE excluded.updated_at > ${table}.updated_at`,
    )
    .bind(userId, remoteKey, timestamp, updatedAt, deletedAt);
}

export async function handlePush(c: Context<{ Bindings: Env; Variables: { userId: string } }>): Promise<Response> {
  const userId = c.get("userId");
  const body = SyncPushRequestSchema.parse(await c.req.json());
  const db = c.env.DB;

  const statements = [
    ...body.sources.map((s) =>
      db
        .prepare(
          `INSERT INTO sources (id, user_id, remote_key, label, credentials_blob, credentials_iv, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, remote_key) DO UPDATE SET
             label = excluded.label, credentials_blob = excluded.credentials_blob,
             credentials_iv = excluded.credentials_iv, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
           WHERE excluded.updated_at > sources.updated_at`,
        )
        .bind(`${userId}:${s.remoteKey}`, userId, s.remoteKey, s.label, s.credentialsBlob, s.credentialsIv, s.updatedAt, s.deletedAt),
    ),
    ...body.movieFavourites.map((f) => upsertFavouriteOrRecent(db, "movie_favourites", "added_at", userId, f.remoteKey, f.addedAt, f.updatedAt, f.deletedAt)),
    ...body.movieRecents.map((r) => upsertFavouriteOrRecent(db, "movie_recents", "played_at", userId, r.remoteKey, r.playedAt, r.updatedAt, r.deletedAt)),
    ...body.seriesFavourites.map((f) => upsertFavouriteOrRecent(db, "series_favourites", "added_at", userId, f.remoteKey, f.addedAt, f.updatedAt, f.deletedAt)),
    ...body.seriesRecents.map((r) => upsertFavouriteOrRecent(db, "series_recents", "played_at", userId, r.remoteKey, r.playedAt, r.updatedAt, r.deletedAt)),
    ...body.progress.map((p) =>
      db
        .prepare(
          `INSERT INTO playback_progress (user_id, remote_key, item_type, position_secs, duration_secs, watched, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, remote_key, item_type) DO UPDATE SET
             position_secs = excluded.position_secs, duration_secs = excluded.duration_secs,
             watched = excluded.watched, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
           WHERE excluded.updated_at > playback_progress.updated_at`,
        )
        .bind(userId, p.remoteKey, p.itemType, p.positionSecs, p.durationSecs, p.watched ? 1 : 0, p.updatedAt, p.deletedAt),
    ),
  ];

  if (statements.length > 0) await db.batch(statements);

  return c.json(SyncPushResponseSchema.parse({ newCursor: Date.now() }));
}
```

- [ ] **Step 2: Write `apps/sync-worker/vitest.config.ts`**

```ts
import path from "node:path";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
        },
      },
    },
  };
});
```

- [ ] **Step 3: Write `apps/sync-worker/test/apply-migrations.ts`**

```ts
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

- [ ] **Step 4: Write `apps/sync-worker/test/sync.test.ts`** — exercises push/pull directly against D1, bypassing `better-auth` by seeding a session row isn't practical here, so this test calls the route handlers with a fixed `userId` the same way `requireSession` would set it:

```ts
import { describe, expect, it } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { handlePull } from "../src/routes/pull.js";
import { handlePush } from "../src/routes/push.js";
import type { Env } from "../src/index.js";

function testApp() {
  const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>();
  app.use("*", async (c, next) => {
    c.set("userId", "test-user");
    await next();
  });
  app.get("/sync/pull", handlePull);
  app.post("/sync/push", handlePush);
  return app;
}

describe("POST /sync/push then GET /sync/pull", () => {
  it("round-trips a favourite and a progress row", async () => {
    const app = testApp();
    const ctx = createExecutionContext();

    const pushRes = await app.request(
      "/sync/push",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: [],
          movieFavourites: [{ remoteKey: "movie-abc", addedAt: 1000, updatedAt: 1000, deletedAt: null }],
          movieRecents: [],
          seriesFavourites: [],
          seriesRecents: [],
          progress: [
            { remoteKey: "movie-abc", itemType: "movie", positionSecs: 300, durationSecs: 7200, watched: false, updatedAt: 1000, deletedAt: null },
          ],
        }),
      },
      env,
      ctx,
    );
    expect(pushRes.status).toBe(200);

    const pullRes = await app.request("/sync/pull?since=0", {}, env, ctx);
    expect(pullRes.status).toBe(200);
    const pulled = await pullRes.json();
    expect(pulled.movieFavourites).toHaveLength(1);
    expect(pulled.movieFavourites[0].remoteKey).toBe("movie-abc");
    expect(pulled.progress).toHaveLength(1);
    expect(pulled.progress[0].positionSecs).toBe(300);
  });

  it("does not overwrite a newer row with an older push (last-write-wins)", async () => {
    const app = testApp();
    const ctx = createExecutionContext();

    await app.request(
      "/sync/push",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: [],
          movieFavourites: [],
          movieRecents: [],
          seriesFavourites: [],
          seriesRecents: [],
          progress: [{ remoteKey: "movie-xyz", itemType: "movie", positionSecs: 500, durationSecs: 7200, watched: false, updatedAt: 2000, deletedAt: null }],
        }),
      },
      env,
      ctx,
    );
    await app.request(
      "/sync/push",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: [],
          movieFavourites: [],
          movieRecents: [],
          seriesFavourites: [],
          seriesRecents: [],
          progress: [{ remoteKey: "movie-xyz", itemType: "movie", positionSecs: 100, durationSecs: 7200, watched: false, updatedAt: 1000, deletedAt: null }],
        }),
      },
      env,
      ctx,
    );

    const pullRes = await app.request("/sync/pull?since=0", {}, env, ctx);
    const pulled = await pullRes.json();
    const row = pulled.progress.find((p: { remoteKey: string }) => p.remoteKey === "movie-xyz");
    expect(row.positionSecs).toBe(500); // the older (stale) push must not have won
  });
});
```

- [ ] **Step 5: Run Worker tests**

```bash
pnpm --filter @testcard/sync-worker test
```

Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/sync-worker/src/routes/push.ts apps/sync-worker/vitest.config.ts apps/sync-worker/test
git commit -m "Add POST /sync/push (last-write-wins) with round-trip Worker tests"
```

## Task 12: `packages/core/src/sync/client.ts` — `SyncClient`

**Files:**
- Create: `packages/core/src/sync/client.ts`
- Test: `packages/core/src/__tests__/syncClient.test.ts`

**Interfaces:**
- Consumes: `SyncPullResponse`/`SyncPullResponseSchema`, `SyncPushRequest`/`SyncPushRequestSchema`, `SyncPushResponse`/`SyncPushResponseSchema` (Task 1)
- Produces: `SyncClient` class with `signUp(email, password)`, `signIn(email, password)`, `signOut()`, `pull(since)`, `push(request)`, `getSalt()`, `setSalt(salt)` — consumed by Task 14.

- [ ] **Step 1: Add `wretch` as a dependency** — in `packages/core/package.json`, add to `"dependencies"`:

```json
    "wretch": "^2.11.0",
```

- [ ] **Step 2: Write `packages/core/src/sync/client.ts`**

```ts
import wretch, { type Wretch } from "wretch";
import {
  SyncPullResponseSchema,
  SyncPushRequestSchema,
  SyncPushResponseSchema,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from "@testcard/sync-schema";

export interface SyncClientConfig {
  readonly baseUrl: string;
  /** Read fresh on every call — the token can change between calls (sign-in/out). */
  readonly getSessionToken: () => string | undefined;
}

export interface AuthResult {
  readonly userId: string;
  readonly sessionToken: string;
}

interface BetterAuthEmailResponse {
  readonly user: { readonly id: string };
  readonly token: string;
}

/**
 * Thin `wretch`-based client for `/auth/*` and `/sync/*`. Every response is parsed through its
 * `packages/sync-schema` zod schema before this class hands it back — a shape drift between the
 * Worker and this client fails loudly here instead of surfacing as a confusing UI bug later.
 */
export class SyncClient {
  private readonly api: Wretch;

  constructor(private readonly config: SyncClientConfig) {
    this.api = wretch(config.baseUrl);
  }

  private authed(): Wretch {
    const token = this.config.getSessionToken();
    return token !== undefined ? this.api.auth(`Bearer ${token}`) : this.api;
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    const res = (await this.api.url("/auth/sign-up/email").post({ email, password }).json()) as BetterAuthEmailResponse;
    return { userId: res.user.id, sessionToken: res.token };
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const res = (await this.api.url("/auth/sign-in/email").post({ email, password }).json()) as BetterAuthEmailResponse;
    return { userId: res.user.id, sessionToken: res.token };
  }

  async signOut(): Promise<void> {
    await this.authed().url("/auth/sign-out").post({}).res();
  }

  async pull(since: number): Promise<SyncPullResponse> {
    const json = await this.authed().url(`/sync/pull?since=${since}`).get().json();
    return SyncPullResponseSchema.parse(json);
  }

  /** Fetches this account's PBKDF2 salt (set once at sign-up). Undefined if none is set yet. */
  async getSalt(): Promise<string | undefined> {
    const res = await this.authed().url("/sync/salt").get().res();
    if (res.status === 404) return undefined;
    const json = (await res.json()) as { salt: string };
    return json.salt;
  }

  /** Set-once — call only right after `signUp`, with a freshly generated salt. */
  async setSalt(salt: string): Promise<void> {
    await this.authed().url("/sync/salt").post({ salt }).res();
  }

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    const body = SyncPushRequestSchema.parse(request);
    const json = await this.authed().url("/sync/push").post(body).json();
    return SyncPushResponseSchema.parse(json);
  }
}
```

- [ ] **Step 3: Write `packages/core/src/__tests__/syncClient.test.ts`**, mocking `globalThis.fetch` (the only network seam `wretch` uses):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncClient } from "../sync/client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("SyncClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signIn posts to /auth/sign-in/email and returns the session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user: { id: "u1" }, token: "tok" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => undefined });
    const result = await client.signIn("a@b.com", "pw");

    expect(result).toEqual({ userId: "u1", sessionToken: "tok" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sync.example.com/auth/sign-in/email");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("attaches a bearer token on pull when one is available", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ sources: [], movieFavourites: [], movieRecents: [], seriesFavourites: [], seriesRecents: [], progress: [], serverCursor: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => "session-tok" });
    await client.pull(0);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer session-tok");
  });

  it("rejects a malformed pull response instead of returning it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sources: "not-an-array" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => undefined });
    await expect(client.pull(0)).rejects.toThrow();
  });

  it("getSalt returns undefined on a 404 (no salt set yet)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "no salt set for this account yet" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => "tok" });
    await expect(client.getSalt()).resolves.toBeUndefined();
  });

  it("getSalt returns the salt when one exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ salt: "c2FsdA==" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => "tok" });
    await expect(client.getSalt()).resolves.toBe("c2FsdA==");
  });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm install
pnpm --filter @testcard/core test -- syncClient
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync/client.ts packages/core/src/__tests__/syncClient.test.ts packages/core/package.json
git commit -m "Add SyncClient: wretch + zod-validated /auth and /sync calls"
```

## Task 13: `packages/core/src/sync/localChanges.ts` — collect/apply

**Files:**
- Create: `packages/core/src/sync/localChanges.ts`

**Interfaces:**
- Consumes: `SyncPushRequest`/`SyncPullResponse` (Task 1), `encryptCredentials`/`decryptCredentials` (Task 7)
- Produces: `getSyncState(db)`, `setSyncState(db, patch)`, `collectLocalChanges(db, sinceMs, password, salt, getCredentials): Promise<SyncPushRequest>`, `applyRemoteChanges(db, response, password, salt, onDecryptedSource): Promise<void>` — consumed by Task 14's sync controller. `getCredentials` is the same shape as the existing `CredentialsLookup` type already used by `packages/core/src/source/xtream/client.ts` — this module never reads the Xtream username/password itself (they live in Electron's `safeStorage`-backed `credentials.enc.json`, outside framework-free `packages/core`'s reach), it only asks for them by source id. DB-touching — no unit test here per this codebase's testing convention (ADR 0003/0005); verified by Task 16's hardware checklist.

- [ ] **Step 1: Write `packages/core/src/sync/localChanges.ts`**

```ts
import type Database from "better-sqlite3";
import { decryptCredentials, encryptCredentials } from "./credentialCrypto.js";
import type { SyncFavourite, SyncPullResponse, SyncPushRequest, SyncRecent, SyncSource } from "@testcard/sync-schema";

export interface SyncState {
  readonly lastPulledAt: number;
  readonly lastPushedAt: number;
}

export function getSyncState(db: Database.Database): SyncState {
  const row = db.prepare(`SELECT last_pulled_at AS lastPulledAt, last_pushed_at AS lastPushedAt FROM sync_state WHERE id = 1`).get() as
    | SyncState
    | undefined;
  if (row) return row;
  db.prepare(`INSERT INTO sync_state (id, last_pulled_at, last_pushed_at) VALUES (1, 0, 0)`).run();
  return { lastPulledAt: 0, lastPushedAt: 0 };
}

export function setSyncState(db: Database.Database, patch: Partial<SyncState>): void {
  getSyncState(db); // ensures the singleton row exists
  if (patch.lastPulledAt !== undefined) db.prepare(`UPDATE sync_state SET last_pulled_at = ? WHERE id = 1`).run(patch.lastPulledAt);
  if (patch.lastPushedAt !== undefined) db.prepare(`UPDATE sync_state SET last_pushed_at = ? WHERE id = 1`).run(patch.lastPushedAt);
}

interface FavouriteOrRecentRow {
  readonly remote_key: string | null;
  readonly added_at?: number;
  readonly played_at?: number;
  readonly updated_at: number | null;
}

function collectFavouritesOrRecents(
  db: Database.Database,
  table: string,
  timestampColumn: "added_at" | "played_at",
  sinceMs: number,
): readonly (SyncFavourite | SyncRecent)[] {
  const rows = db
    .prepare(`SELECT remote_key, ${timestampColumn}, updated_at FROM ${table} WHERE updated_at > ? AND remote_key IS NOT NULL`)
    .all(sinceMs) as FavouriteOrRecentRow[];
  return rows.map((row) => ({
    remoteKey: row.remote_key as string,
    ...(timestampColumn === "added_at" ? { addedAt: row.added_at as number } : { playedAt: row.played_at as number }),
    updatedAt: row.updated_at as number,
    deletedAt: null,
  })) as readonly (SyncFavourite | SyncRecent)[];
}

/** Same shape as `packages/core/src/source/xtream/client.ts`'s existing `CredentialsLookup`. */
export type SyncCredentialsLookup = (sourceId: string) => Promise<{ baseUrl: string; username: string; password: string }>;

/**
 * Builds this device's `SyncPushRequest`: every row changed since `sinceMs`, plus every tombstone
 * recorded since the last push (a local delete, e.g. an unfavourite — see Task 6). Xtream source
 * credentials are fetched via `getCredentials` (the actual username/password live in Electron's
 * `safeStorage`-backed store, outside this framework-free module's reach — see `main/credentials.ts`)
 * and encrypted here, right before they leave the device.
 */
export async function collectLocalChanges(
  db: Database.Database,
  sinceMs: number,
  accountPassword: string,
  salt: string,
  getCredentials: SyncCredentialsLookup,
): Promise<SyncPushRequest> {
  const sourceRows = db
    .prepare(
      `SELECT id, remote_key, name, sync_updated_at FROM sources
       WHERE kind = 'xtream' AND remote_key IS NOT NULL AND sync_updated_at > ?`,
    )
    .all(sinceMs) as { id: string; remote_key: string; name: string; sync_updated_at: number }[];

  const sources: SyncSource[] = [];
  for (const row of sourceRows) {
    const credentials = await getCredentials(row.id);
    const encrypted = await encryptCredentials(
      { host: credentials.baseUrl, username: credentials.username, password: credentials.password },
      accountPassword,
      salt,
    );
    sources.push({ remoteKey: row.remote_key, label: row.name, credentialsBlob: encrypted.blob, credentialsIv: encrypted.iv, updatedAt: row.sync_updated_at, deletedAt: null });
  }

  const tombstoneRows = db.prepare(`SELECT table_name, remote_key, deleted_at FROM sync_tombstones`).all() as {
    table_name: string;
    remote_key: string;
    deleted_at: number;
  }[];
  const tombstonesByTable = new Map<string, { remoteKey: string; deletedAt: number }[]>();
  for (const row of tombstoneRows) {
    const list = tombstonesByTable.get(row.table_name) ?? [];
    list.push({ remoteKey: row.remote_key, deletedAt: row.deleted_at });
    tombstonesByTable.set(row.table_name, list);
  }
  function withTombstones<T extends { remoteKey: string; updatedAt: number; deletedAt: number | null }>(table: string, rows: readonly T[]): T[] {
    const tombstones = (tombstonesByTable.get(table) ?? []).map((t) => ({ ...rows[0], remoteKey: t.remoteKey, updatedAt: t.deletedAt, deletedAt: t.deletedAt }) as T);
    return [...rows, ...tombstones];
  }

  const progressRows = db
    .prepare(
      `SELECT remote_key, item_type, position_secs, duration_secs, watched, updated_at, deleted_at
       FROM playback_progress WHERE updated_at > ? AND remote_key IS NOT NULL`,
    )
    .all(sinceMs) as { remote_key: string; item_type: "movie" | "episode"; position_secs: number; duration_secs: number | null; watched: 0 | 1; updated_at: number; deleted_at: number | null }[];

  return {
    sources,
    movieFavourites: withTombstones("movie_favourites", collectFavouritesOrRecents(db, "movie_favourites", "added_at", sinceMs) as SyncFavourite[]),
    movieRecents: withTombstones("movie_recents", collectFavouritesOrRecents(db, "movie_recents", "played_at", sinceMs) as SyncRecent[]),
    seriesFavourites: withTombstones("series_favourites", collectFavouritesOrRecents(db, "series_favourites", "added_at", sinceMs) as SyncFavourite[]),
    seriesRecents: withTombstones("series_recents", collectFavouritesOrRecents(db, "series_recents", "played_at", sinceMs) as SyncRecent[]),
    progress: progressRows.map((row) => ({
      remoteKey: row.remote_key,
      itemType: row.item_type,
      positionSecs: row.position_secs,
      durationSecs: row.duration_secs,
      watched: Boolean(row.watched),
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    })),
  };
}

/** Clears tombstones once the push that reported them has succeeded. */
export function clearTombstones(db: Database.Database): void {
  db.prepare(`DELETE FROM sync_tombstones`).run();
}

/**
 * Applies a `SyncPullResponse` into local tables, matching each remote row to its local row by
 * `remote_key` (never by local id, which differs per device — see the design spec's "Portable
 * content identity"). A row with no local match yet (this device hasn't imported that title) is
 * skipped for favourites/recents/progress — there's nothing local to attach it to until a
 * catalog refresh imports it, at which point `remote_key` will already be populated (Task 4) and
 * the next pull will match. Xtream source credentials are decrypted here, immediately before
 * being written to `credentials.enc.json` by the caller (Task 14) — this function never touches
 * that file directly, keeping `packages/core` free of Electron's `safeStorage`.
 */
export async function applyRemoteChanges(
  db: Database.Database,
  response: SyncPullResponse,
  accountPassword: string,
  salt: string,
  onDecryptedSource: (remoteKey: string, label: string, credentials: { host: string; username: string; password: string }) => Promise<void>,
): Promise<void> {
  for (const source of response.sources) {
    // Removing a source on one device and having that propagate to others (a tombstone on
    // `sources`, mirroring Task 6's favourite tombstones) is out of scope for this plan — see
    // Task 16 Step 8's regression note. A deleted-remotely source is simply never pulled again;
    // it isn't retroactively removed from a device that already has it.
    if (source.deletedAt !== null) continue;
    const decrypted = await decryptCredentials({ blob: source.credentialsBlob, iv: source.credentialsIv }, accountPassword, salt);
    await onDecryptedSource(source.remoteKey, source.label, decrypted);
  }

  const upsertFavourite = (table: string, idColumn: string, timestampColumn: string) =>
    db.prepare(`
      UPDATE ${table} SET ${timestampColumn} = @timestamp, updated_at = @updatedAt
      WHERE ${idColumn} = (SELECT id FROM ${table === "movie_favourites" || table === "movie_recents" ? "movies" : "series"} WHERE remote_key = @remoteKey)
    `);

  const applyAll = db.transaction(() => {
    for (const row of response.movieFavourites) {
      if (row.deletedAt !== null) {
        db.prepare(`DELETE FROM movie_favourites WHERE remote_key = ?`).run(row.remoteKey);
        continue;
      }
      const movie = db.prepare(`SELECT id FROM movies WHERE remote_key = ?`).get(row.remoteKey) as { id: string } | undefined;
      if (!movie) continue;
      db.prepare(
        `INSERT INTO movie_favourites (movie_id, added_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(movie_id) DO UPDATE SET added_at = excluded.added_at, updated_at = excluded.updated_at
         WHERE excluded.updated_at > movie_favourites.updated_at`,
      ).run(movie.id, row.addedAt, row.remoteKey, row.updatedAt);
    }

    for (const row of response.progress) {
      const table = row.itemType === "movie" ? "movies" : "episodes";
      const item = db.prepare(`SELECT id FROM ${table} WHERE remote_key = ?`).get(row.remoteKey) as { id: string } | undefined;
      if (!item) continue;
      db.prepare(
        `INSERT INTO playback_progress (item_type, item_id, position_secs, duration_secs, watched, updated_at, remote_key, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_type, item_id) DO UPDATE SET
           position_secs = excluded.position_secs, duration_secs = excluded.duration_secs,
           watched = excluded.watched, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
         WHERE excluded.updated_at > playback_progress.updated_at`,
      ).run(row.itemType, item.id, row.positionSecs, row.durationSecs, row.watched ? 1 : 0, row.updatedAt, row.remoteKey, row.deletedAt);
    }

    // movieRecents/seriesFavourites/seriesRecents follow the identical shape as movieFavourites
    // above (upsert-by-parent-remote_key, delete on deletedAt) — omitted here only to keep this
    // step readable; implement all four the same way before moving on.
  });
  applyAll();
}
```

- [ ] **Step 2: Fill in the three omitted branches** — extend `applyAll`'s transaction body with `movieRecents`, `seriesFavourites`, and `seriesRecents` loops, each identical in shape to the `movieFavourites` loop above:

```ts
    for (const row of response.movieRecents) {
      if (row.deletedAt !== null) {
        db.prepare(`DELETE FROM movie_recents WHERE remote_key = ?`).run(row.remoteKey);
        continue;
      }
      const movie = db.prepare(`SELECT id FROM movies WHERE remote_key = ?`).get(row.remoteKey) as { id: string } | undefined;
      if (!movie) continue;
      db.prepare(
        `INSERT INTO movie_recents (movie_id, played_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(movie_id) DO UPDATE SET played_at = excluded.played_at, updated_at = excluded.updated_at
         WHERE excluded.updated_at > movie_recents.updated_at`,
      ).run(movie.id, row.playedAt, row.remoteKey, row.updatedAt);
    }

    for (const row of response.seriesFavourites) {
      if (row.deletedAt !== null) {
        db.prepare(`DELETE FROM series_favourites WHERE remote_key = ?`).run(row.remoteKey);
        continue;
      }
      const series = db.prepare(`SELECT id FROM series WHERE remote_key = ?`).get(row.remoteKey) as { id: string } | undefined;
      if (!series) continue;
      db.prepare(
        `INSERT INTO series_favourites (series_id, added_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(series_id) DO UPDATE SET added_at = excluded.added_at, updated_at = excluded.updated_at
         WHERE excluded.updated_at > series_favourites.updated_at`,
      ).run(series.id, row.addedAt, row.remoteKey, row.updatedAt);
    }

    for (const row of response.seriesRecents) {
      if (row.deletedAt !== null) {
        db.prepare(`DELETE FROM series_recents WHERE remote_key = ?`).run(row.remoteKey);
        continue;
      }
      const series = db.prepare(`SELECT id FROM series WHERE remote_key = ?`).get(row.remoteKey) as { id: string } | undefined;
      if (!series) continue;
      db.prepare(
        `INSERT INTO series_recents (series_id, played_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(series_id) DO UPDATE SET played_at = excluded.played_at, updated_at = excluded.updated_at
         WHERE excluded.updated_at > series_recents.updated_at`,
      ).run(series.id, row.playedAt, row.remoteKey, row.updatedAt);
    }
```

Also remove the now-unused `upsertFavourite` helper stub from Step 1 (it was scaffolding for this step, not meant to remain — the four loops above are written out in full instead, matching this codebase's "no `Similar to Task N`, write the real code" convention).

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @testcard/core typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/sync/localChanges.ts
git commit -m "Add collectLocalChanges/applyRemoteChanges: sync push/pull payload <-> local DB"
```

## Task 14: Desktop — `sync.*` IPC + `main/syncController.ts`

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`
- Create: `apps/desktop/src/main/syncController.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Consumes: `SyncClient` (Task 12), `collectLocalChanges`/`applyRemoteChanges`/`getSyncState`/`setSyncState`/`clearTombstones` (Task 13), `generateSalt` (Task 7), `saveCredentials`/`getCredentials` (existing `main/credentials.ts`)
- Produces: `SyncStatus`, `TestcardApi["sync"]` (`signUp`, `signIn`, `signOut`, `status`, `triggerNow`) — consumed by Task 15's UI.

- [ ] **Step 1: Add `@testcard/core`'s sync exports and the `sync` namespace to `apps/desktop/src/shared/ipc.ts`** — append near the end of the file, before `IPC_CHANNEL`:

```ts
export type SyncAccountStatus = "signed-out" | "signed-in";

export interface SyncStatus {
  readonly account: SyncAccountStatus;
  readonly email?: string;
  readonly lastSyncedAt?: number;
  readonly lastError?: string;
}
```

Add to the `TestcardApi` interface, after `view`:

```ts
  sync: {
    status(): Promise<SyncStatus>;
    signUp(email: string, password: string): Promise<SyncStatus>;
    signIn(email: string, password: string): Promise<SyncStatus>;
    signOut(): Promise<SyncStatus>;
    /** Runs one push-then-pull cycle immediately, outside the periodic schedule. */
    triggerNow(): Promise<SyncStatus>;
  };
```

- [ ] **Step 2: Write `apps/desktop/src/main/syncController.ts`**

```ts
import type Database from "better-sqlite3";
import {
  applyRemoteChanges,
  clearTombstones,
  collectLocalChanges,
  generateSalt,
  getSyncState,
  setSyncState,
  SyncClient,
} from "@testcard/core";
import type { SyncStatus } from "../shared/ipc.js";
import { getCredentials, saveCredentials } from "./credentials.js";

const SYNC_WORKER_URL = process.env.TESTCARD_SYNC_URL ?? "https://sync.testcard.app";
const PERIODIC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Owns the one in-memory secret this feature needs: the account password, used to derive the
 * credential-encryption key (Task 7's `credentialCrypto.ts`). It is never persisted — only the
 * resulting session token, account email, and PBKDF2 salt live in `sync_state` (Task 2), so a
 * relaunch always needs a fresh sign-in to sync again. That's the direct consequence of the
 * design spec's "Credential encryption" trade-off: no password, no decrypting synced sources.
 * The salt itself isn't secret (see Task 9's `/sync/salt`) and is safe to persist — it's what
 * lets a *second* device, after signing in, derive the exact same key the first device used.
 */
export class SyncController {
  private client: SyncClient;
  private accountPassword: string | undefined;
  private salt: string | undefined;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private lastError: string | undefined;

  constructor(private readonly db: Database.Database) {
    this.client = new SyncClient({ baseUrl: SYNC_WORKER_URL, getSessionToken: () => this.sessionToken() });
    const row = this.db.prepare(`SELECT sync_salt FROM sync_state WHERE id = 1`).get() as { sync_salt: string | null } | undefined;
    this.salt = row?.sync_salt ?? undefined;
  }

  private sessionToken(): string | undefined {
    const row = this.db.prepare(`SELECT session_token FROM sync_state WHERE id = 1`).get() as { session_token: string | null } | undefined;
    return row?.session_token ?? undefined;
  }

  status(): SyncStatus {
    const row = this.db.prepare(`SELECT account_email, last_pulled_at FROM sync_state WHERE id = 1`).get() as
      | { account_email: string | null; last_pulled_at: number }
      | undefined;
    if (!row || row.account_email === null) return { account: "signed-out", ...(this.lastError !== undefined ? { lastError: this.lastError } : {}) };
    return {
      account: "signed-in",
      email: row.account_email,
      lastSyncedAt: row.last_pulled_at || undefined,
      ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
    };
  }

  async signUp(email: string, password: string): Promise<SyncStatus> {
    const result = await this.client.signUp(email, password);
    const salt = generateSalt();
    await this.client.setSalt(salt); // set-once; safe even if a retry races, see handleSetSalt's ON CONFLICT DO NOTHING
    this.persistSession(email, result.sessionToken, password, salt);
    this.startPeriodicSync();
    return this.status();
  }

  async signIn(email: string, password: string): Promise<SyncStatus> {
    const result = await this.client.signIn(email, password);
    let salt = await this.client.getSalt();
    if (salt === undefined) {
      // Defensive fallback only: every account should have set one during signUp. Recovering
      // here means a first-ever sync still works even if that step was somehow interrupted.
      salt = generateSalt();
      await this.client.setSalt(salt);
    }
    this.persistSession(email, result.sessionToken, password, salt);
    this.startPeriodicSync();
    await this.runOnce();
    return this.status();
  }

  async signOut(): Promise<SyncStatus> {
    await this.client.signOut().catch(() => undefined); // best-effort — sign the device out locally regardless
    this.accountPassword = undefined;
    this.db.prepare(`UPDATE sync_state SET account_email = NULL, session_token = NULL WHERE id = 1`).run();
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    return this.status();
  }

  async triggerNow(): Promise<SyncStatus> {
    await this.runOnce();
    return this.status();
  }

  private persistSession(email: string, sessionToken: string, password: string, salt: string): void {
    getSyncState(this.db); // ensures the singleton row exists
    this.db.prepare(`UPDATE sync_state SET account_email = ?, session_token = ?, sync_salt = ? WHERE id = 1`).run(email, sessionToken, salt);
    this.accountPassword = password;
    this.salt = salt;
  }

  private startPeriodicSync(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.intervalHandle = setInterval(() => {
      this.runOnce().catch(() => undefined);
    }, PERIODIC_INTERVAL_MS);
  }

  private async runOnce(): Promise<void> {
    if (this.accountPassword === undefined || this.salt === undefined) return; // signed out, or a fresh launch with no re-entered password yet
    const password = this.accountPassword;
    const salt = this.salt;
    try {
      const state = getSyncState(this.db);
      const push = await collectLocalChanges(this.db, state.lastPushedAt, password, salt, (sourceId) => getCredentials(sourceId));
      const pushResult = await this.client.push(push);
      setSyncState(this.db, { lastPushedAt: pushResult.newCursor });
      clearTombstones(this.db);

      const pull = await this.client.pull(state.lastPulledAt);
      await applyRemoteChanges(this.db, pull, password, salt, async (remoteKey, label, credentials) => {
        const existing = this.db.prepare(`SELECT id FROM sources WHERE remote_key = ?`).get(remoteKey) as { id: string } | undefined;
        if (existing) return; // already have this provider configured locally — never overwrite a live source's id
        const id = crypto.randomUUID();
        await saveCredentials(id, { baseUrl: credentials.host, username: credentials.username, password: credentials.password });
        this.db
          .prepare(`INSERT INTO sources (id, kind, name, base_url, created_at, remote_key) VALUES (?, 'xtream', ?, ?, ?, ?)`)
          .run(id, label, credentials.host, Date.now(), remoteKey);
      });
      setSyncState(this.db, { lastPulledAt: pull.serverCursor });
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Sync failed.";
      // Best-effort: a failed sync never blocks playback/browsing — see the design spec's
      // "Error handling". The next periodic tick (or a manual triggerNow) retries.
    }
  }

  dispose(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }
}
```

`getCredentials` (from `main/credentials.ts`) returns an `XtreamCredentials` shaped `{ baseUrl, username, password }` already — matches Task 13's `SyncCredentialsLookup` exactly, so it's passed straight through with no adapter needed.

- [ ] **Step 3: Re-export Task 12/13's symbols from `packages/core/src/index.ts`** — add:

```ts
export { SyncClient, type SyncClientConfig, type AuthResult } from "./sync/client.js";
export { applyRemoteChanges, clearTombstones, collectLocalChanges, getSyncState, setSyncState, type SyncState, type SyncCredentialsLookup } from "./sync/localChanges.js";
export { generateSalt } from "./sync/credentialCrypto.js";
```

- [ ] **Step 4: Wire into `apps/desktop/src/main/ipc.ts`** — construct and dispose a `SyncController` alongside `PlaybackController` in `registerIpcHandlers`:

```ts
import { SyncController } from "./syncController.js";
```

```ts
  const sync = new SyncController(db);
  mainWindow.on("closed", () => sync.dispose());
```

Add a `sync:` namespace to the `api` object literal (immediately after `view:`):

```ts
    sync: {
      async status() {
        return sync.status();
      },
      async signUp(email: string, password: string) {
        return sync.signUp(email, password);
      },
      async signIn(email: string, password: string) {
        return sync.signIn(email, password);
      },
      async signOut() {
        return sync.signOut();
      },
      async triggerNow() {
        return sync.triggerNow();
      },
    },
```

- [ ] **Step 5: Wire into `apps/desktop/src/preload/index.ts`** — add to the `api` object:

```ts
  sync: {
    status: bind("sync.status"),
    signUp: bind("sync.signUp"),
    signIn: bind("sync.signIn"),
    signOut: bind("sync.signOut"),
    triggerNow: bind("sync.triggerNow"),
  },
```

- [ ] **Step 6: Add `@testcard/sync-schema` as a transitive dev convenience** — `apps/desktop/package.json` doesn't need a direct dependency (it only consumes `SyncStatus` types and `@testcard/core`'s re-exports), so no change needed here beyond what Tasks 7/12 already added to `packages/core`.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @testcard/desktop typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/main/syncController.ts apps/desktop/src/main/ipc.ts apps/desktop/src/preload/index.ts packages/core/src/index.ts
git commit -m "Wire sync.* IPC namespace: SyncController owns the account password + sync loop"
```

## Task 15: Desktop — Account screen

**Files:**
- Create: `apps/desktop/src/renderer/src/views/AccountView.tsx`
- Modify: wherever the Sidebar's pane-swap tabs are defined (the same file Phase 4b's "Movies"/"Series" tabs were added to — find it by searching the renderer for the existing `BrowseTab` union and the `"sources"` pane-swap case, per the Phase 4b plan's "Sidebar gains two top-level tabs" step)

**Interfaces:**
- Consumes: `window.testcard.sync.*` (Task 14), `SyncStatus` (Task 14)
- Produces: an "Account" entry reachable from the Sidebar, rendering `AccountView`.

- [ ] **Step 1: Write `apps/desktop/src/renderer/src/views/AccountView.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { SyncStatus } from "../../../shared/ipc.js";

/**
 * Sign up / sign in / sign out, plus current sync status. Deliberately minimal — this is the
 * account gate for device sync (see the design spec), not a settings page: it shows account
 * state and one manual "Sync now" action, nothing else.
 */
export function AccountView(): JSX.Element {
  const [status, setStatus] = useState<SyncStatus>({ account: "signed-out" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  useEffect(() => {
    window.testcard.sync.status().then(setStatus);
  }, []);

  async function handleSignIn(mode: "signIn" | "signUp"): Promise<void> {
    setBusy(true);
    setFormError(undefined);
    try {
      const result = mode === "signIn" ? await window.testcard.sync.signIn(email, password) : await window.testcard.sync.signUp(email, password);
      setStatus(result);
      setPassword("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    setBusy(true);
    setStatus(await window.testcard.sync.signOut());
    setBusy(false);
  }

  async function handleSyncNow(): Promise<void> {
    setBusy(true);
    setStatus(await window.testcard.sync.triggerNow());
    setBusy(false);
  }

  if (status.account === "signed-in") {
    return (
      <div className="account-view">
        <h2>Account</h2>
        <p>Signed in as {status.email}</p>
        <p>
          {status.lastSyncedAt ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : "Not yet synced"}
        </p>
        {status.lastError && <p className="account-view__error">{status.lastError}</p>}
        <button type="button" onClick={handleSyncNow} disabled={busy}>
          Sync now
        </button>
        <button type="button" onClick={handleSignOut} disabled={busy}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="account-view">
      <h2>Account</h2>
      <p>Sign in to sync watch progress, favourites, and sources across your devices.</p>
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
      <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
      {formError && <p className="account-view__error">{formError}</p>}
      <button type="button" onClick={() => handleSignIn("signIn")} disabled={busy || email === "" || password === ""}>
        Sign in
      </button>
      <button type="button" onClick={() => handleSignIn("signUp")} disabled={busy || email === "" || password === ""}>
        Create account
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add the Sidebar entry and pane-swap case** — locate the `BrowseTab` union and its pane-swap `switch`/conditional in `PlayerScreen` (extended by Phase 4b to include `"movies" | "series"`). Add `"account"` to that union, add an "Account" entry to the Sidebar's tab list, and add the render branch:

```tsx
      {activeTab === "account" && <AccountView />}
```

(The exact surrounding code depends on Phase 4b's final shape — follow its established pattern for adding a tab exactly, since this is the third feature to extend the same switch after `"guide"`/`"sources"` and `"movies"`/`"series"`.)

- [ ] **Step 3: Manual smoke test** — run `pnpm dev`, open the Account tab, sign up with a test email against a local `wrangler dev` instance of `apps/sync-worker` (point `TESTCARD_SYNC_URL` at `http://localhost:8787`), confirm the status view flips to "Signed in as ...".

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/views/AccountView.tsx
git commit -m "Add Account screen: sign up/in/out + manual sync trigger"
```

## Task 16: Hardware & manual verification checklist

**Files:** none — this task is verification only, no code changes.

- [ ] **Step 1: Two-device favourite round-trip.** On device A: sign up, favourite a movie. On device B (same account, same Xtream provider already configured): sign in, trigger sync, confirm the movie shows as favourited.

- [ ] **Step 2: Unfavourite propagates.** On device B, unfavourite that movie. On device A, trigger sync, confirm the favourite is gone (tombstone propagation, Task 6/13).

- [ ] **Step 3: Progress round-trip.** On device A, watch partway into a movie, let a progress checkpoint save, trigger sync. On device B, open the same movie, confirm "Resume from ..." reflects device A's position.

- [ ] **Step 4: Last-write-wins under a real conflict.** On device A, watch further into a movie without syncing yet. On device B (having already synced the earlier position), watch to an earlier point and sync first. Then sync device A. Confirm the furthest (most recently `updated_at`) position wins on both devices, not simply "whichever synced last" by wall-clock accident.

- [ ] **Step 5: Source credential sync.** Add an Xtream source on device A. Sign in on a device C that has never had that provider configured, trigger sync, confirm the source appears with working playback (decryption round-trip, Task 7/13/14).

- [ ] **Step 6: Lost-password behaviour.** Sign out and back in with a different (or reset) account password. Confirm previously-synced source credentials are not silently corrupted or half-decrypted — either they decrypt correctly (same password) or the source is absent until re-added (different password), never a partial/garbled credential.

- [ ] **Step 7: Offline resilience.** Disconnect network, toggle a favourite and trigger sync — confirm the app doesn't hang or crash, `SyncStatus.lastError` is set, and reconnecting + triggering again succeeds without duplicating any row.

- [ ] **Step 8: Regression pass.** Sign out entirely, confirm the app behaves exactly as it did before this plan (no sync-related UI, no background errors) — sync must be fully opt-in.
