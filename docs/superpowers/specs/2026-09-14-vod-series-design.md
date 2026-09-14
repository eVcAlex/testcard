# Phase 4b: VOD & series — design

## Scope

Xtream-only. M3U sources get no Movies/Series tab — M3U playlists carry no series/episode
metadata, so there's nothing to build the UI on. An M3U-sourced install is unaffected by this
phase entirely.

MVP is browse + play + resume/watched state: category tree, poster grid, search, favourites,
recently-watched, and per-title playback position with a watched marker. No cast/plot deep-dive
beyond whatever Xtream hands back on the lazy detail fetch (Section 3); no rating/genre filtering
UI; no offline/download support.

## Data model

`SCHEMA_VERSION` 3 → 4. All new tables (`CREATE TABLE`), no `ALTER` on existing ones.

```sql
CREATE TABLE movie_categories (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL, raw_name TEXT NOT NULL, country TEXT
);

CREATE TABLE movies (
  id                  TEXT PRIMARY KEY,   -- idFor(source.id, vod stream_id)
  source_id           TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  category_id         TEXT NOT NULL REFERENCES movie_categories(id) ON DELETE CASCADE,
  provider_stream_id  TEXT NOT NULL,
  name                TEXT NOT NULL,
  poster_url          TEXT,
  container_extension TEXT,               -- from get_vod_streams; builds the stream URL
  rating              TEXT,
  plot                TEXT,                -- NULL until lazily fetched, see "Lazy per-item fetch"
  duration_secs       INTEGER,             -- NULL until lazily fetched
  details_fetched_at  INTEGER,             -- NULL = never fetched or refresh invalidated it
  first_seen_at       INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL
);
CREATE INDEX idx_movies_category ON movies(category_id);

CREATE VIRTUAL TABLE movies_fts USING fts5(name, content='movies', content_rowid='rowid');
-- + insert/delete/update triggers, mirroring channels_fts exactly.

CREATE TABLE series_categories (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL, raw_name TEXT NOT NULL, country TEXT
);

CREATE TABLE series (
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
CREATE VIRTUAL TABLE series_fts USING fts5(name, content='series', content_rowid='rowid');
-- + same trigger set.

CREATE TABLE seasons (
  id            TEXT PRIMARY KEY,   -- idFor(series.id, season_number)
  series_id     TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  name          TEXT,
  poster_url    TEXT
);
CREATE INDEX idx_seasons_series ON seasons(series_id);

CREATE TABLE episodes (
  id                   TEXT PRIMARY KEY,  -- idFor(season.id, provider episode id)
  season_id            TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  series_id            TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE, -- denormalised, avoids a join for progress/recents lookups
  provider_episode_id  TEXT NOT NULL,
  episode_number       INTEGER NOT NULL,
  name                 TEXT NOT NULL,
  container_extension  TEXT,
  duration_secs        INTEGER,
  plot                 TEXT
);
CREATE INDEX idx_episodes_season ON episodes(season_id);
CREATE INDEX idx_episodes_series ON episodes(series_id);

-- Mirror favourites/recents exactly: no FK cascade — a vanished title shouldn't silently
-- drop a user's favourite; a dangling row surfaces in the UI as "no longer available".
CREATE TABLE movie_favourites  (movie_id  TEXT PRIMARY KEY, added_at  INTEGER NOT NULL);
CREATE TABLE movie_recents     (movie_id  TEXT PRIMARY KEY, played_at INTEGER NOT NULL);
CREATE INDEX idx_movie_recents_played_at ON movie_recents(played_at DESC);

CREATE TABLE series_favourites (series_id TEXT PRIMARY KEY, added_at  INTEGER NOT NULL);
CREATE TABLE series_recents    (series_id TEXT PRIMARY KEY, played_at INTEGER NOT NULL); -- bumped on any episode play
CREATE INDEX idx_series_recents_played_at ON series_recents(played_at DESC);

-- The one polymorphic table in this design: progress-tracking logic (position, watched
-- threshold) is identical for a movie and an episode, with no existing per-type precedent
-- to mirror, so it isn't split into movie_progress/episode_progress.
CREATE TABLE playback_progress (
  item_type     TEXT NOT NULL CHECK (item_type IN ('movie', 'episode')),
  item_id       TEXT NOT NULL,
  position_secs INTEGER NOT NULL,
  duration_secs INTEGER,
  watched       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (item_type, item_id)
);
```

No `ChannelVariant`-style quality grouping for movies/episodes: Xtream doesn't split VOD into
quality variants the way live streams are; one title is one stream, one direct URL.

## Adapter surface

VOD/series methods live outside `SourceAdapter` — Xtream-only, so there's no M3U implementation
to require. Same precedent as `fetchShortEpg` in `packages/core/src/source/xtream/client.ts`.

New file `packages/core/src/source/xtream/vod.ts`:

```ts
fetchVodCategories(source): Promise<Category[]>
fetchMovies(source, category): Promise<Movie[]>
fetchSeriesCategories(source): Promise<Category[]>
fetchSeriesList(source, category): Promise<Series[]>
fetchSeriesDetails(source, series): Promise<{ seasons: Season[]; episodes: Episode[] }>  // get_series_info
fetchVodDetails(source, movie): Promise<{ plot?: string; durationSecs?: number }>        // get_vod_info
buildMovieStreamUrl(source, movie): Promise<string>     // .../movie/<user>/<pass>/<id>.<ext>
buildEpisodeStreamUrl(source, episode): Promise<string> // .../series/<user>/<pass>/<episodeId>.<ext>
```

Callers (db import, IPC handlers) branch on `source.kind === "xtream"` before calling these,
exactly like `fetchShortEpg` today.

## Import strategy

**On Refresh** (Xtream sources only), immediately after channel import: `get_vod_categories` +
`get_vod_streams` per category, and `get_series_categories` + `get_series` per category — both
one bulk call per category, same cost profile as live channel import. Diff-and-merge by stable
id, `last_seen_at` bump, stale-row pruning — same pattern as `importSource.ts`.

A refresh also resets `details_fetched_at` (movies) and `episodes_fetched_at` (series) to `NULL`
for every row it touches, rather than deleting rows outright: title/poster/category data updates
in place (ids are stable, so favourites/progress survive), but any previously-fetched season/
episode list or movie detail is now presumed stale and will be re-fetched lazily next time that
title is opened.

**Lazy per-item fetch**: `get_series_info` is one API call *per series* — with a provider
catalog of thousands of series, bulk-fetching all of them on every refresh is infeasible. Instead
it runs the first time a user opens a series whose `episodes_fetched_at` is `NULL`, replacing
that series' `seasons`/`episodes` rows with a delete-then-insert (same reasoning as EPG import:
cheap to fully replace a leaf list, no diff needed), then stamps `episodes_fetched_at`.

`get_vod_info` (movie plot/duration) follows the same lazy, cached, stamped pattern, but it's
pure enrichment — a failed or skipped fetch never blocks playback, since `container_extension`
(needed to build the stream URL) is expected from the cheap bulk `get_vod_streams` call. Some
Xtream panels omit it there; if the field is missing/empty on import, fall back to reading it
from the lazy `get_vod_info` fetch at play time (blocking only for that one title, not the bulk
import), defaulting to `mp4` if both are empty.

## Playback, resume, watched state

VOD/episode playback reuses `PlayerScreen`'s existing `buildStreamUrl` → mpv `loadfile` path
unchanged — functionally identical to live playback once a URL is built.

- **On load**: if `playback_progress` has a row for the item with `position_secs` between ~30s
  and ~95% of `duration_secs`, prompt "Resume from 12:34" vs. "Start over" before loading. Below
  the floor or past the ceiling, just start from 0 — no prompt for a few seconds watched or a
  title already finished.
- **While playing**: the main process observes mpv's `time-pos` via the existing
  `MpvIpcClient.observeProperty` (same mechanism already driving volume/aspect persistence),
  persisting `playback_progress` debounced (~5s) and on pause/stop/`end-file`. Crossing 95% of
  duration sets `watched = 1`.

## IPC & renderer

New `window.testcard.movies.*` / `window.testcard.series.*` namespaces mirroring
`window.testcard.channels.*`: `categoryList`, `browse`, `search`, `favourites`,
`toggleFavourite`, `recent`. `series` additionally exposes `episodes(seriesId)` (lazy-fetch-or-
cached, per the import strategy above). A shared `window.testcard.progress.get/set(itemType,
itemId)` backs the resume/watched behaviour.

## UI

- Sidebar gains two top-level tabs, "Movies" and "Series", after "Guide" — `BrowseTab` (currently
  `live | guide | favourites | recent | sources`) is extended, following the same
  whole-pane-swap pattern `"guide"` and `"sources"` already use in `PlayerScreen`.
- `MoviesView`: category tree + a new `PosterGrid` (portrait cards adapted from `ChannelGrid`, no
  now/next line) + search. Clicking a movie opens a detail pane (poster, plot if fetched,
  Play/Resume) rather than playing immediately — resume needs a decision point, unlike a channel.
- `SeriesView`: category tree + poster grid of series. Clicking a series opens its season/episode
  list (lazy-loaded per the import strategy); each episode row has a play control, a resume
  indicator, and a watched checkmark.
- Favourites and Recently-watched tabs gain a Live/Movies/Series segmented switcher at the top,
  each position querying its own table — no merged/interleaved list.
- Poster images need no new cache: `apps/desktop/src/main/logoCache.ts`'s `testcard-logo://`
  scheme is already a generic `sha1(url) → bytes` cache with zero channel-specific logic, so
  poster URLs flow through it unchanged. Source deletion's existing `purgeCachedLogos(urls)` just
  needs that source's movie/series poster URLs added to its purge list alongside channel logos.

## Testing

Pure-function unit tests in `packages/core/__tests__` for the Xtream VOD/series DTO mappers
(`fetchMovies`, `fetchSeriesList`, `fetchSeriesDetails` parsing) and the watched-threshold logic
— no DB-backed tests, per ADR 0003 (`better-sqlite3`'s native binding is Electron's ABI, not
plain Node's). The existing migration test's contiguity/version-match guard picks up the new
migration automatically once it's appended.

Hardware checklist (mirrors prior phase briefs): browse/play/resume/watched-marker for both a
movie and a series episode; favourites/recents per content type; a source refresh invalidates and
re-fetches a previously-opened series' episode list; deleting a source purges its movie/series
rows and cached posters; regression pass on live playback, both themes, overlay.

## Carry-overs (explicitly out of scope this phase)

Everything already open from Phase 3/4a (Xtream `get_short_epg` wiring, guide virtualization,
logo-cache eviction, `packages/core` DB unit tests) stays open — untouched by this phase. Also
out of scope here: cast/crew metadata beyond what's cheaply available, rating/genre filter UI,
offline downloads, M3U VOD support (see Scope).
