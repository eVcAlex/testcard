# Phase 4b: VOD & Series Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browse/play/resume/watched-state support for Xtream movies and series (categories, poster grid, search, favourites, recently-watched, per-title playback position) alongside the existing live-TV player, with zero impact on M3U sources.

**Architecture:** `packages/core` gains a pure Xtream VOD/series adapter (`source/xtream/vod.ts`), diff-and-merge DB import for the bulk catalog plus lazy per-item detail/episode fetch, and read/write query modules — all framework-free and reused as-is by the renderer for pure helpers. `apps/desktop`'s main process wires these behind new `movies.*`/`series.*`/`progress.*` IPC namespaces and extends `PlaybackController` to resolve movie/episode stream URLs and persist playback position via the existing mpv IPC property-observation mechanism. The renderer adds `MoviesView`/`SeriesView` panes (mirroring `BrowseView`'s category-tree + grid + search pattern) reachable from two new Sidebar tabs and from a Live/Movies/Series switcher on Favourites/Recent.

**Tech Stack:** TypeScript, better-sqlite3 (WAL, FTS5), Electron (main/preload/renderer), React 18, @tanstack/react-query, vitest, mpv via JSON IPC over a named pipe.

**Spec:** docs/superpowers/specs/2026-09-14-vod-series-design.md

## Global Constraints

- Xtream-only — M3U sources get no Movies/Series UI; adapter functions throw if called with a non-xtream `Source`, mirroring `fetchShortEpg`/`buildStreamUrl` today.
- `SCHEMA_VERSION` 3 → 4, additive only (`CREATE TABLE IF NOT EXISTS`), no `ALTER` on any existing table.
- No DB-backed unit tests in `packages/core` — better-sqlite3's native binding is Electron's ABI, not plain Node's (see ADR 0003, ADR 0005). Only pure functions (DTO mappers, `isWatched`/`shouldPromptResume`, `pendingMigrations`) get unit tests; DB-touching code is verified via the Task 16 hardware checklist.
- No `ChannelVariant`-style quality grouping for movies/episodes — one title is one stream, one direct URL.
- A refresh never deletes movies/series/categories absent from the new fetch — same "diff-and-merge, `last_seen_at` bump, no silent favourite loss" rule as `importSource.ts`.
- A refresh resets `details_fetched_at` (movies) / `episodes_fetched_at` (series) to `NULL` on every touched row, so previously-fetched plot/duration/episode lists are re-fetched lazily next open.
- `packages/core` stays framework-free (no Electron/Node-only APIs) — the renderer imports pure helpers (`isWatched`, `shouldPromptResume`, domain types) from `@testcard/core` directly, same as it already imports `ChannelRow`.
- Follow this codebase's established conventions exactly: prepared-statement reuse inside a `db.transaction()`, `ON CONFLICT ... DO UPDATE SET excluded.*` upserts, subselect-based boolean/scalar columns (not joins) for `is_favourite`/`position_secs`/`watched` (mirrors `CHANNEL_COLUMNS`), readonly interfaces, no `any`, JSDoc comments explaining *why*.

---

## Task 1: Schema — `SCHEMA_VERSION` 3 → 4

**Files:**
- Modify: `packages/core/src/db/schema.ts` (bump `SCHEMA_VERSION`, extend `SCHEMA_SQL`)
- Modify: `packages/core/src/db/migrations.ts` (append version-4 migration)
- Test: `packages/core/src/__tests__/migrations.test.ts` (no code change expected — verify only, see Step 3)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: the `movie_categories`, `movies`, `movies_fts` (+ triggers), `series_categories`, `series`, `series_fts` (+ triggers), `seasons`, `episodes`, `movie_favourites`, `movie_recents`, `series_favourites`, `series_recents`, `playback_progress` tables, on both a fresh DB (`SCHEMA_SQL`) and an upgraded one (migration v4). `SCHEMA_VERSION = 4` (exported `number`).

- [ ] **Step 1: Bump `SCHEMA_VERSION` and extend `SCHEMA_SQL`** — in `packages/core/src/db/schema.ts`, change line 16 to `export const SCHEMA_VERSION = 4;`, then insert the block below into the `SCHEMA_SQL` template string immediately before the final `CREATE TABLE IF NOT EXISTS schema_meta (` block:

```sql
CREATE TABLE IF NOT EXISTS movie_categories (
  id            TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  provider_id   TEXT NOT NULL,
  raw_name      TEXT NOT NULL,
  country       TEXT
);
CREATE INDEX IF NOT EXISTS idx_movie_categories_source ON movie_categories(source_id);

CREATE TABLE IF NOT EXISTS movies (
  id                  TEXT PRIMARY KEY,   -- idFor(source.id, vod stream_id)
  source_id           TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  category_id         TEXT NOT NULL REFERENCES movie_categories(id) ON DELETE CASCADE,
  provider_stream_id  TEXT NOT NULL,
  name                TEXT NOT NULL,
  poster_url          TEXT,
  container_extension TEXT,               -- from get_vod_streams; builds the stream URL
  rating              TEXT,
  plot                TEXT,                -- NULL until lazily fetched
  duration_secs       INTEGER,             -- NULL until lazily fetched
  details_fetched_at  INTEGER,             -- NULL = never fetched or refresh invalidated it
  first_seen_at       INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movies_category ON movies(category_id);

CREATE VIRTUAL TABLE IF NOT EXISTS movies_fts USING fts5(name, content='movies', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS movies_fts_insert AFTER INSERT ON movies BEGIN
  INSERT INTO movies_fts(rowid, name) VALUES (new.rowid, new.name);
END;

CREATE TRIGGER IF NOT EXISTS movies_fts_delete AFTER DELETE ON movies BEGIN
  INSERT INTO movies_fts(movies_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
END;

CREATE TRIGGER IF NOT EXISTS movies_fts_update AFTER UPDATE ON movies BEGIN
  INSERT INTO movies_fts(movies_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
  INSERT INTO movies_fts(rowid, name) VALUES (new.rowid, new.name);
END;

CREATE TABLE IF NOT EXISTS series_categories (
  id            TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  provider_id   TEXT NOT NULL,
  raw_name      TEXT NOT NULL,
  country       TEXT
);
CREATE INDEX IF NOT EXISTS idx_series_categories_source ON series_categories(source_id);

CREATE TABLE IF NOT EXISTS series (
  id                   TEXT PRIMARY KEY,  -- idFor(source.id, series_id)
  source_id            TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  category_id          TEXT NOT NULL REFERENCES series_categories(id) ON DELETE CASCADE,
  provider_series_id   TEXT NOT NULL,
  name                 TEXT NOT NULL,
  poster_url           TEXT,
  rating               TEXT,
  plot                 TEXT,               -- cheap: Xtream's get_series list DTO includes this
  episodes_fetched_at  INTEGER,            -- NULL = seasons/episodes never fetched or stale
  first_seen_at        INTEGER NOT NULL,
  last_seen_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_series_category ON series(category_id);

CREATE VIRTUAL TABLE IF NOT EXISTS series_fts USING fts5(name, content='series', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS series_fts_insert AFTER INSERT ON series BEGIN
  INSERT INTO series_fts(rowid, name) VALUES (new.rowid, new.name);
END;

CREATE TRIGGER IF NOT EXISTS series_fts_delete AFTER DELETE ON series BEGIN
  INSERT INTO series_fts(series_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
END;

CREATE TRIGGER IF NOT EXISTS series_fts_update AFTER UPDATE ON series BEGIN
  INSERT INTO series_fts(series_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
  INSERT INTO series_fts(rowid, name) VALUES (new.rowid, new.name);
END;

CREATE TABLE IF NOT EXISTS seasons (
  id            TEXT PRIMARY KEY,   -- idFor(series.id, season_number)
  series_id     TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  name          TEXT,
  poster_url    TEXT
);
CREATE INDEX IF NOT EXISTS idx_seasons_series ON seasons(series_id);

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

- [ ] **Step 2: Append the version-4 migration** — in `packages/core/src/db/migrations.ts`, add a new entry to the `MIGRATIONS` array (after the `version: 3` entry, before the closing `];`), using `db.exec` with the *identical* SQL block from Step 1 (a migrating database needs the same tables a fresh one gets from `SCHEMA_SQL`):

```ts
  {
    version: 4,
    up: (db) => {
      // Phase 4b — VOD & series catalog, lazy per-item detail fetch, playback progress.
      // All-new tables (CREATE TABLE IF NOT EXISTS), no ALTER on any existing table — see
      // the design spec's "Data model". Identical SQL to schema.ts's SCHEMA_SQL addition.
      db.exec(`
        CREATE TABLE IF NOT EXISTS movie_categories (
          id            TEXT PRIMARY KEY,
          source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
          provider_id   TEXT NOT NULL,
          raw_name      TEXT NOT NULL,
          country       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_movie_categories_source ON movie_categories(source_id);

        CREATE TABLE IF NOT EXISTS movies (
          id                  TEXT PRIMARY KEY,
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

        CREATE VIRTUAL TABLE IF NOT EXISTS movies_fts USING fts5(name, content='movies', content_rowid='rowid');

        CREATE TRIGGER IF NOT EXISTS movies_fts_insert AFTER INSERT ON movies BEGIN
          INSERT INTO movies_fts(rowid, name) VALUES (new.rowid, new.name);
        END;
        CREATE TRIGGER IF NOT EXISTS movies_fts_delete AFTER DELETE ON movies BEGIN
          INSERT INTO movies_fts(movies_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
        END;
        CREATE TRIGGER IF NOT EXISTS movies_fts_update AFTER UPDATE ON movies BEGIN
          INSERT INTO movies_fts(movies_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
          INSERT INTO movies_fts(rowid, name) VALUES (new.rowid, new.name);
        END;

        CREATE TABLE IF NOT EXISTS series_categories (
          id            TEXT PRIMARY KEY,
          source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
          provider_id   TEXT NOT NULL,
          raw_name      TEXT NOT NULL,
          country       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_series_categories_source ON series_categories(source_id);

        CREATE TABLE IF NOT EXISTS series (
          id                   TEXT PRIMARY KEY,
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

        CREATE VIRTUAL TABLE IF NOT EXISTS series_fts USING fts5(name, content='series', content_rowid='rowid');

        CREATE TRIGGER IF NOT EXISTS series_fts_insert AFTER INSERT ON series BEGIN
          INSERT INTO series_fts(rowid, name) VALUES (new.rowid, new.name);
        END;
        CREATE TRIGGER IF NOT EXISTS series_fts_delete AFTER DELETE ON series BEGIN
          INSERT INTO series_fts(series_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
        END;
        CREATE TRIGGER IF NOT EXISTS series_fts_update AFTER UPDATE ON series BEGIN
          INSERT INTO series_fts(series_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
          INSERT INTO series_fts(rowid, name) VALUES (new.rowid, new.name);
        END;

        CREATE TABLE IF NOT EXISTS seasons (
          id            TEXT PRIMARY KEY,
          series_id     TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
          season_number INTEGER NOT NULL,
          name          TEXT,
          poster_url    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_seasons_series ON seasons(series_id);

        CREATE TABLE IF NOT EXISTS episodes (
          id                   TEXT PRIMARY KEY,
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
      `);
    },
  },
```

- [ ] **Step 3: Verify the migration test needs no change** — `packages/core/src/__tests__/migrations.test.ts`'s `"is contiguous from version 2 and ends at SCHEMA_VERSION"` test computes the expected version list as `Array.from({ length: versions.length }, (_, i) => i + 2)` and compares `versions.at(-1)` to the imported `SCHEMA_VERSION`. Appending a `version: 4` entry (contiguous after `version: 3`) and bumping `SCHEMA_VERSION` to `4` in Step 1 satisfies both assertions automatically — run `pnpm --filter @testcard/core test` after Steps 1–2 to confirm, but make no edit to this file.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/db/migrations.ts
git commit -m "Add Phase 4b schema: movies/series catalog, seasons/episodes, playback_progress"
```

## Task 2: Domain types — `Movie`, `Series`, `Season`, `Episode`

**Files:**
- Modify: `packages/core/src/source/types.ts` (append after the `SourceAdapter` interface, end of file)

**Interfaces:**
- Consumes: nothing new (reuses the existing `Category`, `Source` types already in this file — movie/series categories have the same shape as `Category` so they reuse it directly rather than getting their own type)
- Produces: `Movie`, `Series`, `Season`, `Episode` (readonly interfaces), used by Tasks 3–10.

- [ ] **Step 1: Append the four interfaces** to the end of `packages/core/src/source/types.ts`:

```ts

/**
 * A movie as listed by Xtream's `get_vod_streams` — Xtream-only (see Scope), so this lives
 * outside `SourceAdapter`. `plot`/`durationSecs` are deliberately absent: that bulk list call
 * doesn't return them (see the design spec's "Import strategy" — they're a lazy per-item fetch).
 */
export interface Movie {
  readonly id: string;
  readonly sourceId: string;
  readonly categoryId: string;
  readonly providerStreamId: string;
  readonly name: string;
  readonly posterUrl?: string;
  /** From `get_vod_streams`; some Xtream panels omit it — see the container_extension fallback. */
  readonly containerExtension?: string;
  readonly rating?: string;
}

/**
 * A TV series as listed by Xtream's `get_series`. Unlike `Movie`, `plot` is cheap here — the
 * list DTO includes it, so it's not part of the lazy per-item fetch.
 */
export interface Series {
  readonly id: string;
  readonly sourceId: string;
  readonly categoryId: string;
  readonly providerSeriesId: string;
  readonly name: string;
  readonly posterUrl?: string;
  readonly rating?: string;
  readonly plot?: string;
}

/** One season of a Series, from the lazy `get_series_info` fetch (see `fetchSeriesDetails`). */
export interface Season {
  readonly id: string;
  readonly seriesId: string;
  readonly seasonNumber: number;
  readonly name?: string;
  readonly posterUrl?: string;
}

/** One episode of a Season, from the lazy `get_series_info` fetch. */
export interface Episode {
  readonly id: string;
  readonly seasonId: string;
  readonly seriesId: string;
  readonly providerEpisodeId: string;
  readonly episodeNumber: number;
  readonly name: string;
  readonly containerExtension?: string;
  readonly durationSecs?: number;
  readonly plot?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/source/types.ts
git commit -m "Add Movie/Series/Season/Episode domain types"
```

## Task 3: Xtream VOD/series adapter

**Files:**
- Create: `packages/core/src/source/xtream/vod.ts`
- Test: `packages/core/src/__tests__/vod.test.ts`

**Interfaces:**
- Consumes: `Category`, `Source`, `Movie`, `Series`, `Season`, `Episode` (Task 2); `CredentialsLookup` from `packages/core/src/source/xtream/client.ts` (existing, `export type CredentialsLookup = (sourceId: string) => Promise<XtreamCredentials>`)
- Produces: `fetchVodCategories(source, getCredentials): Promise<Category[]>`, `fetchMovies(source, category, getCredentials): Promise<Movie[]>`, `fetchSeriesCategories(source, getCredentials): Promise<Category[]>`, `fetchSeriesList(source, category, getCredentials): Promise<Series[]>`, `fetchSeriesDetails(source, series, getCredentials): Promise<{ seasons: Season[]; episodes: Episode[] }>`, `fetchVodDetails(source, movie: Pick<Movie, "providerStreamId">, getCredentials): Promise<{ plot?: string; durationSecs?: number; containerExtension?: string }>`, `buildMovieStreamUrl(source, movie: Pick<Movie, "providerStreamId" | "containerExtension">, getCredentials): Promise<string>`, `buildEpisodeStreamUrl(source, episode: Pick<Episode, "providerEpisodeId" | "containerExtension">, getCredentials): Promise<string>`, plus pure exported mappers `mapMovieDto`, `mapSeriesDto`, `mapSeriesDetailsDto` (used by Tasks 4–5 indirectly and directly by this task's test).

Design notes carried over from reading `client.ts`/`detect.ts` first: `idFor` is a tiny private one-liner in `client.ts` (not exported), so it's redefined identically here rather than exported cross-file for one helper. Unlike `fetchShortEpg`'s EPG text fields, Xtream's `get_series`/`get_vod_streams`/`get_series_info`/`get_vod_info` DTOs are plain text — no `base64Decode` needed. `buildMovieStreamUrl`/`buildEpisodeStreamUrl` take a `Pick<...>` of the domain type (mirroring `buildStreamUrl(source, variant: ChannelVariant)` taking just the variant) rather than a full `Movie`/`Episode`, so callers building a stream URL don't need to round-trip an entire row. `fetchVodDetails`'s return type includes `containerExtension` (beyond the spec's abbreviated `{ plot?, durationSecs? }`) because `get_vod_info`'s `movie_data.container_extension` is the documented fallback source for a missing bulk-import value (design spec, "Import strategy") — reusing the one `get_vod_info` call this function already makes, rather than adding a second network call.

- [ ] **Step 1: Write the adapter file** at `packages/core/src/source/xtream/vod.ts`:

```ts
import type { Category, Episode, Movie, Season, Series, Source } from "../types.js";
import type { CredentialsLookup } from "./client.js";

/**
 * VOD/series methods live outside `SourceAdapter` — Xtream-only, so there's no M3U
 * implementation to require. Same precedent as `fetchShortEpg` in `client.ts`: each function
 * takes `getCredentials` explicitly rather than closing over it, since these are read on
 * demand (bulk import, or a lazy per-item open) rather than as part of the adapter contract.
 */

interface XtreamCategoryDTO {
  readonly category_id: string;
  readonly category_name: string;
}

interface XtreamVodStreamDTO {
  readonly stream_id: number;
  readonly name: string;
  readonly category_id: string;
  readonly stream_icon?: string;
  readonly container_extension?: string;
  readonly rating?: string | number;
}

interface XtreamSeriesListDTO {
  readonly series_id: number;
  readonly name: string;
  readonly category_id: string;
  readonly cover?: string;
  readonly plot?: string;
  readonly rating?: string | number;
}

interface XtreamSeasonDTO {
  readonly season_number: number;
  readonly name?: string;
  readonly cover?: string;
}

interface XtreamEpisodeInfoDTO {
  readonly duration_secs?: number | string;
  readonly plot?: string;
}

interface XtreamEpisodeDTO {
  readonly id: number | string;
  readonly episode_num: number;
  readonly title: string;
  readonly container_extension?: string;
  readonly season: number;
  readonly info?: XtreamEpisodeInfoDTO;
}

interface XtreamSeriesInfoDTO {
  readonly seasons?: readonly XtreamSeasonDTO[];
  readonly episodes?: Record<string, readonly XtreamEpisodeDTO[]>;
}

interface XtreamVodInfoDTO {
  readonly info?: { readonly plot?: string; readonly duration_secs?: number | string };
  readonly movie_data?: { readonly container_extension?: string };
}

function idFor(...parts: string[]): string {
  return parts.join(":");
}

function toFiniteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function call<T>(
  source: Source,
  action: string,
  params: Record<string, string>,
  getCredentials: CredentialsLookup,
): Promise<T> {
  if (source.kind !== "xtream") throw new Error(`Xtream VOD/series call used with a non-xtream source: ${source.kind}`);
  const credentials = await getCredentials(source.id);
  const url = new URL(`${credentials.baseUrl}/player_api.php`);
  url.searchParams.set("username", credentials.username);
  url.searchParams.set("password", credentials.password);
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Xtream ${action} failed: HTTP ${response.status}`);
  return (await response.json()) as T;
}

function mapCategoryDto(dto: XtreamCategoryDTO, source: Source): Category {
  return { id: idFor(source.id, dto.category_id), sourceId: source.id, providerId: dto.category_id, rawName: dto.category_name };
}

/** Pure DTO mapper — exported so Task 3's test exercises it without mocking `fetch`. */
export function mapMovieDto(dto: XtreamVodStreamDTO, source: Source, category: Category): Movie {
  return {
    id: idFor(source.id, String(dto.stream_id)),
    sourceId: source.id,
    categoryId: category.id,
    providerStreamId: String(dto.stream_id),
    name: dto.name,
    ...(dto.stream_icon !== undefined && dto.stream_icon !== "" ? { posterUrl: dto.stream_icon } : {}),
    ...(dto.container_extension !== undefined && dto.container_extension !== "" ? { containerExtension: dto.container_extension } : {}),
    ...(dto.rating !== undefined && String(dto.rating) !== "" && String(dto.rating) !== "0" ? { rating: String(dto.rating) } : {}),
  };
}

/** Pure DTO mapper — exported so Task 3's test exercises it without mocking `fetch`. */
export function mapSeriesDto(dto: XtreamSeriesListDTO, source: Source, category: Category): Series {
  return {
    id: idFor(source.id, String(dto.series_id)),
    sourceId: source.id,
    categoryId: category.id,
    providerSeriesId: String(dto.series_id),
    name: dto.name,
    ...(dto.cover !== undefined && dto.cover !== "" ? { posterUrl: dto.cover } : {}),
    ...(dto.rating !== undefined && String(dto.rating) !== "" && String(dto.rating) !== "0" ? { rating: String(dto.rating) } : {}),
    ...(dto.plot !== undefined && dto.plot !== "" ? { plot: dto.plot } : {}),
  };
}

/** Pure DTO mapper — exported so Task 3's test exercises it without mocking `fetch`. */
export function mapSeriesDetailsDto(dto: XtreamSeriesInfoDTO, series: Series): { seasons: Season[]; episodes: Episode[] } {
  const seasons: Season[] = (dto.seasons ?? []).map((s) => ({
    id: idFor(series.id, String(s.season_number)),
    seriesId: series.id,
    seasonNumber: s.season_number,
    ...(s.name !== undefined && s.name !== "" ? { name: s.name } : {}),
    ...(s.cover !== undefined && s.cover !== "" ? { posterUrl: s.cover } : {}),
  }));

  const episodes: Episode[] = Object.values(dto.episodes ?? {})
    .flat()
    .map((e) => {
      const seasonId = idFor(series.id, String(e.season));
      const durationSecs = toFiniteNumber(e.info?.duration_secs);
      return {
        id: idFor(seasonId, String(e.id)),
        seasonId,
        seriesId: series.id,
        providerEpisodeId: String(e.id),
        episodeNumber: e.episode_num,
        name: e.title,
        ...(e.container_extension !== undefined && e.container_extension !== "" ? { containerExtension: e.container_extension } : {}),
        ...(durationSecs !== undefined ? { durationSecs } : {}),
        ...(e.info?.plot !== undefined && e.info.plot !== "" ? { plot: e.info.plot } : {}),
      };
    });

  return { seasons, episodes };
}

export async function fetchVodCategories(source: Source, getCredentials: CredentialsLookup): Promise<Category[]> {
  const dtos = await call<XtreamCategoryDTO[]>(source, "get_vod_categories", {}, getCredentials);
  return dtos.map((dto) => mapCategoryDto(dto, source));
}

export async function fetchMovies(source: Source, category: Category, getCredentials: CredentialsLookup): Promise<Movie[]> {
  const dtos = await call<XtreamVodStreamDTO[]>(source, "get_vod_streams", { category_id: category.providerId }, getCredentials);
  return dtos.map((dto) => mapMovieDto(dto, source, category));
}

export async function fetchSeriesCategories(source: Source, getCredentials: CredentialsLookup): Promise<Category[]> {
  const dtos = await call<XtreamCategoryDTO[]>(source, "get_series_categories", {}, getCredentials);
  return dtos.map((dto) => mapCategoryDto(dto, source));
}

export async function fetchSeriesList(source: Source, category: Category, getCredentials: CredentialsLookup): Promise<Series[]> {
  const dtos = await call<XtreamSeriesListDTO[]>(source, "get_series", { category_id: category.providerId }, getCredentials);
  return dtos.map((dto) => mapSeriesDto(dto, source, category));
}

/** `get_series_info` — one API call per series. Called lazily; see `db/importVodDetails.ts`. */
export async function fetchSeriesDetails(
  source: Source,
  series: Series,
  getCredentials: CredentialsLookup,
): Promise<{ seasons: Season[]; episodes: Episode[] }> {
  const dto = await call<XtreamSeriesInfoDTO>(source, "get_series_info", { series_id: series.providerSeriesId }, getCredentials);
  return mapSeriesDetailsDto(dto, series);
}

/**
 * `get_vod_info` — plot/duration, plus (as a fallback source only) `container_extension` for
 * panels that omit it from the cheap bulk `get_vod_streams` call. Called lazily; see
 * `db/importVodDetails.ts`.
 */
export async function fetchVodDetails(
  source: Source,
  movie: Pick<Movie, "providerStreamId">,
  getCredentials: CredentialsLookup,
): Promise<{ plot?: string; durationSecs?: number; containerExtension?: string }> {
  const dto = await call<XtreamVodInfoDTO>(source, "get_vod_info", { vod_id: movie.providerStreamId }, getCredentials);
  const durationSecs = toFiniteNumber(dto.info?.duration_secs);
  return {
    ...(dto.info?.plot !== undefined && dto.info.plot !== "" ? { plot: dto.info.plot } : {}),
    ...(durationSecs !== undefined ? { durationSecs } : {}),
    ...(dto.movie_data?.container_extension !== undefined && dto.movie_data.container_extension !== ""
      ? { containerExtension: dto.movie_data.container_extension }
      : {}),
  };
}

export async function buildMovieStreamUrl(
  source: Source,
  movie: Pick<Movie, "providerStreamId" | "containerExtension">,
  getCredentials: CredentialsLookup,
): Promise<string> {
  if (source.kind !== "xtream") throw new Error("buildMovieStreamUrl used with a non-xtream source");
  const credentials = await getCredentials(source.id);
  const ext = movie.containerExtension && movie.containerExtension.length > 0 ? movie.containerExtension : "mp4";
  return `${credentials.baseUrl}/movie/${credentials.username}/${credentials.password}/${movie.providerStreamId}.${ext}`;
}

export async function buildEpisodeStreamUrl(
  source: Source,
  episode: Pick<Episode, "providerEpisodeId" | "containerExtension">,
  getCredentials: CredentialsLookup,
): Promise<string> {
  if (source.kind !== "xtream") throw new Error("buildEpisodeStreamUrl used with a non-xtream source");
  const credentials = await getCredentials(source.id);
  const ext = episode.containerExtension && episode.containerExtension.length > 0 ? episode.containerExtension : "mp4";
  return `${credentials.baseUrl}/series/${credentials.username}/${credentials.password}/${episode.providerEpisodeId}.${ext}`;
}
```

- [ ] **Step 2: Write the pure-function test** at `packages/core/src/__tests__/vod.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapMovieDto, mapSeriesDetailsDto, mapSeriesDto } from "../source/xtream/vod.js";
import type { Category, Series, Source } from "../source/types.js";

const source: Source = { id: "src1", kind: "xtream", name: "Test", baseUrl: "http://example.com" };
const movieCategory: Category = { id: "src1:10", sourceId: "src1", providerId: "10", rawName: "Action" };
const seriesCategory: Category = { id: "src1:20", sourceId: "src1", providerId: "20", rawName: "Drama" };

describe("mapMovieDto", () => {
  it("maps a get_vod_streams entry to a Movie", () => {
    const movie = mapMovieDto(
      { stream_id: 501, name: "Test Movie", category_id: "10", stream_icon: "http://x/poster.jpg", container_extension: "mkv", rating: "7.5" },
      source,
      movieCategory,
    );
    expect(movie).toEqual({
      id: "src1:501",
      sourceId: "src1",
      categoryId: "src1:10",
      providerStreamId: "501",
      name: "Test Movie",
      posterUrl: "http://x/poster.jpg",
      containerExtension: "mkv",
      rating: "7.5",
    });
  });

  it("omits optional fields the provider left blank", () => {
    const movie = mapMovieDto({ stream_id: 502, name: "Bare Movie", category_id: "10" }, source, movieCategory);
    expect(movie).toEqual({
      id: "src1:502",
      sourceId: "src1",
      categoryId: "src1:10",
      providerStreamId: "502",
      name: "Bare Movie",
    });
  });
});

describe("mapSeriesDto", () => {
  it("maps a get_series entry to a Series, including its cheap plot", () => {
    const series = mapSeriesDto(
      { series_id: 900, name: "Test Show", category_id: "20", cover: "http://x/cover.jpg", plot: "A show.", rating: "9" },
      source,
      seriesCategory,
    );
    expect(series).toEqual({
      id: "src1:900",
      sourceId: "src1",
      categoryId: "src1:20",
      providerSeriesId: "900",
      name: "Test Show",
      posterUrl: "http://x/cover.jpg",
      rating: "9",
      plot: "A show.",
    });
  });
});

describe("mapSeriesDetailsDto", () => {
  const series: Series = { id: "src1:900", sourceId: "src1", categoryId: "src1:20", providerSeriesId: "900", name: "Test Show" };

  it("maps get_series_info seasons and episodes, keyed by season number", () => {
    const { seasons, episodes } = mapSeriesDetailsDto(
      {
        seasons: [{ season_number: 1, name: "Season 1", cover: "http://x/s1.jpg" }],
        episodes: {
          "1": [
            { id: 1001, episode_num: 1, title: "Pilot", container_extension: "mp4", season: 1, info: { duration_secs: 1500, plot: "The pilot." } },
            { id: 1002, episode_num: 2, title: "Episode 2", season: 1 },
          ],
        },
      },
      series,
    );

    expect(seasons).toEqual([{ id: "src1:900:1", seriesId: "src1:900", seasonNumber: 1, name: "Season 1", posterUrl: "http://x/s1.jpg" }]);
    expect(episodes).toEqual([
      {
        id: "src1:900:1:1001",
        seasonId: "src1:900:1",
        seriesId: "src1:900",
        providerEpisodeId: "1001",
        episodeNumber: 1,
        name: "Pilot",
        containerExtension: "mp4",
        durationSecs: 1500,
        plot: "The pilot.",
      },
      {
        id: "src1:900:1:1002",
        seasonId: "src1:900:1",
        seriesId: "src1:900",
        providerEpisodeId: "1002",
        episodeNumber: 2,
        name: "Episode 2",
      },
    ]);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/source/xtream/vod.ts packages/core/src/__tests__/vod.test.ts
git commit -m "Add Xtream VOD/series adapter with pure DTO-mapper tests"
```

## Task 4: DB import — movies & series list (bulk, on Refresh)

**Files:**
- Create: `packages/core/src/db/importVod.ts`
- Create: `packages/core/src/db/importSeries.ts`

**Interfaces:**
- Consumes: `fetchVodCategories`, `fetchMovies`, `fetchSeriesCategories`, `fetchSeriesList` (Task 3); `CredentialsLookup` (existing, `client.ts`); `parseName` (existing, `packages/core/src/normalise/parseName.ts`); `Category`, `Movie`, `Series`, `Source` (Task 2/existing)
- Produces: `importVod(db, source, getCredentials): Promise<{ categories: number; movies: number; durationMs: number }>`, `importSeries(db, source, getCredentials): Promise<{ categories: number; series: number; durationMs: number }>` — both consumed by Task 8's `refreshSource()`.

- [ ] **Step 1: Write `packages/core/src/db/importVod.ts`**, mirroring `importSource.ts`'s diff-and-merge transaction pattern:

```ts
import type Database from "better-sqlite3";
import { parseName } from "../normalise/parseName.js";
import type { CredentialsLookup } from "../source/xtream/client.js";
import { fetchMovies, fetchVodCategories } from "../source/xtream/vod.js";
import type { Category, Movie, Source } from "../source/types.js";

/**
 * Imports (or re-imports) an Xtream source's full movie catalog: `get_vod_categories` +
 * `get_vod_streams` per category — same cost profile as live channel import. Diff-and-merge by
 * stable id (mirrors `importSource.ts`), never destructive — favourites/recents/progress
 * survive a refresh since ids stay stable. Every touched row has `details_fetched_at` reset to
 * NULL: title/poster/category data is refreshed in place, but any previously lazily-fetched
 * plot/duration is now presumed stale and re-fetched next time the title is opened.
 */
export async function importVod(
  db: Database.Database,
  source: Source,
  getCredentials: CredentialsLookup,
): Promise<{ categories: number; movies: number; durationMs: number }> {
  const startedAt = Date.now();
  const now = Date.now();

  const categories = await fetchVodCategories(source, getCredentials);

  const upsertCategory = db.prepare(`
    INSERT INTO movie_categories (id, source_id, provider_id, raw_name, country)
    VALUES (@id, @sourceId, @providerId, @rawName, @country)
    ON CONFLICT(id) DO UPDATE SET raw_name = excluded.raw_name, country = excluded.country
  `);
  function categoryParams(category: Category) {
    return { ...category, country: parseName(category.rawName).country ?? null };
  }

  const upsertMovie = db.prepare(`
    INSERT INTO movies (
      id, source_id, category_id, provider_stream_id, name, poster_url,
      container_extension, rating, first_seen_at, last_seen_at
    ) VALUES (
      @id, @sourceId, @categoryId, @providerStreamId, @name, @posterUrl,
      @containerExtension, @rating, @firstSeenAt, @lastSeenAt
    )
    ON CONFLICT(id) DO UPDATE SET
      category_id          = excluded.category_id,
      provider_stream_id   = excluded.provider_stream_id,
      name                 = excluded.name,
      poster_url           = excluded.poster_url,
      container_extension  = excluded.container_extension,
      rating               = excluded.rating,
      details_fetched_at   = NULL,
      last_seen_at         = excluded.last_seen_at
  `);

  // Pages are drained into memory first — better-sqlite3 has no async transaction support,
  // same reasoning as importSource.ts.
  const pages: { category: Category; movies: readonly Movie[] }[] = [];
  for (const category of categories) {
    pages.push({ category, movies: await fetchMovies(source, category, getCredentials) });
  }

  let movieCount = 0;
  const applyAll = db.transaction(() => {
    for (const page of pages) {
      upsertCategory.run(categoryParams(page.category));
      for (const movie of page.movies) {
        upsertMovie.run({
          id: movie.id,
          sourceId: movie.sourceId,
          categoryId: movie.categoryId,
          providerStreamId: movie.providerStreamId,
          name: movie.name,
          posterUrl: movie.posterUrl ?? null,
          containerExtension: movie.containerExtension ?? null,
          rating: movie.rating ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
        });
        movieCount += 1;
      }
    }
  });

  // Not deleting movies absent from this refresh — same rationale as importSource.ts:
  // last_seen_at records presence without ever silently dropping a favourite.
  applyAll();

  return { categories: categories.length, movies: movieCount, durationMs: Date.now() - startedAt };
}
```

- [ ] **Step 2: Write `packages/core/src/db/importSeries.ts`**, the same shape with `plot` carried through and `episodes_fetched_at` reset instead of `details_fetched_at`:

```ts
import type Database from "better-sqlite3";
import { parseName } from "../normalise/parseName.js";
import type { CredentialsLookup } from "../source/xtream/client.js";
import { fetchSeriesCategories, fetchSeriesList } from "../source/xtream/vod.js";
import type { Category, Series, Source } from "../source/types.js";

/**
 * Imports (or re-imports) an Xtream source's full series catalog: `get_series_categories` +
 * `get_series` per category. Same diff-and-merge shape as `importVod.ts`. Every touched row has
 * `episodes_fetched_at` reset to NULL — a previously-fetched season/episode list is now presumed
 * stale and re-fetched lazily next time the series is opened (see `importVodDetails.ts`).
 */
export async function importSeries(
  db: Database.Database,
  source: Source,
  getCredentials: CredentialsLookup,
): Promise<{ categories: number; series: number; durationMs: number }> {
  const startedAt = Date.now();
  const now = Date.now();

  const categories = await fetchSeriesCategories(source, getCredentials);

  const upsertCategory = db.prepare(`
    INSERT INTO series_categories (id, source_id, provider_id, raw_name, country)
    VALUES (@id, @sourceId, @providerId, @rawName, @country)
    ON CONFLICT(id) DO UPDATE SET raw_name = excluded.raw_name, country = excluded.country
  `);
  function categoryParams(category: Category) {
    return { ...category, country: parseName(category.rawName).country ?? null };
  }

  const upsertSeries = db.prepare(`
    INSERT INTO series (
      id, source_id, category_id, provider_series_id, name, poster_url,
      rating, plot, first_seen_at, last_seen_at
    ) VALUES (
      @id, @sourceId, @categoryId, @providerSeriesId, @name, @posterUrl,
      @rating, @plot, @firstSeenAt, @lastSeenAt
    )
    ON CONFLICT(id) DO UPDATE SET
      category_id         = excluded.category_id,
      provider_series_id  = excluded.provider_series_id,
      name                = excluded.name,
      poster_url          = excluded.poster_url,
      rating              = excluded.rating,
      plot                = excluded.plot,
      episodes_fetched_at = NULL,
      last_seen_at        = excluded.last_seen_at
  `);

  const pages: { category: Category; series: readonly Series[] }[] = [];
  for (const category of categories) {
    pages.push({ category, series: await fetchSeriesList(source, category, getCredentials) });
  }

  let seriesCount = 0;
  const applyAll = db.transaction(() => {
    for (const page of pages) {
      upsertCategory.run(categoryParams(page.category));
      for (const series of page.series) {
        upsertSeries.run({
          id: series.id,
          sourceId: series.sourceId,
          categoryId: series.categoryId,
          providerSeriesId: series.providerSeriesId,
          name: series.name,
          posterUrl: series.posterUrl ?? null,
          rating: series.rating ?? null,
          plot: series.plot ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
        });
        seriesCount += 1;
      }
    }
  });

  applyAll();

  return { categories: categories.length, series: seriesCount, durationMs: Date.now() - startedAt };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/db/importVod.ts packages/core/src/db/importSeries.ts
git commit -m "Add bulk movie/series catalog import"
```

## Task 5: DB import — lazy per-series/per-movie detail fetch

**Files:**
- Create: `packages/core/src/db/importVodDetails.ts`

**Interfaces:**
- Consumes: `fetchSeriesDetails`, `fetchVodDetails` (Task 3); `CredentialsLookup` (existing); `Series`, `Source`, `Movie` (Task 2/existing)
- Produces: `ensureMovieDetails(db, source, movieId, getCredentials): Promise<void>`, `ensureSeriesEpisodes(db, source, seriesId, getCredentials): Promise<void>` — both consumed by Task 8's IPC handlers and Task 10's `PlaybackController`.

This task is self-contained (does its own row `SELECT`s) rather than depending on Task 6's query functions, since Task 6 comes after it in the required decomposition order.

- [ ] **Step 1: Write `packages/core/src/db/importVodDetails.ts`**:

```ts
import type Database from "better-sqlite3";
import type { CredentialsLookup } from "../source/xtream/client.js";
import { fetchSeriesDetails, fetchVodDetails } from "../source/xtream/vod.js";
import type { Movie, Series, Source } from "../source/types.js";

/**
 * Lazily fetches (and caches) a movie's plot/duration via `get_vod_info` — a no-op if already
 * fetched (`details_fetched_at` non-null; a refresh resets it to NULL, see `importVod.ts`).
 * Also backfills `container_extension` when the cheap bulk `get_vod_streams` import didn't
 * supply one (some Xtream panels omit it there) — see the design spec's "Import strategy".
 */
export async function ensureMovieDetails(
  db: Database.Database,
  source: Source,
  movieId: string,
  getCredentials: CredentialsLookup,
): Promise<void> {
  const row = db
    .prepare(
      `SELECT provider_stream_id AS providerStreamId, details_fetched_at AS detailsFetchedAt
       FROM movies WHERE id = ?`,
    )
    .get(movieId) as { providerStreamId: string; detailsFetchedAt: number | null } | undefined;
  if (!row || row.detailsFetchedAt !== null) return;

  const movie: Pick<Movie, "providerStreamId"> = { providerStreamId: row.providerStreamId };
  const details = await fetchVodDetails(source, movie, getCredentials);

  db.prepare(
    `UPDATE movies SET
       plot                = COALESCE(?, plot),
       duration_secs       = COALESCE(?, duration_secs),
       container_extension = COALESCE(?, container_extension),
       details_fetched_at  = ?
     WHERE id = ?`,
  ).run(details.plot ?? null, details.durationSecs ?? null, details.containerExtension ?? null, Date.now(), movieId);
}

/**
 * Lazily fetches (and caches) a series' seasons/episodes via `get_series_info` — a no-op if
 * already fetched. Replaces the series' seasons/episodes wholesale (delete-then-insert) rather
 * than diffing — same reasoning as EPG import: cheap to fully replace a leaf list. A refresh
 * resets `episodes_fetched_at` to NULL (see `importSeries.ts`), so this re-runs next open.
 */
export async function ensureSeriesEpisodes(
  db: Database.Database,
  source: Source,
  seriesId: string,
  getCredentials: CredentialsLookup,
): Promise<void> {
  const row = db
    .prepare(
      `SELECT id, source_id AS sourceId, category_id AS categoryId, provider_series_id AS providerSeriesId,
              name, poster_url AS posterUrl, rating, plot, episodes_fetched_at AS episodesFetchedAt
       FROM series WHERE id = ?`,
    )
    .get(seriesId) as
    | {
        id: string;
        sourceId: string;
        categoryId: string;
        providerSeriesId: string;
        name: string;
        posterUrl: string | null;
        rating: string | null;
        plot: string | null;
        episodesFetchedAt: number | null;
      }
    | undefined;
  if (!row || row.episodesFetchedAt !== null) return;

  const series: Series = {
    id: row.id,
    sourceId: row.sourceId,
    categoryId: row.categoryId,
    providerSeriesId: row.providerSeriesId,
    name: row.name,
    ...(row.posterUrl !== null ? { posterUrl: row.posterUrl } : {}),
    ...(row.rating !== null ? { rating: row.rating } : {}),
    ...(row.plot !== null ? { plot: row.plot } : {}),
  };
  const { seasons, episodes } = await fetchSeriesDetails(source, series, getCredentials);

  const deleteEpisodes = db.prepare(`DELETE FROM episodes WHERE series_id = ?`);
  const deleteSeasons = db.prepare(`DELETE FROM seasons WHERE series_id = ?`);
  const insertSeason = db.prepare(`INSERT INTO seasons (id, series_id, season_number, name, poster_url) VALUES (?, ?, ?, ?, ?)`);
  const insertEpisode = db.prepare(`
    INSERT INTO episodes (id, season_id, series_id, provider_episode_id, episode_number, name, container_extension, duration_secs, plot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const stamp = db.prepare(`UPDATE series SET episodes_fetched_at = ? WHERE id = ?`);

  const applyAll = db.transaction(() => {
    deleteEpisodes.run(seriesId);
    deleteSeasons.run(seriesId);
    for (const season of seasons) {
      insertSeason.run(season.id, season.seriesId, season.seasonNumber, season.name ?? null, season.posterUrl ?? null);
    }
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
      );
    }
    stamp.run(Date.now(), seriesId);
  });
  applyAll();
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/db/importVodDetails.ts
git commit -m "Add lazy per-movie/per-series detail fetch with cache-and-stamp"
```

## Task 6: Query functions

**Files:**
- Create: `packages/core/src/db/vodQueries.ts`
- Create: `packages/core/src/db/seriesQueries.ts`
- Create: `packages/core/src/db/progressQueries.ts`
- Test: `packages/core/src/__tests__/progress.test.ts`

**Interfaces:**
- Consumes: `Source` (existing)
- Produces (`vodQueries.ts`): `MovieRow`, `searchMovies(db, query, limit?)`, `browseMovies(db, opts?)`, `MovieCategoryRow`, `listMovieCategories(db)`, `listFavouriteMovies(db)`, `listRecentMovies(db, limit?)`, `toggleMovieFavourite(db, movieId): boolean`, `recordMovieRecent(db, movieId): void`, `getMovieById(db, movieId): MovieRow | undefined`, `MoviePlaybackTarget`, `getMoviePlaybackTarget(db, movieId): MoviePlaybackTarget | undefined`.
- Produces (`seriesQueries.ts`): `SeriesRow`, `searchSeries(db, query, limit?)`, `browseSeries(db, opts?)`, `SeriesCategoryRow`, `listSeriesCategories(db)`, `listFavouriteSeries(db)`, `listRecentSeries(db, limit?)`, `toggleSeriesFavourite(db, seriesId): boolean`, `recordSeriesRecent(db, seriesId): void`, `SeasonRow`, `EpisodeRow`, `SeasonWithEpisodes`, `SeriesDetail`, `getSeriesDetail(db, seriesId): SeriesDetail | undefined`, `getSeriesSource(db, seriesId): Source | undefined`, `EpisodePlaybackTarget`, `getEpisodePlaybackTarget(db, episodeId): EpisodePlaybackTarget | undefined`.
- Produces (`progressQueries.ts`): `isWatched(positionSecs, durationSecs): boolean` (pure), `shouldPromptResume(positionSecs, durationSecs): boolean` (pure), `PlaybackProgressRow`, `getPlaybackProgress(db, itemType, itemId): PlaybackProgressRow | undefined`, `setPlaybackProgress(db, itemType, itemId, positionSecs, durationSecs): void`.

`playback_progress` functions get their own file rather than living in `vodQueries.ts`/`seriesQueries.ts`: the table is polymorphic (one row shape for both `movie` and `episode` — see schema.ts's comment on it), so it doesn't belong to either content type's query module. All three files use the same subselect-for-boolean/scalar-column style as `CHANNEL_COLUMNS` in `queries.ts` (not joins), and the same FTS5 prefix-query shape as `searchChannels`.

- [ ] **Step 1: Write `packages/core/src/db/vodQueries.ts`**:

```ts
import type Database from "better-sqlite3";
import type { Source } from "../source/types.js";

export interface MovieRow {
  readonly id: string;
  readonly source_id: string;
  readonly category_id: string;
  readonly name: string;
  readonly poster_url: string | null;
  readonly rating: string | null;
  readonly plot: string | null;
  readonly duration_secs: number | null;
  readonly details_fetched_at: number | null;
  readonly is_favourite: 0 | 1;
  readonly position_secs: number | null;
  readonly watched: 0 | 1;
}

const MOVIE_COLUMNS = `m.id, m.source_id, m.category_id, m.name, m.poster_url, m.rating, m.plot,
  m.duration_secs, m.details_fetched_at,
  (SELECT 1 FROM movie_favourites f WHERE f.movie_id = m.id) IS NOT NULL AS is_favourite,
  (SELECT position_secs FROM playback_progress pp WHERE pp.item_type = 'movie' AND pp.item_id = m.id) AS position_secs,
  COALESCE((SELECT watched FROM playback_progress pp WHERE pp.item_type = 'movie' AND pp.item_id = m.id), 0) AS watched`;

/** FTS5 search over movie titles. Same prefix-query shape as `searchChannels`. */
export function searchMovies(db: Database.Database, query: string, limit = 200): MovieRow[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const ftsQuery = trimmed.split(/\s+/).map((token) => `${token.replace(/["*]/g, "")}*`).join(" ");
  return db
    .prepare(
      `SELECT ${MOVIE_COLUMNS}
       FROM movies_fts
       JOIN movies m ON m.rowid = movies_fts.rowid
       WHERE movies_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(ftsQuery, limit) as MovieRow[];
}

/** The default poster grid: every movie, optionally narrowed to one category. Provider order. */
export function browseMovies(db: Database.Database, opts: { categoryId?: string; limit?: number; offset?: number } = {}): MovieRow[] {
  const limit = opts.limit ?? 300;
  const offset = opts.offset ?? 0;
  const where = opts.categoryId !== undefined ? "WHERE m.category_id = ?" : "";
  const filters = opts.categoryId !== undefined ? [opts.categoryId] : [];
  return db
    .prepare(`SELECT ${MOVIE_COLUMNS} FROM movies m ${where} ORDER BY m.rowid LIMIT ? OFFSET ?`)
    .all(...filters, limit, offset) as MovieRow[];
}

export interface MovieCategoryRow {
  readonly id: string;
  readonly name: string;
  readonly country: string | null;
  readonly movie_count: number;
}

/** Every movie category that still has movies, for `MoviesView`'s category tree. */
export function listMovieCategories(db: Database.Database): MovieCategoryRow[] {
  return db
    .prepare(
      `SELECT cat.id, cat.raw_name AS name, cat.country, COUNT(m.id) AS movie_count
       FROM movie_categories cat
       JOIN movies m ON m.category_id = cat.id
       GROUP BY cat.id
       ORDER BY cat.rowid`,
    )
    .all() as MovieCategoryRow[];
}

export function listFavouriteMovies(db: Database.Database): MovieRow[] {
  return db
    .prepare(`SELECT ${MOVIE_COLUMNS} FROM movie_favourites f JOIN movies m ON m.id = f.movie_id ORDER BY f.added_at DESC`)
    .all() as MovieRow[];
}

export function listRecentMovies(db: Database.Database, limit = 24): MovieRow[] {
  return db
    .prepare(`SELECT ${MOVIE_COLUMNS} FROM movie_recents r JOIN movies m ON m.id = r.movie_id ORDER BY r.played_at DESC LIMIT ?`)
    .all(limit) as MovieRow[];
}

export function toggleMovieFavourite(db: Database.Database, movieId: string): boolean {
  const existing = db.prepare(`SELECT 1 FROM movie_favourites WHERE movie_id = ?`).get(movieId);
  if (existing) {
    db.prepare(`DELETE FROM movie_favourites WHERE movie_id = ?`).run(movieId);
    return false;
  }
  db.prepare(`INSERT INTO movie_favourites (movie_id, added_at) VALUES (?, ?)`).run(movieId, Date.now());
  return true;
}

export function recordMovieRecent(db: Database.Database, movieId: string): void {
  db.prepare(
    `INSERT INTO movie_recents (movie_id, played_at) VALUES (?, ?)
     ON CONFLICT(movie_id) DO UPDATE SET played_at = excluded.played_at`,
  ).run(movieId, Date.now());
}

/** A single movie row by id, for the detail pane after `ensureMovieDetails` has run. */
export function getMovieById(db: Database.Database, movieId: string): MovieRow | undefined {
  return db.prepare(`SELECT ${MOVIE_COLUMNS} FROM movies m WHERE m.id = ?`).get(movieId) as MovieRow | undefined;
}

/** Everything the main process needs to build a movie's playable stream URL. */
export interface MoviePlaybackTarget {
  readonly movieId: string;
  readonly movieName: string;
  readonly providerStreamId: string;
  readonly containerExtension: string | null;
  readonly source: Source;
}

export function getMoviePlaybackTarget(db: Database.Database, movieId: string): MoviePlaybackTarget | undefined {
  const row = db
    .prepare(
      `SELECT m.id AS movieId, m.name AS movieName, m.provider_stream_id AS providerStreamId, m.container_extension AS containerExtension,
              s.id AS sourceId, s.kind AS kind, s.name AS sourceName, s.base_url AS baseUrl
       FROM movies m
       JOIN sources s ON s.id = m.source_id
       WHERE m.id = ?`,
    )
    .get(movieId) as
    | {
        movieId: string;
        movieName: string;
        providerStreamId: string;
        containerExtension: string | null;
        sourceId: string;
        kind: "xtream" | "m3u";
        sourceName: string;
        baseUrl: string | null;
      }
    | undefined;
  if (!row) return undefined;

  // Movies are Xtream-only (design spec "Scope"), but the source row shape is generic — build
  // whichever kind it actually is so a stale row fails loudly downstream rather than here.
  const source: Source =
    row.kind === "xtream"
      ? { id: row.sourceId, kind: "xtream", name: row.sourceName, baseUrl: row.baseUrl ?? "" }
      : { id: row.sourceId, kind: "m3u", name: row.sourceName, playlistUrl: "" };

  return {
    movieId: row.movieId,
    movieName: row.movieName,
    providerStreamId: row.providerStreamId,
    containerExtension: row.containerExtension,
    source,
  };
}
```

- [ ] **Step 2: Write `packages/core/src/db/seriesQueries.ts`**:

```ts
import type Database from "better-sqlite3";
import type { Source } from "../source/types.js";

export interface SeriesRow {
  readonly id: string;
  readonly source_id: string;
  readonly category_id: string;
  readonly name: string;
  readonly poster_url: string | null;
  readonly rating: string | null;
  readonly plot: string | null;
  readonly episodes_fetched_at: number | null;
  readonly is_favourite: 0 | 1;
}

const SERIES_COLUMNS = `sr.id, sr.source_id, sr.category_id, sr.name, sr.poster_url, sr.rating, sr.plot, sr.episodes_fetched_at,
  (SELECT 1 FROM series_favourites f WHERE f.series_id = sr.id) IS NOT NULL AS is_favourite`;

export function searchSeries(db: Database.Database, query: string, limit = 200): SeriesRow[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const ftsQuery = trimmed.split(/\s+/).map((token) => `${token.replace(/["*]/g, "")}*`).join(" ");
  return db
    .prepare(
      `SELECT ${SERIES_COLUMNS}
       FROM series_fts
       JOIN series sr ON sr.rowid = series_fts.rowid
       WHERE series_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(ftsQuery, limit) as SeriesRow[];
}

export function browseSeries(db: Database.Database, opts: { categoryId?: string; limit?: number; offset?: number } = {}): SeriesRow[] {
  const limit = opts.limit ?? 300;
  const offset = opts.offset ?? 0;
  const where = opts.categoryId !== undefined ? "WHERE sr.category_id = ?" : "";
  const filters = opts.categoryId !== undefined ? [opts.categoryId] : [];
  return db
    .prepare(`SELECT ${SERIES_COLUMNS} FROM series sr ${where} ORDER BY sr.rowid LIMIT ? OFFSET ?`)
    .all(...filters, limit, offset) as SeriesRow[];
}

export interface SeriesCategoryRow {
  readonly id: string;
  readonly name: string;
  readonly country: string | null;
  readonly series_count: number;
}

export function listSeriesCategories(db: Database.Database): SeriesCategoryRow[] {
  return db
    .prepare(
      `SELECT cat.id, cat.raw_name AS name, cat.country, COUNT(sr.id) AS series_count
       FROM series_categories cat
       JOIN series sr ON sr.category_id = cat.id
       GROUP BY cat.id
       ORDER BY cat.rowid`,
    )
    .all() as SeriesCategoryRow[];
}

export function listFavouriteSeries(db: Database.Database): SeriesRow[] {
  return db
    .prepare(`SELECT ${SERIES_COLUMNS} FROM series_favourites f JOIN series sr ON sr.id = f.series_id ORDER BY f.added_at DESC`)
    .all() as SeriesRow[];
}

export function listRecentSeries(db: Database.Database, limit = 24): SeriesRow[] {
  return db
    .prepare(`SELECT ${SERIES_COLUMNS} FROM series_recents r JOIN series sr ON sr.id = r.series_id ORDER BY r.played_at DESC LIMIT ?`)
    .all(limit) as SeriesRow[];
}

export function toggleSeriesFavourite(db: Database.Database, seriesId: string): boolean {
  const existing = db.prepare(`SELECT 1 FROM series_favourites WHERE series_id = ?`).get(seriesId);
  if (existing) {
    db.prepare(`DELETE FROM series_favourites WHERE series_id = ?`).run(seriesId);
    return false;
  }
  db.prepare(`INSERT INTO series_favourites (series_id, added_at) VALUES (?, ?)`).run(seriesId, Date.now());
  return true;
}

/** Bumped on any episode play, not just a series-level "play" action (there isn't one). */
export function recordSeriesRecent(db: Database.Database, seriesId: string): void {
  db.prepare(
    `INSERT INTO series_recents (series_id, played_at) VALUES (?, ?)
     ON CONFLICT(series_id) DO UPDATE SET played_at = excluded.played_at`,
  ).run(seriesId, Date.now());
}

export interface SeasonRow {
  readonly id: string;
  readonly series_id: string;
  readonly season_number: number;
  readonly name: string | null;
  readonly poster_url: string | null;
}

export interface EpisodeRow {
  readonly id: string;
  readonly season_id: string;
  readonly series_id: string;
  readonly episode_number: number;
  readonly name: string;
  readonly container_extension: string | null;
  readonly duration_secs: number | null;
  readonly plot: string | null;
  readonly position_secs: number | null;
  readonly watched: 0 | 1;
}

export interface SeasonWithEpisodes extends SeasonRow {
  readonly episodes: readonly EpisodeRow[];
}

export interface SeriesDetail {
  readonly series: SeriesRow;
  readonly seasons: readonly SeasonWithEpisodes[];
}

const EPISODE_COLUMNS = `e.id, e.season_id, e.series_id, e.episode_number, e.name, e.container_extension, e.duration_secs, e.plot,
  (SELECT position_secs FROM playback_progress pp WHERE pp.item_type = 'episode' AND pp.item_id = e.id) AS position_secs,
  COALESCE((SELECT watched FROM playback_progress pp WHERE pp.item_type = 'episode' AND pp.item_id = e.id), 0) AS watched`;

/**
 * A series with its seasons and episodes, nested for direct rendering by `SeriesView`. Caller
 * (the `series.episodes` IPC handler) is responsible for calling `ensureSeriesEpisodes` first
 * so this reads fresh data for a series opened for the first time since its last refresh.
 */
export function getSeriesDetail(db: Database.Database, seriesId: string): SeriesDetail | undefined {
  const series = db.prepare(`SELECT ${SERIES_COLUMNS} FROM series sr WHERE sr.id = ?`).get(seriesId) as SeriesRow | undefined;
  if (!series) return undefined;

  const seasons = db
    .prepare(`SELECT id, series_id, season_number, name, poster_url FROM seasons WHERE series_id = ? ORDER BY season_number`)
    .all(seriesId) as SeasonRow[];

  const episodesBySeason = db.prepare(`SELECT ${EPISODE_COLUMNS} FROM episodes e WHERE e.season_id = ? ORDER BY e.episode_number`);

  return {
    series,
    seasons: seasons.map((season) => ({ ...season, episodes: episodesBySeason.all(season.id) as EpisodeRow[] })),
  };
}

/** Resolves a series id to its source, for the `series.episodes` IPC handler's lazy-fetch gate. */
export function getSeriesSource(db: Database.Database, seriesId: string): Source | undefined {
  const row = db
    .prepare(
      `SELECT s.id, s.kind, s.name, s.base_url AS baseUrl
       FROM sources s
       JOIN series sr ON sr.source_id = s.id
       WHERE sr.id = ?`,
    )
    .get(seriesId) as { id: string; kind: "xtream" | "m3u"; name: string; baseUrl: string | null } | undefined;
  if (!row) return undefined;
  return row.kind === "xtream"
    ? { id: row.id, kind: "xtream", name: row.name, baseUrl: row.baseUrl ?? "" }
    : { id: row.id, kind: "m3u", name: row.name, playlistUrl: "" };
}

/** Everything the main process needs to build an episode's playable stream URL. */
export interface EpisodePlaybackTarget {
  readonly episodeId: string;
  readonly episodeName: string;
  readonly seriesId: string;
  readonly providerEpisodeId: string;
  readonly containerExtension: string | null;
  readonly source: Source;
}

export function getEpisodePlaybackTarget(db: Database.Database, episodeId: string): EpisodePlaybackTarget | undefined {
  const row = db
    .prepare(
      `SELECT e.id AS episodeId, e.name AS episodeName, e.series_id AS seriesId, e.provider_episode_id AS providerEpisodeId,
              e.container_extension AS containerExtension,
              s.id AS sourceId, s.kind AS kind, s.name AS sourceName, s.base_url AS baseUrl
       FROM episodes e
       JOIN series sr ON sr.id = e.series_id
       JOIN sources s ON s.id = sr.source_id
       WHERE e.id = ?`,
    )
    .get(episodeId) as
    | {
        episodeId: string;
        episodeName: string;
        seriesId: string;
        providerEpisodeId: string;
        containerExtension: string | null;
        sourceId: string;
        kind: "xtream" | "m3u";
        sourceName: string;
        baseUrl: string | null;
      }
    | undefined;
  if (!row) return undefined;

  const source: Source =
    row.kind === "xtream"
      ? { id: row.sourceId, kind: "xtream", name: row.sourceName, baseUrl: row.baseUrl ?? "" }
      : { id: row.sourceId, kind: "m3u", name: row.sourceName, playlistUrl: "" };

  return {
    episodeId: row.episodeId,
    episodeName: row.episodeName,
    seriesId: row.seriesId,
    providerEpisodeId: row.providerEpisodeId,
    containerExtension: row.containerExtension,
    source,
  };
}
```

- [ ] **Step 3: Write `packages/core/src/db/progressQueries.ts`**:

```ts
import type Database from "better-sqlite3";

const RESUME_FLOOR_SECS = 30;
const WATCHED_THRESHOLD = 0.95;

/** Crossing 95% of duration counts as watched — design spec "Playback, resume, watched state". */
export function isWatched(positionSecs: number, durationSecs: number | null | undefined): boolean {
  if (durationSecs === null || durationSecs === undefined || durationSecs <= 0) return false;
  return positionSecs / durationSecs >= WATCHED_THRESHOLD;
}

/** Whether a load should prompt "Resume from ..." vs. "Start over" rather than just starting at 0. */
export function shouldPromptResume(positionSecs: number, durationSecs: number | null | undefined): boolean {
  if (durationSecs === null || durationSecs === undefined || durationSecs <= 0) return false;
  if (positionSecs < RESUME_FLOOR_SECS) return false;
  return positionSecs / durationSecs < WATCHED_THRESHOLD;
}

export interface PlaybackProgressRow {
  readonly item_type: "movie" | "episode";
  readonly item_id: string;
  readonly position_secs: number;
  readonly duration_secs: number | null;
  readonly watched: 0 | 1;
  readonly updated_at: number;
}

export function getPlaybackProgress(db: Database.Database, itemType: "movie" | "episode", itemId: string): PlaybackProgressRow | undefined {
  return db
    .prepare(`SELECT item_type, item_id, position_secs, duration_secs, watched, updated_at FROM playback_progress WHERE item_type = ? AND item_id = ?`)
    .get(itemType, itemId) as PlaybackProgressRow | undefined;
}

/** Upserts the current position, recomputing `watched` from the threshold on every write. */
export function setPlaybackProgress(
  db: Database.Database,
  itemType: "movie" | "episode",
  itemId: string,
  positionSecs: number,
  durationSecs: number | null,
): void {
  const watched = isWatched(positionSecs, durationSecs) ? 1 : 0;
  db.prepare(
    `INSERT INTO playback_progress (item_type, item_id, position_secs, duration_secs, watched, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_type, item_id) DO UPDATE SET
       position_secs = excluded.position_secs,
       duration_secs = excluded.duration_secs,
       watched       = excluded.watched,
       updated_at    = excluded.updated_at`,
  ).run(itemType, itemId, Math.round(positionSecs), durationSecs, watched, Date.now());
}
```

- [ ] **Step 4: Write the pure-function test** at `packages/core/src/__tests__/progress.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isWatched, shouldPromptResume } from "../db/progressQueries.js";

describe("isWatched", () => {
  it("is true at or past 95% of duration", () => {
    expect(isWatched(950, 1000)).toBe(true);
    expect(isWatched(949, 1000)).toBe(false);
  });

  it("is false with no duration", () => {
    expect(isWatched(500, null)).toBe(false);
    expect(isWatched(500, undefined)).toBe(false);
  });
});

describe("shouldPromptResume", () => {
  it("is false below the 30s floor", () => {
    expect(shouldPromptResume(29, 1000)).toBe(false);
  });

  it("is true between the floor and the watched threshold", () => {
    expect(shouldPromptResume(30, 1000)).toBe(true);
    expect(shouldPromptResume(500, 1000)).toBe(true);
  });

  it("is false at or past the watched threshold", () => {
    expect(shouldPromptResume(950, 1000)).toBe(false);
  });

  it("is false with no duration", () => {
    expect(shouldPromptResume(500, null)).toBe(false);
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/vodQueries.ts packages/core/src/db/seriesQueries.ts packages/core/src/db/progressQueries.ts packages/core/src/__tests__/progress.test.ts
git commit -m "Add movie/series/progress query functions"
```

## Task 7: Export from index

**Files:**
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: every module created in Tasks 2–6
- Produces: all of the above, importable from `@testcard/core` by `apps/desktop`.

- [ ] **Step 1: Append six export lines** to `packages/core/src/index.ts` (after the existing `export * from "./db/queries.js";` line):

```ts
export * from "./source/xtream/vod.js";
export * from "./db/importVod.js";
export * from "./db/importSeries.js";
export * from "./db/importVodDetails.js";
export * from "./db/vodQueries.js";
export * from "./db/seriesQueries.js";
export * from "./db/progressQueries.js";
```

No name collisions with existing barrel exports: `vod.ts`'s functions (`fetchVodCategories`, `fetchMovies`, ...) are distinctly named from `client.ts`'s (`fetchCategories`, `fetchChannels`, ...); `vodQueries.ts`/`seriesQueries.ts`/`progressQueries.ts` export `MovieRow`/`SeriesRow`/`PlaybackProgressRow`/etc., none of which match `queries.ts`'s `ChannelRow`/`CategoryRow`/etc.

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "Export Phase 4b modules from @testcard/core"
```

## Task 8: IPC — main process

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/main/ipc.ts`

**Interfaces:**
- Consumes: `MovieRow`, `MovieCategoryRow`, `SeriesRow`, `SeriesCategoryRow`, `SeriesDetail`, `PlaybackProgressRow` (Task 6, via `@testcard/core`); `browseMovies`, `searchMovies`, `listMovieCategories`, `listFavouriteMovies`, `listRecentMovies`, `toggleMovieFavourite`, `getMovieById`, `getMoviePlaybackTarget` (Task 6, `vodQueries.ts`); `browseSeries`, `searchSeries`, `listSeriesCategories`, `listFavouriteSeries`, `listRecentSeries`, `toggleSeriesFavourite`, `getSeriesDetail`, `getSeriesSource` (Task 6, `seriesQueries.ts`); `getPlaybackProgress`, `setPlaybackProgress` (Task 6, `progressQueries.ts`); `ensureMovieDetails`, `ensureSeriesEpisodes` (Task 5); `importVod`, `importSeries` (Task 4); `CredentialsLookup` (existing, `client.ts`); `PlaybackController.playMovie`/`playEpisode` (Task 10 — this task's handlers call them, so Task 10 must land before this compiles, but is written after it in the required order; Task 8's handler code is correct once Task 10 lands. If executing tasks strictly in order, note this one dependency inversion and either reorder locally or accept a transient compile gap until Task 10 completes).
- Produces: `TestcardApi.movies.*`, `TestcardApi.series.*`, `TestcardApi.progress.*`, `TestcardApi.playback.playMovie`/`playEpisode`, `RefreshResult.movies`/`series` — all consumed by Task 9 (preload) and the renderer (Tasks 13–15).

> **Note on task ordering:** this task's `main/ipc.ts` handlers call `playback.playMovie`/`playEpisode` on `PlaybackController`, which Task 10 adds. Implement Tasks 8 and 10 together (or implement Task 10's `PlaybackController` changes first) if running strictly in sequence — `main/ipc.ts` will not compile against a `PlaybackController` that doesn't yet have `playMovie`/`playEpisode`.

- [ ] **Step 1: Extend `apps/desktop/src/shared/ipc.ts`** — add to the existing `@testcard/core` import (line 11):

```ts
import type {
  CategoryRow,
  Channel,
  ChannelCountry,
  ChannelRow,
  CountryNode,
  MovieCategoryRow,
  MovieRow,
  PlaybackProgressRow,
  SeriesCategoryRow,
  SeriesDetail,
  SeriesRow,
  Source,
} from "@testcard/core";
```

Extend `RefreshResult` (currently ending `readonly programmes?: number;`):

```ts
export interface RefreshResult {
  readonly categories: number;
  readonly channels: number;
  readonly variants: number;
  readonly durationMs: number;
  /** Programme rows imported from EPG, when a guide URL was available. */
  readonly programmes?: number;
  /** Movies imported, when the source is Xtream (design spec "Import strategy"). */
  readonly movies?: number;
  /** Series imported, when the source is Xtream. */
  readonly series?: number;
}
```

Add `movies`, `series`, `progress` namespaces to `TestcardApi`, and `playMovie`/`playEpisode` to the `playback` namespace (insert after the existing `epg` block, before `playback`; and insert the two new `playback` methods after `play`):

```ts
  movies: {
    /** Every movie category that still has movies, for MoviesView's category tree. */
    categoryList(): Promise<readonly MovieCategoryRow[]>;
    /** The default poster grid: all movies, optionally one category, paginated. */
    browse(opts?: { categoryId?: string; limit?: number; offset?: number }): Promise<readonly MovieRow[]>;
    search(query: string): Promise<readonly MovieRow[]>;
    favourites(): Promise<readonly MovieRow[]>;
    recent(): Promise<readonly MovieRow[]>;
    toggleFavourite(movieId: string): Promise<boolean>;
    /** Triggers the lazy plot/duration (get_vod_info) fetch if not already cached, then returns the row. */
    details(movieId: string): Promise<MovieRow>;
  };
  series: {
    categoryList(): Promise<readonly SeriesCategoryRow[]>;
    browse(opts?: { categoryId?: string; limit?: number; offset?: number }): Promise<readonly SeriesRow[]>;
    search(query: string): Promise<readonly SeriesRow[]>;
    favourites(): Promise<readonly SeriesRow[]>;
    recent(): Promise<readonly SeriesRow[]>;
    toggleFavourite(seriesId: string): Promise<boolean>;
    /** Lazy-fetches (or returns cached) seasons/episodes for a series. */
    episodes(seriesId: string): Promise<SeriesDetail>;
  };
  progress: {
    get(itemType: "movie" | "episode", itemId: string): Promise<PlaybackProgressRow | undefined>;
    set(itemType: "movie" | "episode", itemId: string, positionSecs: number, durationSecs?: number): Promise<void>;
  };
```

And inside the existing `playback` namespace, after the `play(channelId, variantId?)` line:

```ts
    /** Starts a movie, resolving container_extension (lazily, if missing) then building its URL. */
    playMovie(movieId: string, opts?: { resume?: boolean }): Promise<void>;
    /** Starts an episode. */
    playEpisode(episodeId: string, opts?: { resume?: boolean }): Promise<void>;
```

- [ ] **Step 2: Extend `apps/desktop/src/main/ipc.ts`'s imports** — add to the existing `@testcard/core` import block:

```ts
import {
  browseChannels,
  browseMovies,
  browseSeries,
  createM3UAdapter,
  createXtreamAdapter,
  ensureMovieDetails,
  ensureSeriesEpisodes,
  extractXtreamCredentials,
  getMovieById,
  getMoviePlaybackTarget,
  getPlaybackProgress,
  getSeriesDetail,
  getSeriesSource,
  importEpg,
  importSeries,
  importSource,
  importVod,
  listCategories,
  listChannelCountries,
  listFavouriteChannels,
  listFavouriteMovies,
  listFavouriteSeries,
  listMovieCategories,
  listRecentChannels,
  listRecentMovies,
  listRecentSeries,
  listSeriesCategories,
  nowNextForChannels,
  probeXtream,
  programmesInWindow,
  searchChannels,
  searchMovies,
  searchSeries,
  setPlaybackProgress,
  listCountries,
  toggleFavourite,
  toggleMovieFavourite,
  toggleSeriesFavourite,
  type Channel,
  type CredentialsLookup,
  type ProgrammeRow,
  type Source,
  type SourceAdapter,
  type XtreamCredentials,
} from "@testcard/core";
```

- [ ] **Step 3: Pass `getCredentials` into `PlaybackController`** — change the constructor call in `registerIpcHandlers` (currently `new PlaybackController(db, mainWindow, { xtream: xtreamAdapter, m3u: m3uAdapter })`):

```ts
  const playback = new PlaybackController(db, mainWindow, { xtream: xtreamAdapter, m3u: m3uAdapter }, getCredentials);
```

(This depends on Task 10's constructor signature change — see the note above Step 1.)

- [ ] **Step 4: Wire movie/series refresh into `refreshSource()`** — replace the body of `refreshSource` (currently ending with `return programmes !== undefined ? { ...result, programmes } : result;`) with:

```ts
  async function refreshSource(sourceId: string): Promise<RefreshResult> {
    if (refreshingSourceIds.has(sourceId)) {
      throw new Error("This source is already refreshing.");
    }
    refreshingSourceIds.add(sourceId);
    try {
      const row = db
        .prepare(`SELECT id, kind, name, base_url as baseUrl, playlist_url as playlistUrl, epg_url as epgUrl FROM sources WHERE id = ?`)
        .get(sourceId) as (Source & { baseUrl?: string; playlistUrl?: string; epgUrl?: string | null }) | undefined;
      if (!row) throw new Error(`Unknown source: ${sourceId}`);

      const adapter = row.kind === "xtream" ? xtreamAdapter : m3uAdapter;
      const result = await importSource(db, row, adapter);

      // Movies/series are Xtream-only (design spec "Scope") — imported right after channels,
      // same cost profile as live import.
      const vod = row.kind === "xtream" ? await importVod(db, row, getCredentials) : undefined;
      const series = row.kind === "xtream" ? await importSeries(db, row, getCredentials) : undefined;

      // EPG is best-effort: a bad or missing guide URL must not fail the playlist refresh.
      const programmes = await refreshEpg(db, row, adapter, row.epgUrl ?? null, emitTask).catch((error: unknown) => {
        emitTask({
          type: "epg",
          sourceId,
          phase: "error",
          message: error instanceof Error ? error.message : "The guide could not be updated.",
        });
        return undefined;
      });

      return {
        ...result,
        ...(programmes !== undefined ? { programmes } : {}),
        ...(vod !== undefined ? { movies: vod.movies } : {}),
        ...(series !== undefined ? { series: series.series } : {}),
      };
    } finally {
      refreshingSourceIds.delete(sourceId);
    }
  }
```

- [ ] **Step 5: Purge movie/series posters and prune favourites/recents in `sources.remove`** — replace the handler body (currently starting `async remove(sourceId) {`) with:

```ts
      async remove(sourceId) {
        // Collect logo/poster URLs before the cascade deletes the rows that reference them —
        // the cache is keyed by sha1(url), not source id (see logoCache.ts).
        const logoRows = db
          .prepare(`SELECT DISTINCT logo_url FROM channels WHERE source_id = ? AND logo_url IS NOT NULL`)
          .all(sourceId) as { logo_url: string }[];
        const moviePosterRows = db
          .prepare(`SELECT DISTINCT poster_url FROM movies WHERE source_id = ? AND poster_url IS NOT NULL`)
          .all(sourceId) as { poster_url: string }[];
        const seriesPosterRows = db
          .prepare(`SELECT DISTINCT poster_url FROM series WHERE source_id = ? AND poster_url IS NOT NULL`)
          .all(sourceId) as { poster_url: string }[];

        // FK cascade takes categories/channels/variants/programmes/movie_categories/movies/
        // series_categories/series/seasons/episodes with it.
        db.prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId);

        // favourites/recents have no FK by design (a title missing from one refresh shouldn't
        // silently drop a favourite) — a source delete is permanent, so this is the one place
        // stale rows are actually pruned rather than just left to go dark.
        db.prepare(`DELETE FROM favourites WHERE channel_id NOT IN (SELECT id FROM channels)`).run();
        db.prepare(`DELETE FROM recents WHERE channel_id NOT IN (SELECT id FROM channels)`).run();
        db.prepare(`DELETE FROM movie_favourites WHERE movie_id NOT IN (SELECT id FROM movies)`).run();
        db.prepare(`DELETE FROM movie_recents WHERE movie_id NOT IN (SELECT id FROM movies)`).run();
        db.prepare(`DELETE FROM series_favourites WHERE series_id NOT IN (SELECT id FROM series)`).run();
        db.prepare(`DELETE FROM series_recents WHERE series_id NOT IN (SELECT id FROM series)`).run();

        await deleteCredentials(sourceId);
        await purgeCachedLogos([
          ...logoRows.map((row) => row.logo_url),
          ...moviePosterRows.map((row) => row.poster_url),
          ...seriesPosterRows.map((row) => row.poster_url),
        ]).catch(() => undefined);
      },
```

- [ ] **Step 6: Add the `movies`, `series`, `progress` API objects** — first add a small local helper just above the `const api: Omit<TestcardApi, "events"> = {` declaration (still inside `registerIpcHandlers`, so it closes over `db` the same way `refreshSource` above it does; it resolves a movie's source for `details` below — `getMoviePlaybackTarget` was added to the Step 2 import list for this):

```ts
  function getMoviePlaybackTargetOrThrow(movieId: string) {
    const target = getMoviePlaybackTarget(db, movieId);
    if (!target) throw new Error(`Unknown movie: ${movieId}`);
    return target;
  }
```

Then insert the three namespaces after the existing `epg: { ... }` block in the `api` object literal (before `playback: {`):

```ts
    movies: {
      async categoryList() {
        return listMovieCategories(db);
      },
      async browse(opts) {
        return browseMovies(db, opts ?? {});
      },
      async search(query) {
        return searchMovies(db, query);
      },
      async favourites() {
        return listFavouriteMovies(db);
      },
      async recent() {
        return listRecentMovies(db);
      },
      async toggleFavourite(movieId) {
        return toggleMovieFavourite(db, movieId);
      },
      async details(movieId) {
        const target = getMoviePlaybackTargetOrThrow(movieId);
        if (target.source.kind === "xtream") await ensureMovieDetails(db, target.source, movieId, getCredentials);
        const row = getMovieById(db, movieId);
        if (!row) throw new Error(`Unknown movie: ${movieId}`);
        return row;
      },
    },

    series: {
      async categoryList() {
        return listSeriesCategories(db);
      },
      async browse(opts) {
        return browseSeries(db, opts ?? {});
      },
      async search(query) {
        return searchSeries(db, query);
      },
      async favourites() {
        return listFavouriteSeries(db);
      },
      async recent() {
        return listRecentSeries(db);
      },
      async toggleFavourite(seriesId) {
        return toggleSeriesFavourite(db, seriesId);
      },
      async episodes(seriesId) {
        const source = getSeriesSource(db, seriesId);
        if (!source) throw new Error(`Unknown series: ${seriesId}`);
        if (source.kind === "xtream") await ensureSeriesEpisodes(db, source, seriesId, getCredentials);
        const detail = getSeriesDetail(db, seriesId);
        if (!detail) throw new Error(`Unknown series: ${seriesId}`);
        return detail;
      },
    },

    progress: {
      async get(itemType, itemId) {
        return getPlaybackProgress(db, itemType, itemId);
      },
      async set(itemType, itemId, positionSecs, durationSecs) {
        setPlaybackProgress(db, itemType, itemId, positionSecs, durationSecs ?? null);
      },
    },
```

- [ ] **Step 7: Add `playMovie`/`playEpisode` handlers** — inside the existing `playback: { ... }` block, after `async play(channelId, variantId) { ... }`:

```ts
      async playMovie(movieId, opts) {
        await playback.playMovie(movieId, opts ?? {});
      },
      async playEpisode(episodeId, opts) {
        await playback.playEpisode(episodeId, opts ?? {});
      },
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/main/ipc.ts
git commit -m "Wire movies/series/progress IPC namespaces and VOD refresh"
```

## Task 9: Preload bridge

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/preload/index.d.ts` (verify only — see Step 2)

**Interfaces:**
- Consumes: `TestcardApi` (Task 8, extended)
- Produces: `window.testcard.movies.*`, `window.testcard.series.*`, `window.testcard.progress.*`, `window.testcard.playback.playMovie`/`playEpisode` — consumed by the renderer (Tasks 13–15).

- [ ] **Step 1: Add the new `bind()` entries** to `apps/desktop/src/preload/index.ts`'s `api` object — insert after the existing `epg: { ... }` block (before `playback: {`):

```ts
  movies: {
    categoryList: bind("movies.categoryList"),
    browse: bind("movies.browse"),
    search: bind("movies.search"),
    favourites: bind("movies.favourites"),
    recent: bind("movies.recent"),
    toggleFavourite: bind("movies.toggleFavourite"),
    details: bind("movies.details"),
  },
  series: {
    categoryList: bind("series.categoryList"),
    browse: bind("series.browse"),
    search: bind("series.search"),
    favourites: bind("series.favourites"),
    recent: bind("series.recent"),
    toggleFavourite: bind("series.toggleFavourite"),
    episodes: bind("series.episodes"),
  },
  progress: {
    get: bind("progress.get"),
    set: bind("progress.set"),
  },
```

And inside the existing `playback: { ... }` block, after `play: bind("playback.play"),`:

```ts
    playMovie: bind("playback.playMovie"),
    playEpisode: bind("playback.playEpisode"),
```

- [ ] **Step 2: Verify `index.d.ts` needs no change** — `apps/desktop/src/preload/index.d.ts` declares `window.testcard: TestcardApi` by re-exporting the shared type; since `TestcardApi` already gained the new namespaces in Task 8, this file's `import type { TestcardApi } from "../shared/ipc";` picks them up automatically. Make no edit.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/preload/index.ts
git commit -m "Bridge movies/series/progress IPC into the preload API"
```

## Task 10: Playback resume/watched tracking

**Files:**
- Modify: `apps/desktop/src/main/mpv/mpvProcess.ts`
- Modify: `apps/desktop/src/main/playbackController.ts`
- Modify: `apps/desktop/src/main/ipc.ts` (constructor call only — already done in Task 8 Step 3)

**Interfaces:**
- Consumes: `getMoviePlaybackTarget` (Task 6), `getEpisodePlaybackTarget` (Task 6), `getPlaybackProgress`/`setPlaybackProgress` (Task 6), `ensureMovieDetails` (Task 5), `buildMovieStreamUrl`/`buildEpisodeStreamUrl` (Task 3), `recordMovieRecent`/`recordSeriesRecent` (Task 6), `CredentialsLookup` (existing)
- Produces: `PlaybackController.playMovie(movieId, opts?)`, `PlaybackController.playEpisode(episodeId, opts?)` (consumed by Task 8 Step 7); `MpvPlayer.seek(seconds)`, new `MpvEvent` variants `"time-pos"` and `"end-file"`.

Design decision (documented since it isn't spelled out verbatim in the spec): `PlaybackEvent`/`PlaybackSnapshot`'s existing `channelId`/`channelName` fields are reused as-is for movie/episode playback — the on-video overlay just displays whatever id/name is currently playing, regardless of content type, so widening those two shared types isn't needed. The resume-vs-restart decision itself is made in the renderer (Tasks 13–14) by calling the pure `shouldPromptResume` from `@testcard/core` directly against a `progress.get()` result — simpler than adding a dedicated "should I prompt" IPC round trip, and `packages/core` is already framework-free so the renderer can import it exactly like it imports `ChannelRow`.

- [ ] **Step 1: Add `time-pos`/`end-file` events and a `seek` method to `MpvPlayer`** — in `apps/desktop/src/main/mpv/mpvProcess.ts`, extend the `MpvEvent` union (currently ending `| { readonly type: "exited"; readonly code: number | null };`):

```ts
export type MpvEvent =
  | { readonly type: "loading" }
  | { readonly type: "playing" }
  | { readonly type: "tracks"; readonly tracks: readonly MpvTrack[] }
  | { readonly type: "timeout" }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "exited"; readonly code: number | null }
  | { readonly type: "time-pos"; readonly seconds: number }
  | { readonly type: "end-file"; readonly reason: string };
```

In `start()`, after the existing `await this.ipc.observeProperty("track-list");` line, add:

```ts
    await this.ipc.observeProperty("time-pos");
```

After the existing `this.ipc.onPropertyChange("track-list", (value) => { ... });` block, add:

```ts
    // Process-lifetime, not per-load (mirrors track-list above) — drives PlaybackController's
    // playback_progress persistence for movies/episodes; live channels ignore this event.
    this.ipc.onPropertyChange("time-pos", (value) => {
      if (typeof value === "number") this.emit("event", { type: "time-pos", seconds: value });
    });
    // Also process-lifetime: play()'s own end-file listener below is per-load and only cares
    // whether a stream failed to *start*. This one tells the controller a title actually
    // finished (or was replaced), for progress persistence and watched-marking.
    this.ipc.onEvent("end-file", (message) => {
      this.emit("event", { type: "end-file", reason: String(message["reason"] ?? "unknown") });
    });
```

Add a new method, after `setAspect`:

```ts
  /** Absolute seek, used to resume a movie/episode at its saved `playback_progress` position. */
  async seek(seconds: number): Promise<void> {
    await this.ipc?.command(["seek", seconds, "absolute"]);
  }
```

- [ ] **Step 2: Rewrite `playbackController.ts`'s imports and `current` field** — in `apps/desktop/src/main/playbackController.ts`, replace the `@testcard/core` import (currently `import { getPlaybackTarget, recordRecent, type PlaybackTarget, type SourceAdapter } from "@testcard/core";`) with:

```ts
import {
  buildEpisodeStreamUrl,
  buildMovieStreamUrl,
  ensureMovieDetails,
  getEpisodePlaybackTarget,
  getMoviePlaybackTarget,
  getPlaybackProgress,
  getPlaybackTarget,
  recordMovieRecent,
  recordRecent,
  recordSeriesRecent,
  setPlaybackProgress,
  type CredentialsLookup,
  type PlaybackTarget,
  type SourceAdapter,
} from "@testcard/core";
```

Replace the `current` field's type. Add this type above the `PlaybackController` class (after the `Adapters` interface):

```ts
type CurrentPlayback =
  | { readonly kind: "channel"; readonly target: PlaybackTarget; readonly streamUrl: string }
  | { readonly kind: "movie"; readonly movieId: string; readonly movieName: string; readonly streamUrl: string; readonly durationSecs: number | null }
  | {
      readonly kind: "episode";
      readonly episodeId: string;
      readonly episodeName: string;
      readonly seriesId: string;
      readonly streamUrl: string;
      readonly durationSecs: number | null;
    };
```

Replace the field declaration `private current: { target: PlaybackTarget; streamUrl: string } | null = null;` with:

```ts
  private current: CurrentPlayback | null = null;
  private lastKnownPositionSecs = 0;
  private lastProgressWriteMs = 0;
  private pendingResumeSecs: number | null = null;
  private static readonly PROGRESS_WRITE_INTERVAL_MS = 5000;
```

- [ ] **Step 3: Add `getCredentials` to the constructor** — replace the constructor parameter list:

```ts
  constructor(
    private readonly db: Database.Database,
    private readonly mainWindow: BrowserWindow,
    private readonly adapters: Adapters,
    private readonly getCredentials: CredentialsLookup,
  ) {
```

(`main/ipc.ts`'s call site was already updated in Task 8 Step 3.)

- [ ] **Step 4: Update `play()` to reset the new fields and tag `current` with `kind: "channel"`** — replace the body of `play(channelId, variantId?)`:

```ts
  async play(channelId: string, variantId?: string): Promise<void> {
    const target = getPlaybackTarget(this.db, channelId, variantId);
    if (!target) throw new Error("That channel could not be found.");

    const adapter = target.source.kind === "xtream" ? this.adapters.xtream : this.adapters.m3u;
    const streamUrl = await adapter.buildStreamUrl(target.source, target.variant);
    this.current = { kind: "channel", target, streamUrl };
    this.tracks = [];
    this.pendingResumeSecs = null;
    this.lastKnownPositionSecs = 0;
    this.lastProgressWriteMs = 0;

    // A fresh channel always starts unpaused; the renderer no longer has to track this.
    this.paused = false;
    this.emit({ type: "paused", paused: false });

    await this.ensureStarted();
    this.status = "loading";
    this.syncOverlay();
    this.emit({ type: "loading", channelId, channelName: target.channelName });
    await this.mpv!.setVolume(this.volume);
    await this.mpv!.setPaused(false);
    await this.mpv!.setAspect(this.aspect);
    await this.mpv!.play(streamUrl);
  }
```

- [ ] **Step 5: Add `playMovie`/`playEpisode`** — insert after `play()`:

```ts
  async playMovie(movieId: string, opts: { resume?: boolean } = {}): Promise<void> {
    let target = getMoviePlaybackTarget(this.db, movieId);
    if (!target) throw new Error("That movie could not be found.");
    if (target.source.kind !== "xtream") throw new Error("Movies are only available on Xtream sources.");

    if (target.containerExtension === null || target.containerExtension === "") {
      await ensureMovieDetails(this.db, target.source, movieId, this.getCredentials);
      target = getMoviePlaybackTarget(this.db, movieId) ?? target;
    }

    const streamUrl = await buildMovieStreamUrl(
      target.source,
      { providerStreamId: target.providerStreamId, ...(target.containerExtension !== null ? { containerExtension: target.containerExtension } : {}) },
      this.getCredentials,
    );

    const progress = opts.resume === true ? getPlaybackProgress(this.db, "movie", movieId) : undefined;
    this.pendingResumeSecs = progress ? progress.position_secs : null;

    this.current = { kind: "movie", movieId, movieName: target.movieName, streamUrl, durationSecs: progress?.duration_secs ?? null };
    this.tracks = [];
    this.lastKnownPositionSecs = 0;
    this.lastProgressWriteMs = 0;
    this.paused = false;
    this.emit({ type: "paused", paused: false });

    await this.ensureStarted();
    this.status = "loading";
    this.syncOverlay();
    this.emit({ type: "loading", channelId: movieId, channelName: target.movieName });
    await this.mpv!.setVolume(this.volume);
    await this.mpv!.setPaused(false);
    await this.mpv!.setAspect(this.aspect);
    await this.mpv!.play(streamUrl);
  }

  async playEpisode(episodeId: string, opts: { resume?: boolean } = {}): Promise<void> {
    const target = getEpisodePlaybackTarget(this.db, episodeId);
    if (!target) throw new Error("That episode could not be found.");
    if (target.source.kind !== "xtream") throw new Error("Series are only available on Xtream sources.");

    const streamUrl = await buildEpisodeStreamUrl(
      target.source,
      {
        providerEpisodeId: target.providerEpisodeId,
        ...(target.containerExtension !== null ? { containerExtension: target.containerExtension } : {}),
      },
      this.getCredentials,
    );

    const progress = opts.resume === true ? getPlaybackProgress(this.db, "episode", episodeId) : undefined;
    this.pendingResumeSecs = progress ? progress.position_secs : null;

    this.current = {
      kind: "episode",
      episodeId,
      episodeName: target.episodeName,
      seriesId: target.seriesId,
      streamUrl,
      durationSecs: progress?.duration_secs ?? null,
    };
    this.tracks = [];
    this.lastKnownPositionSecs = 0;
    this.lastProgressWriteMs = 0;
    this.paused = false;
    this.emit({ type: "paused", paused: false });

    await this.ensureStarted();
    this.status = "loading";
    this.syncOverlay();
    this.emit({ type: "loading", channelId: episodeId, channelName: target.episodeName });
    await this.mpv!.setVolume(this.volume);
    await this.mpv!.setPaused(false);
    await this.mpv!.setAspect(this.aspect);
    await this.mpv!.play(streamUrl);
  }
```

- [ ] **Step 6: Flush progress on `stop()` and `setPaused()`** — replace `stop()`:

```ts
  async stop(): Promise<void> {
    if (this.current && this.current.kind !== "channel") {
      this.persistProgress(this.current, this.lastKnownPositionSecs);
    }
    this.current = null;
    this.tracks = [];
    this.status = "idle";
    this.syncOverlay();
    this.region?.hide();
    await this.mpv?.stop();
    this.mpv = null;
    this.emit({ type: "stopped" });
  }
```

Replace `setPaused`:

```ts
  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
    await this.mpv?.setPaused(paused);
    this.emit({ type: "paused", paused });
    if (paused && this.current && this.current.kind !== "channel") {
      this.persistProgress(this.current, this.lastKnownPositionSecs);
    }
  }
```

- [ ] **Step 7: Add `currentId()`, `persistProgress()`, `maybePersistProgress()` helpers** — insert as private methods (e.g. just above `private async ensureStarted`):

```ts
  private currentId(): string {
    if (!this.current) return "";
    if (this.current.kind === "channel") return this.current.target.channelId;
    if (this.current.kind === "movie") return this.current.movieId;
    return this.current.episodeId;
  }

  private maybePersistProgress(current: Extract<CurrentPlayback, { kind: "movie" | "episode" }>, positionSecs: number): void {
    const now = Date.now();
    if (now - this.lastProgressWriteMs < PlaybackController.PROGRESS_WRITE_INTERVAL_MS) return;
    this.lastProgressWriteMs = now;
    this.persistProgress(current, positionSecs);
  }

  private persistProgress(current: Extract<CurrentPlayback, { kind: "movie" | "episode" }>, positionSecs: number): void {
    const itemType = current.kind === "movie" ? "movie" : "episode";
    const itemId = current.kind === "movie" ? current.movieId : current.episodeId;
    setPlaybackProgress(this.db, itemType, itemId, positionSecs, current.durationSecs);
  }
```

- [ ] **Step 8: Rewrite `onMpvEvent`** to branch on `current.kind` and handle the two new event types — replace the whole method body:

```ts
  private onMpvEvent(event: MpvEvent): void {
    const current = this.current;

    switch (event.type) {
      case "playing": {
        if (!current) return;
        this.status = "playing";
        if (current.kind === "channel") recordRecent(this.db, current.target.channelId);
        else if (current.kind === "movie") recordMovieRecent(this.db, current.movieId);
        else recordSeriesRecent(this.db, current.seriesId);
        this.region?.show();
        this.syncOverlay();
        this.emit({ type: "playing", channelId: this.currentId() });
        if (this.pendingResumeSecs !== null) {
          const resumeSecs = this.pendingResumeSecs;
          this.pendingResumeSecs = null;
          void this.mpv?.seek(resumeSecs);
        }
        break;
      }
      case "tracks":
        if (!current) return;
        this.tracks = toPlaybackTracks(event.tracks);
        this.emit({ type: "tracks", channelId: this.currentId(), tracks: this.tracks });
        break;
      case "timeout":
        if (!current) return;
        this.status = "dead";
        this.syncOverlay();
        this.region?.hide();
        this.emit({ type: "timeout", channelId: this.currentId() });
        break;
      case "error":
        if (!current) return;
        this.status = "dead";
        this.syncOverlay();
        this.region?.hide();
        this.emit({ type: "error", channelId: this.currentId(), message: event.message });
        break;
      case "exited":
        this.status = "dead";
        this.syncOverlay();
        this.region?.hide();
        this.mpv = null;
        if (current) this.emit({ type: "error", channelId: this.currentId(), message: "The player stopped unexpectedly." });
        break;
      case "loading":
        break;
      case "time-pos":
        if (!current || current.kind === "channel") return;
        this.lastKnownPositionSecs = event.seconds;
        this.maybePersistProgress(current, event.seconds);
        break;
      case "end-file":
        if (!current || current.kind === "channel") return;
        if (event.reason === "eof") this.persistProgress(current, this.lastKnownPositionSecs);
        break;
    }
  }
```

- [ ] **Step 9: Generalise `snapshot()`** — replace its body:

```ts
  snapshot(): PlaybackSnapshot {
    return {
      status: this.status,
      channelId: this.current ? this.currentId() : null,
      channelName: this.current
        ? this.current.kind === "channel"
          ? this.current.target.channelName
          : this.current.kind === "movie"
            ? this.current.movieName
            : this.current.episodeName
        : null,
      tracks: this.tracks,
      paused: this.paused,
      volume: this.volume,
      aspect: this.aspect,
      fullscreen: this.mainWindow.isFullScreen(),
    };
  }
```

(`openInVlc()` needs no change — `this.current.streamUrl` is present on all three `CurrentPlayback` variants.)

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/main/mpv/mpvProcess.ts apps/desktop/src/main/playbackController.ts
git commit -m "Add movie/episode playback, resume seek, and progress persistence"
```

## Task 11: Renderer: Sidebar tabs

**Files:**
- Modify: `apps/desktop/src/renderer/src/player/Sidebar.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Icon.tsx`
- Modify: `apps/desktop/src/renderer/src/player/BrowseView.tsx` (keep `TITLES` exhaustive — see Step 3)

**Interfaces:**
- Consumes: nothing new
- Produces: `BrowseTab` widened to include `"movies" | "series"` (consumed by `PlayerScreen.tsx` in Tasks 13–14 and `BrowseView.tsx` in Task 15); `Icon` gains `"film"`, `"layers"`, `"check"` (consumed by Tasks 12 and 14).

`Icon.tsx` is edited here (rather than in Task 12/14, where its new icons are first used) because it's one shared file and Sidebar needs `"film"`/`"layers"` immediately — editing it once now, with everything downstream needs, avoids two separate agents touching the same small file.

- [ ] **Step 1: Widen `BrowseTab` and add two tabs** — in `apps/desktop/src/renderer/src/player/Sidebar.tsx`, replace line 5 and the `TABS` array:

```ts
export type BrowseTab = "live" | "guide" | "movies" | "series" | "favourites" | "recent" | "sources";

const TABS: { id: BrowseTab; label: string; icon: IconName }[] = [
  { id: "live", label: "Live TV", icon: "tv" },
  { id: "guide", label: "Guide", icon: "grid" },
  { id: "movies", label: "Movies", icon: "film" },
  { id: "series", label: "Series", icon: "layers" },
  { id: "favourites", label: "Favourites", icon: "star" },
  { id: "recent", label: "Recent", icon: "clock" },
  { id: "sources", label: "Sources", icon: "signal" },
];
```

- [ ] **Step 2: Add `film`, `layers`, `check` icons** — in `apps/desktop/src/renderer/src/components/Icon.tsx`, extend the `IconName` union (after `"trash"`):

```ts
  | "trash"
  | "film"
  | "layers"
  | "check";
```

Add matching entries to the `PATHS` map (after the `trash:` entry):

```ts
  film: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.2" />
      <path d="M2 5.5h12M2 10.5h12" />
      <circle cx="4.5" cy="4" r="0.6" />
      <circle cx="11.5" cy="4" r="0.6" />
      <circle cx="4.5" cy="12" r="0.6" />
      <circle cx="11.5" cy="12" r="0.6" />
    </>
  ),
  layers: (
    <>
      <path d="M8 2.5 14 6 8 9.5 2 6z" />
      <path d="M2 9.5 8 13l6-3.5" />
    </>
  ),
  check: <path d="M3.5 8.5l3 3 6-7" />,
```

- [ ] **Step 3: Keep `BrowseView.tsx`'s `TITLES` exhaustive** — `TITLES` is typed `Record<BrowseTab, string>`; widening `BrowseTab` in Step 1 means it now needs `"movies"`/`"series"` keys too, even though (like `"guide"`/`"sources"` already noted in the comment above it) those tabs never actually reach `BrowseView` — `PlayerScreen` branches to `MoviesView`/`SeriesView` directly (Tasks 13–14). In `apps/desktop/src/renderer/src/player/BrowseView.tsx`, replace the `TITLES` const:

```ts
// "guide", "sources", "movies", and "series" never actually reach this component —
// PlayerScreen branches to GuideView/SourcesView/MoviesView/SeriesView first — but BrowseTab
// is one shared union, so this stays total.
const TITLES: Record<BrowseTab, string> = {
  live: "Live TV",
  guide: "Guide",
  movies: "Movies",
  series: "Series",
  favourites: "Favourites",
  recent: "Recently watched",
  sources: "Sources",
};
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/player/Sidebar.tsx apps/desktop/src/renderer/src/components/Icon.tsx apps/desktop/src/renderer/src/player/BrowseView.tsx
git commit -m "Add Movies/Series sidebar tabs and their icons"
```

## Task 12: Renderer: PosterGrid component

**Files:**
- Create: `apps/desktop/src/renderer/src/player/PosterGrid.tsx`
- Modify: `apps/desktop/src/renderer/src/player/player.css` (append poster-grid styles)

**Interfaces:**
- Consumes: `Icon` (existing, extended in Task 11), `logoSrc` (existing, `apps/desktop/src/renderer/src/lib/logo.ts`)
- Produces: `PosterItem` (readonly interface), `PosterGrid({ items, onSelect, empty })` (React component) — consumed by Tasks 13–14.

Adapted from `ChannelGrid.tsx`/`ChannelCard.tsx`: portrait cards, no now/next line, a generic `PosterItem` shape so one component serves both movies and series.

- [ ] **Step 1: Write `PosterGrid.tsx`**:

```tsx
import { Icon } from "../components/Icon.js";
import { logoSrc } from "../lib/logo.js";

/** The minimal shape `PosterGrid` needs — `MoviesView`/`SeriesView` map their rows into this. */
export interface PosterItem {
  readonly id: string;
  readonly name: string;
  readonly posterUrl: string | null;
  readonly watched?: boolean;
}

export function PosterGrid({
  items,
  onSelect,
  empty,
}: {
  items: readonly PosterItem[];
  onSelect: (id: string) => void;
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="pw-empty">{empty}</p>;
  }
  return (
    <div className="pw-poster-grid">
      {items.map((item) => (
        <button key={item.id} type="button" className="pw-poster-card" onClick={() => onSelect(item.id)}>
          <span className="pw-poster-image">
            {item.posterUrl ? (
              <img src={logoSrc(item.posterUrl)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
            ) : (
              <Icon name="film" />
            )}
            {item.watched === true && (
              <span className="pw-poster-watched">
                <Icon name="check" size={12} />
              </span>
            )}
          </span>
          <span className="pw-poster-title">{item.name}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Append poster-grid CSS** to `apps/desktop/src/renderer/src/player/player.css` (using the confirmed tokens from `styles/tokens.css`: `--card`, `--border`, `--border-strong`, `--muted-foreground`, `--foreground`, `--accent`, `--accent-foreground`, `--r-2`, `--r-pill`, `--dur-2`, `--ease-out`, `--t-small`, `--lh-tight`):

```css
/* Poster grid (Movies/Series) — portrait cards, no now/next line. */
.pw-poster-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
  padding: 4px 0 24px;
}

.pw-poster-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
  color: inherit;
}

.pw-poster-image {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: var(--r-2);
  background: var(--card);
  border: 1px solid var(--border);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted-foreground);
  transition: border-color var(--dur-2) var(--ease-out);
}

.pw-poster-card:hover .pw-poster-image {
  border-color: var(--border-strong);
}

.pw-poster-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pw-poster-watched {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  border-radius: var(--r-pill);
  background: var(--accent);
  color: var(--accent-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
}

.pw-poster-title {
  font-size: var(--t-small);
  color: var(--foreground);
  line-height: var(--lh-tight);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/player/PosterGrid.tsx apps/desktop/src/renderer/src/player/player.css
git commit -m "Add PosterGrid component for movie/series poster browsing"
```

## Task 13: Renderer: MoviesView

**Files:**
- Create: `apps/desktop/src/renderer/src/player/MoviesView.tsx`
- Modify: `apps/desktop/src/renderer/src/lib/time.ts` (add `formatDuration`)
- Modify: `apps/desktop/src/renderer/src/player/PlayerScreen.tsx` (add the `"movies"` tab branch)
- Modify: `apps/desktop/src/renderer/src/player/player.css` (append detail-pane styles)

**Interfaces:**
- Consumes: `PosterGrid`, `PosterItem` (Task 12); `Icon` (existing); `logoSrc` (existing); `shouldPromptResume` (Task 6, via `@testcard/core`); `window.testcard.movies.*`, `window.testcard.progress.*`, `window.testcard.playback.playMovie` (Tasks 8–9); `MovieRow`, `MovieCategoryRow` (Task 6, via `@testcard/core`)
- Produces: `MoviesView({ scope?, onPlaybackStarted?, headerExtra? })` (React component) — consumed by `PlayerScreen.tsx` (this task, for the plain `"movies"` tab) and `BrowseView.tsx` (Task 15, for the Favourites/Recent switcher's Movies segment). `scope` (`"browse" | "favourites" | "recent"`, default `"browse"`) and `headerExtra` (`ReactNode`, rendered next to the heading) exist from the start so Task 15 only has to pass props in, never edit this file again.

- [ ] **Step 1: Add `formatDuration`** to `apps/desktop/src/renderer/src/lib/time.ts` (append after `formatRelative`):

```ts
/** "1:23:45" or "23:45" from a duration in seconds — for a resume/duration readout. */
export function formatDuration(totalSecs: number): string {
  const secs = Math.max(0, Math.round(totalSecs));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
```

- [ ] **Step 2: Write `MoviesView.tsx`**, mirroring `BrowseView.tsx`'s category-tree + search + grid + favourite-toggle wiring:

```tsx
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shouldPromptResume } from "@testcard/core";
import { Icon } from "../components/Icon.js";
import { formatDuration } from "../lib/time.js";
import { logoSrc } from "../lib/logo.js";
import { PosterGrid } from "./PosterGrid.js";

export function MoviesView({
  scope = "browse",
  onPlaybackStarted,
  headerExtra,
}: {
  scope?: "browse" | "favourites" | "recent";
  onPlaybackStarted?: () => void;
  headerExtra?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 160);
    return () => clearTimeout(id);
  }, [term]);

  const searching = scope === "browse" && debounced.length > 0;

  const categories = useQuery({
    queryKey: ["movies", "categories"],
    queryFn: () => window.testcard.movies.categoryList(),
    staleTime: 60_000,
    enabled: scope === "browse",
  });

  const list = useQuery({
    queryKey: ["movies", scope, categoryId, searching ? debounced : null, searching],
    queryFn: () => {
      if (scope === "favourites") return window.testcard.movies.favourites();
      if (scope === "recent") return window.testcard.movies.recent();
      if (searching) return window.testcard.movies.search(debounced);
      return window.testcard.movies.browse(categoryId !== null ? { categoryId } : {});
    },
    placeholderData: (prev) => prev,
  });

  const detail = useQuery({
    queryKey: ["movies", "details", selectedMovieId],
    queryFn: () => window.testcard.movies.details(selectedMovieId as string),
    enabled: selectedMovieId !== null,
  });

  const progress = useQuery({
    queryKey: ["progress", "movie", selectedMovieId],
    queryFn: () => window.testcard.progress.get("movie", selectedMovieId as string),
    enabled: selectedMovieId !== null,
  });

  const favourite = useMutation({
    mutationFn: (movieId: string) => window.testcard.movies.toggleFavourite(movieId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["movies"] }),
  });

  const play = useCallback(
    (resume: boolean) => {
      if (selectedMovieId === null) return;
      onPlaybackStarted?.();
      void window.testcard.playback.playMovie(selectedMovieId, { resume });
    },
    [selectedMovieId, onPlaybackStarted],
  );

  const rows = list.data ?? [];
  const promptResume = progress.data !== undefined && shouldPromptResume(progress.data.position_secs, progress.data.duration_secs);

  const heading = scope === "favourites" ? "Favourite movies" : scope === "recent" ? "Recently watched movies" : "Movies";
  const emptyText = list.isError
    ? "Couldn't load movies. Try refreshing the source."
    : searching
      ? `Nothing matches "${debounced}".`
      : scope === "favourites"
        ? "No favourite movies yet."
        : scope === "recent"
          ? "Nothing played yet."
          : "No movies. Add an Xtream source and refresh it.";

  return (
    <main className="pw-main">
      <div className="pw-head">
        <h2>{heading}</h2>
        {headerExtra}
        {scope === "browse" && (
          <div className="pw-search">
            <Icon name="search" size={15} />
            <input
              type="search"
              placeholder="Search movies"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              aria-label="Search movies"
            />
          </div>
        )}
      </div>

      <div className="pw-scroll">
        {scope === "browse" && (
          <div className="pw-cats pw-cats--inline">
            <button type="button" className="pw-cat" data-active={categoryId === null} onClick={() => setCategoryId(null)}>
              <span className="pw-cat-name">All movies</span>
            </button>
            {categories.data?.map((category) => (
              <button
                key={category.id}
                type="button"
                className="pw-cat"
                data-active={categoryId === category.id}
                onClick={() => setCategoryId(category.id)}
                title={category.name}
              >
                <span className="pw-cat-name">{category.name}</span>
                <span className="pw-cat-count">{category.movie_count}</span>
              </button>
            ))}
          </div>
        )}

        <PosterGrid
          items={rows.map((movie) => ({ id: movie.id, name: movie.name, posterUrl: movie.poster_url, watched: movie.watched === 1 }))}
          onSelect={setSelectedMovieId}
          empty={emptyText}
        />
      </div>

      {selectedMovieId !== null && (
        <div className="pw-detail-pane">
          <button type="button" className="pw-detail-close" aria-label="Close" onClick={() => setSelectedMovieId(null)}>
            <Icon name="x" />
          </button>
          {detail.data !== undefined ? (
            <>
              {detail.data.poster_url && (
                <img className="pw-detail-poster" src={logoSrc(detail.data.poster_url)} alt="" referrerPolicy="no-referrer" />
              )}
              <h3>{detail.data.name}</h3>
              {detail.data.plot && <p className="pw-detail-plot">{detail.data.plot}</p>}
              <div className="pw-detail-actions">
                {promptResume ? (
                  <>
                    <button type="button" className="btn btn--primary" onClick={() => play(true)}>
                      Resume from {formatDuration(progress.data!.position_secs)}
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => play(false)}>
                      Start over
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn--primary" onClick={() => play(false)}>
                    <Icon name="play" /> Play
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  aria-label={detail.data.is_favourite === 1 ? "Remove favourite" : "Add favourite"}
                  onClick={() => favourite.mutate(detail.data!.id)}
                >
                  <Icon name="star" filled={detail.data.is_favourite === 1} />
                </button>
              </div>
            </>
          ) : (
            <p className="pw-empty">Loading…</p>
          )}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Wire the `"movies"` tab into `PlayerScreen.tsx`** — add the import (after the `BrowseView` import):

```ts
import { MoviesView } from "./MoviesView.js";
```

Add a stable callback (after the existing `onBack` callback definition — this will be reused by Task 14's `"series"` branch and by Task 15's `BrowseView` wiring):

```tsx
  const onPlaybackStarted = useCallback(() => setInPlayer(true), []);
```

Insert a `tab === "movies"` branch into the ternary chain, between the existing `tab === "guide" ? ( <GuideView ... /> ) :` branch and the final `( <BrowseView ... /> )` fallback:

```tsx
      ) : tab === "movies" ? (
        <MoviesView onPlaybackStarted={onPlaybackStarted} />
      ) : (
```

- [ ] **Step 4: Append detail-pane CSS** to `apps/desktop/src/renderer/src/player/player.css` (reused by Task 14's episode list too):

```css
.pw-detail-pane {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(420px, 90vw);
  background: var(--surface-raised);
  border-left: 1px solid var(--border);
  padding: 24px;
  overflow-y: auto;
  z-index: var(--z-popover);
}

.pw-detail-close {
  background: none;
  border: none;
  color: var(--muted-foreground);
  cursor: pointer;
  padding: 4px;
}

.pw-detail-poster {
  width: 100%;
  max-width: 220px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: var(--r-2);
  margin: 12px 0;
}

.pw-detail-plot {
  color: var(--muted-foreground);
  font-size: var(--t-body);
  line-height: var(--lh-body);
  margin: 12px 0;
}

.pw-detail-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 16px;
  flex-wrap: wrap;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/player/MoviesView.tsx apps/desktop/src/renderer/src/lib/time.ts apps/desktop/src/renderer/src/player/PlayerScreen.tsx apps/desktop/src/renderer/src/player/player.css
git commit -m "Add MoviesView: browse, search, detail pane, resume/play"
```

## Task 14: Renderer: SeriesView

**Files:**
- Create: `apps/desktop/src/renderer/src/player/SeriesView.tsx`
- Modify: `apps/desktop/src/renderer/src/player/PlayerScreen.tsx` (add the `"series"` tab branch)
- Modify: `apps/desktop/src/renderer/src/player/player.css` (append episode-list styles)

**Interfaces:**
- Consumes: `PosterGrid`, `PosterItem` (Task 12); `Icon` (existing); `formatDuration` (Task 13, `lib/time.ts`); `shouldPromptResume` (Task 6, via `@testcard/core`); `window.testcard.series.*`, `window.testcard.playback.playEpisode` (Tasks 8–9); `SeriesRow`, `SeriesCategoryRow`, `EpisodeRow`, `SeriesDetail` (Task 6, via `@testcard/core`); `onPlaybackStarted` callback (Task 13, `PlayerScreen.tsx`)
- Produces: `SeriesView({ scope?, onPlaybackStarted?, headerExtra? })` (React component) — consumed by `PlayerScreen.tsx` (this task) and `BrowseView.tsx` (Task 15). Same `scope`/`headerExtra` shape as `MoviesView` so Task 15 treats both uniformly.

Unlike `MoviesView`'s single-item detail pane, `SeriesView`'s pane lists every season's episodes; each `EpisodeRow` (the core query row, already joined against `playback_progress` in Task 6) carries its own `position_secs`/`watched`, so no extra `progress.get` round trip is needed per episode — the resume decision is made locally with `shouldPromptResume`.

- [ ] **Step 1: Write `SeriesView.tsx`**:

```tsx
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shouldPromptResume, type EpisodeRow } from "@testcard/core";
import { Icon } from "../components/Icon.js";
import { formatDuration } from "../lib/time.js";
import { PosterGrid } from "./PosterGrid.js";

function EpisodeItem({ episode, onPlay }: { episode: EpisodeRow; onPlay: (episodeId: string, resume: boolean) => void }) {
  const promptResume = episode.position_secs !== null && shouldPromptResume(episode.position_secs, episode.duration_secs);
  return (
    <li className="pw-episode-row">
      <span className="pw-episode-num">{episode.episode_number}</span>
      <span className="pw-episode-name">{episode.name}</span>
      {episode.duration_secs !== null && <span className="pw-episode-duration">{formatDuration(episode.duration_secs)}</span>}
      {episode.watched === 1 && <Icon name="check" size={14} />}
      {promptResume ? (
        <>
          <button type="button" className="pw-episode-btn" onClick={() => onPlay(episode.id, true)}>
            Resume
          </button>
          <button type="button" className="pw-episode-btn" onClick={() => onPlay(episode.id, false)}>
            Restart
          </button>
        </>
      ) : (
        <button type="button" className="pw-episode-btn" aria-label="Play" onClick={() => onPlay(episode.id, false)}>
          <Icon name="play" size={12} />
        </button>
      )}
    </li>
  );
}

export function SeriesView({
  scope = "browse",
  onPlaybackStarted,
  headerExtra,
}: {
  scope?: "browse" | "favourites" | "recent";
  onPlaybackStarted?: () => void;
  headerExtra?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 160);
    return () => clearTimeout(id);
  }, [term]);

  const searching = scope === "browse" && debounced.length > 0;

  const categories = useQuery({
    queryKey: ["series", "categories"],
    queryFn: () => window.testcard.series.categoryList(),
    staleTime: 60_000,
    enabled: scope === "browse",
  });

  const list = useQuery({
    queryKey: ["series", scope, categoryId, searching ? debounced : null, searching],
    queryFn: () => {
      if (scope === "favourites") return window.testcard.series.favourites();
      if (scope === "recent") return window.testcard.series.recent();
      if (searching) return window.testcard.series.search(debounced);
      return window.testcard.series.browse(categoryId !== null ? { categoryId } : {});
    },
    placeholderData: (prev) => prev,
  });

  const detail = useQuery({
    queryKey: ["series", "episodes", selectedSeriesId],
    queryFn: () => window.testcard.series.episodes(selectedSeriesId as string),
    enabled: selectedSeriesId !== null,
  });

  const favourite = useMutation({
    mutationFn: (seriesId: string) => window.testcard.series.toggleFavourite(seriesId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["series"] }),
  });

  const playEpisode = useCallback(
    (episodeId: string, resume: boolean) => {
      onPlaybackStarted?.();
      void window.testcard.playback.playEpisode(episodeId, { resume }).then(() => {
        void queryClient.invalidateQueries({ queryKey: ["series", "episodes", selectedSeriesId] });
      });
    },
    [queryClient, selectedSeriesId, onPlaybackStarted],
  );

  const rows = list.data ?? [];

  const heading = scope === "favourites" ? "Favourite series" : scope === "recent" ? "Recently watched series" : "Series";
  const emptyText = list.isError
    ? "Couldn't load series. Try refreshing the source."
    : searching
      ? `Nothing matches "${debounced}".`
      : scope === "favourites"
        ? "No favourite series yet."
        : scope === "recent"
          ? "Nothing played yet."
          : "No series. Add an Xtream source and refresh it.";

  return (
    <main className="pw-main">
      <div className="pw-head">
        <h2>{heading}</h2>
        {headerExtra}
        {scope === "browse" && (
          <div className="pw-search">
            <Icon name="search" size={15} />
            <input
              type="search"
              placeholder="Search series"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              aria-label="Search series"
            />
          </div>
        )}
      </div>

      <div className="pw-scroll">
        {scope === "browse" && (
          <div className="pw-cats pw-cats--inline">
            <button type="button" className="pw-cat" data-active={categoryId === null} onClick={() => setCategoryId(null)}>
              <span className="pw-cat-name">All series</span>
            </button>
            {categories.data?.map((category) => (
              <button
                key={category.id}
                type="button"
                className="pw-cat"
                data-active={categoryId === category.id}
                onClick={() => setCategoryId(category.id)}
                title={category.name}
              >
                <span className="pw-cat-name">{category.name}</span>
                <span className="pw-cat-count">{category.series_count}</span>
              </button>
            ))}
          </div>
        )}

        <PosterGrid
          items={rows.map((series) => ({ id: series.id, name: series.name, posterUrl: series.poster_url }))}
          onSelect={setSelectedSeriesId}
          empty={emptyText}
        />
      </div>

      {selectedSeriesId !== null && (
        <div className="pw-detail-pane pw-detail-pane--series">
          <button type="button" className="pw-detail-close" aria-label="Close" onClick={() => setSelectedSeriesId(null)}>
            <Icon name="x" />
          </button>
          {detail.data !== undefined ? (
            <>
              <h3>{detail.data.series.name}</h3>
              {detail.data.series.plot && <p className="pw-detail-plot">{detail.data.series.plot}</p>}
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                aria-label={detail.data.series.is_favourite === 1 ? "Remove favourite" : "Add favourite"}
                onClick={() => favourite.mutate(detail.data!.series.id)}
              >
                <Icon name="star" filled={detail.data.series.is_favourite === 1} />
              </button>
              {detail.data.seasons.map((season) => (
                <div key={season.id} className="pw-season">
                  <p className="pw-section-label">{season.name ?? `Season ${season.season_number}`}</p>
                  <ul className="pw-episode-list">
                    {season.episodes.map((episode) => (
                      <EpisodeItem key={episode.id} episode={episode} onPlay={playEpisode} />
                    ))}
                  </ul>
                </div>
              ))}
            </>
          ) : (
            <p className="pw-empty">Loading episodes…</p>
          )}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Wire the `"series"` tab into `PlayerScreen.tsx`** — add the import (after Task 13's `MoviesView` import):

```ts
import { SeriesView } from "./SeriesView.js";
```

Insert a `tab === "series"` branch immediately after Task 13's `tab === "movies"` branch, before the final `( <BrowseView ... /> )` fallback:

```tsx
      ) : tab === "series" ? (
        <SeriesView onPlaybackStarted={onPlaybackStarted} />
      ) : (
```

- [ ] **Step 3: Append episode-list CSS** to `apps/desktop/src/renderer/src/player/player.css`:

```css
.pw-episode-list {
  list-style: none;
  margin: 0 0 20px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pw-episode-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  border-radius: var(--r-1);
}

.pw-episode-row:hover {
  background: var(--card-hover);
}

.pw-episode-num {
  width: 24px;
  color: var(--muted-foreground);
  font-size: var(--t-small);
  text-align: right;
}

.pw-episode-name {
  flex: 1;
  font-size: var(--t-body);
  color: var(--foreground);
}

.pw-episode-duration {
  color: var(--muted-foreground);
  font-size: var(--t-small);
}

.pw-episode-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--r-1);
  color: var(--foreground);
  padding: 4px 10px;
  font-size: var(--t-small);
  cursor: pointer;
}

.pw-episode-btn:hover {
  background: var(--card-hover);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/player/SeriesView.tsx apps/desktop/src/renderer/src/player/PlayerScreen.tsx apps/desktop/src/renderer/src/player/player.css
git commit -m "Add SeriesView: browse, search, season/episode list, resume/play"
```

## Task 15: Renderer: Favourites/Recents segmented switcher

**Files:**
- Modify: `apps/desktop/src/renderer/src/player/BrowseView.tsx`
- Modify: `apps/desktop/src/renderer/src/player/PlayerScreen.tsx` (pass `onPlaybackStarted` through to `BrowseView`)
- Modify: `apps/desktop/src/renderer/src/player/player.css` (append segmented-switcher styles)

**Interfaces:**
- Consumes: `MoviesView`, `SeriesView` (Tasks 13–14, both already support `scope`/`headerExtra`/`onPlaybackStarted`); `onPlaybackStarted` callback (Task 13, defined in `PlayerScreen.tsx`)
- Produces: nothing new for later tasks — this is the final wiring task.

`BrowseView` keeps all its existing hooks unconditional (React's rules of hooks) — the channel-specific queries (`categories`, `countries`, `list`, `recent`, `epg`) just gate on a new `contentType === "live"` condition via their `enabled` option, and the JSX return branches at the very end into either the existing channel markup or the new `MoviesView`/`SeriesView` embed.

- [ ] **Step 1: Add `contentType` state and the segmented switcher** — in `apps/desktop/src/renderer/src/player/BrowseView.tsx`, add the import:

```ts
import { MoviesView } from "./MoviesView.js";
import { SeriesView } from "./SeriesView.js";
```

Add a new prop to the component's destructured parameters (alongside the existing `tab`, `categoryId`, `activeChannelId`, `onPlay`, `onListChange`):

```ts
  onPlaybackStarted,
```

with its type added to the props type: `onPlaybackStarted: () => void;`.

Add local state near the top of the component body (after the existing `const [country, setCountry] = useState<string | null>(null);`):

```tsx
  const [contentType, setContentType] = useState<"live" | "movies" | "series">("live");
  const showSwitcher = tab === "favourites" || tab === "recent";
```

- [ ] **Step 2: Gate the channel-specific queries** — add `enabled: !showSwitcher || contentType === "live"` (combined with any existing `enabled`) to the `categories`, `countries`, `list`, `recent`, and `epg` `useQuery` calls. For example, `list` becomes:

```tsx
  const list = useQuery({
    queryKey: ["channels", tab, categoryId, searching ? debounced : country, searching],
    queryFn: () => {
      if (searching) return window.testcard.channels.search(debounced);
      if (tab === "favourites") return window.testcard.channels.favourites();
      if (tab === "recent") return window.testcard.channels.recent();
      if (inCategory) return window.testcard.channels.browse({ categoryId });
      return window.testcard.channels.browse(country !== null ? { country } : {});
    },
    enabled: !showSwitcher || contentType === "live",
    placeholderData: (prev) => prev,
  });
```

Apply the same gate to the other four channel-specific queries. `categories` and `countries` (`BrowseView.tsx` lines 46–50 and 56–60) currently have no `enabled` option at all — add one:

```tsx
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => window.testcard.channels.categoryList(),
    staleTime: 60_000,
    enabled: !showSwitcher || contentType === "live",
  });
```

```tsx
  const countries = useQuery({
    queryKey: ["channels", "countries"],
    queryFn: () => window.testcard.channels.countryList(),
    staleTime: 60_000,
    enabled: !showSwitcher || contentType === "live",
  });
```

`recent` (line 74) already has `enabled: tab === "live" && !searching && !inCategory` — combine with `&&`:

```tsx
  const recent = useQuery({
    queryKey: ["channels", "recent"],
    queryFn: () => window.testcard.channels.recent(),
    enabled: tab === "live" && !searching && !inCategory && (!showSwitcher || contentType === "live"),
  });
```

`epg` (line 89) already has `enabled: channelIds.length > 0` — combine with `&&`:

```tsx
  const epg = useQuery({
    queryKey: ["epg", "now-next", channelIds],
    queryFn: () => window.testcard.epg.nowNext(channelIds),
    enabled: channelIds.length > 0 && (!showSwitcher || contentType === "live"),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
```

- [ ] **Step 3: Build the switcher element and branch the return** — add just before the component's `return` statement:

```tsx
  const switcher = showSwitcher ? (
    <div className="pw-segmented" role="tablist" aria-label="Content type">
      {(["live", "movies", "series"] as const).map((ct) => (
        <button
          key={ct}
          type="button"
          role="tab"
          className="pw-segmented-item"
          data-active={contentType === ct}
          aria-selected={contentType === ct}
          onClick={() => setContentType(ct)}
        >
          {ct === "live" ? "Live" : ct === "movies" ? "Movies" : "Series"}
        </button>
      ))}
    </div>
  ) : null;

  // Test `tab` directly (not the derived `showSwitcher` boolean) in each branch condition —
  // TS narrows `tab: BrowseTab` down to "favourites" | "recent" here, matching MoviesView/
  // SeriesView's `scope` prop type; narrowing does not propagate through an intermediate
  // boolean like `showSwitcher`.
  if ((tab === "favourites" || tab === "recent") && contentType === "movies") {
    return <MoviesView scope={tab} onPlaybackStarted={onPlaybackStarted} headerExtra={switcher} />;
  }
  if ((tab === "favourites" || tab === "recent") && contentType === "series") {
    return <SeriesView scope={tab} onPlaybackStarted={onPlaybackStarted} headerExtra={switcher} />;
  }
```

Then, inside the existing `<div className="pw-head">` block (right after the `<h2>{heading}</h2>` line), render the switcher for the `"live"` segment too:

```tsx
        <h2>{heading}</h2>
        {switcher}
```

- [ ] **Step 4: Pass `onPlaybackStarted` from `PlayerScreen.tsx`** — add the prop to the existing `<BrowseView ... />` call (the fallback branch of the ternary chain built up across Tasks 13–14):

```tsx
        <BrowseView
          tab={tab}
          categoryId={categoryId}
          activeChannelId={activeChannelId}
          onPlay={onPlay}
          onListChange={setPlaylist}
          onPlaybackStarted={onPlaybackStarted}
        />
```

- [ ] **Step 5: Append segmented-switcher CSS** to `apps/desktop/src/renderer/src/player/player.css`:

```css
.pw-segmented {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  padding: 2px;
  gap: 2px;
}

.pw-segmented-item {
  border: none;
  background: none;
  color: var(--muted-foreground);
  font-size: var(--t-small);
  padding: 6px 14px;
  border-radius: var(--r-pill);
  cursor: pointer;
}

.pw-segmented-item[data-active="true"] {
  background: var(--accent-soft);
  color: var(--accent);
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/player/BrowseView.tsx apps/desktop/src/renderer/src/player/PlayerScreen.tsx apps/desktop/src/renderer/src/player/player.css
git commit -m "Add Live/Movies/Series switcher to Favourites and Recent"
```

## Task 16: Final integration pass + hardware checklist

**Files:**
- None (verification only — this task produces no code)

**Interfaces:**
- Consumes: the entire app, run via `pnpm dev`
- Produces: a confirmed-working Phase 4b, ready for the same "user hardware-tests, then merges" flow as prior phases (see `docs/phase-4a-brief.md`'s tone/format, which this checklist mirrors).

- [ ] **Step 1: Build and typecheck cleanly**

```bash
pnpm install
pnpm --filter @testcard/core build
pnpm typecheck
pnpm lint
pnpm --filter @testcard/core test
```

All of `packages/core`'s vitest suite (including this phase's `vod.test.ts` and `progress.test.ts`) must pass; `pnpm typecheck` must be clean across both `packages/core` and `apps/desktop`.

- [ ] **Step 2: Run `pnpm dev` and work through this checklist** (mirrors `docs/phase-4a-brief.md`'s "Verify on hardware" format — mark each line as it passes):

  - **Migration**: launch against a pre-Phase-4b `testcard.sqlite3` → opens clean, `schema_meta.version` = 4, all new tables exist, no data lost (existing channels/favourites/EPG untouched). A fresh install lands at the same state.
  - **Refresh imports VOD**: refresh an Xtream source → movie/series categories and titles appear in the Movies/Series tabs; an M3U source shows no Movies/Series tabs at all (Sidebar still only has Live/Guide/Favourites/Recent/Sources for it — actually verify the tabs render but are simply empty/unreachable, per Scope: "M3U sources get no Movies/Series UI" means empty content, not a hidden tab, unless product intent is to hide them — confirm against the live app and note any follow-up).
  - **Browse movies**: category tree filters the poster grid; search matches partial titles; clicking a poster opens the detail pane with poster/plot (plot appears after the first open, confirming the lazy `get_vod_info` fetch — check `movies.details_fetched_at` is no longer NULL in the DB).
  - **Play + resume a movie**: press Play on a movie with no prior progress → starts at 0, no prompt. Quit partway (close the app or navigate back), reopen the same movie → "Resume from mm:ss" / "Start over" prompt appears; Resume seeks to roughly the right position; Start over begins at 0.
  - **Watched marker (movie)**: let a movie play past 95% of its duration (or manually set `playback_progress.position_secs` close to `duration_secs` in the DB for a fast check) → the poster grid shows the watched checkmark on next load.
  - **Browse series → episodes**: clicking a series lazily fetches and shows its season/episode list (confirm `series.episodes_fetched_at` goes from NULL to a timestamp); reopening the same series does not re-fetch (no new network call, same `episodes_fetched_at`).
  - **Play + resume an episode**: same resume/restart flow as the movie case, scoped to one episode; watched checkmark appears on that episode row after crossing 95%.
  - **Favourites/Recents per content type**: favourite a movie and a series from their respective views; visit the Favourites tab, switch the Live/Movies/Series segmented control → each segment shows only that type's favourites. Same check for Recent (a played movie/episode/channel appears in its own segment, most-recent-first).
  - **Refresh invalidates a previously-opened series**: open a series (populating its episodes), refresh its source again, reopen the same series → episodes are re-fetched (a fresh `episodes_fetched_at` timestamp), not silently stale.
  - **Delete a source**: remove an Xtream source that had movies/series → its `movies`/`series`/`seasons`/`episodes`/`movie_categories`/`series_categories` rows are gone (FK cascade), `movie_favourites`/`movie_recents`/`series_favourites`/`series_recents` pointing at now-gone ids are pruned, and its cached poster files under `userData/logo-cache` are removed (spot-check a poster's `sha1(url)` file is gone).
  - **Regression — live playback untouched**: HEVC + E-AC-3 channel playback, prev/next channel step, guide, dead-channel handling, both themes, overlay auto-hide/z-order all still behave exactly as in Phase 4a — this phase's `PlaybackController`/`MpvPlayer` changes must not have altered channel playback's `time-pos`/`end-file` behavior (channels simply ignore the new events, per the `current.kind === "channel"` guards).
  - **No CSP/console errors** anywhere in the above.

- [ ] **Step 3: Note any findings** — if any checklist item fails or surfaces a design gap (e.g. the M3U-source tab-visibility question above), record it as a carry-over note for the next phase brief rather than silently reworking scope; this plan's job ends at a hardware-verified Phase 4b matching the design spec.

