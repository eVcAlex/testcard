/**
 * SQLite schema. Executed by the desktop app's main process against `better-sqlite3` —
 * `packages/core` only owns the SQL text so it stays free of a hard dependency on any one
 * SQLite binding (relevant if a future platform needs a different one).
 *
 * Design notes:
 *  - `channels.id` / `channel_variants.id` are the stable internal ids from `groupVariants`
 *    (content-hash based), not provider ids — see CONTEXT.md "Refresh".
 *  - `channels_fts` indexes the *normalised* name (see `normalise/parseName`), so search
 *    matches "tnt" against "UK| TNT Sports ᴳᴬᴺᴶᴬ" — content is synced via triggers, not kept
 *    in application code, so it can never drift from the base table.
 *  - No foreign key ON DELETE CASCADE from favourites/recents to channels: a channel
 *    disappearing from a provider should not silently delete a user's favourite; a dangling
 *    favourite instead surfaces in the UI as "no longer available".
 */
export const SCHEMA_VERSION = 7;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

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
  sync_deleted_at INTEGER,      -- sync tombstone; NULL = live
  include_live    INTEGER NOT NULL DEFAULT 1,  -- per-source content switches (xtream); m3u is live-only
  include_movies  INTEGER NOT NULL DEFAULT 1,
  include_series  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sources_remote_key ON sources(remote_key);

CREATE TABLE IF NOT EXISTS categories (
  id            TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  provider_id   TEXT NOT NULL,
  raw_name      TEXT NOT NULL,
  country       TEXT,           -- parsed "UK", "CA", ... or NULL; drives the sidebar tree
  genre         TEXT,           -- classifyCategory(): advisory canonical genre, NULL = unrecognised
  language      TEXT,           -- ISO 639-1, "multi", or NULL
  service       TEXT,           -- streaming brand ("netflix", "disney+", ...) or NULL
  tags          TEXT NOT NULL DEFAULT ''   -- space-separated: ppv 4k 8k vip raw adult separator junk
);
CREATE INDEX IF NOT EXISTS idx_categories_source ON categories(source_id);
CREATE INDEX IF NOT EXISTS idx_categories_country ON categories(country);

CREATE TABLE IF NOT EXISTS channels (
  id                TEXT PRIMARY KEY,
  source_id         TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  category_id       TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  normalised_name   TEXT NOT NULL,
  raw_name          TEXT NOT NULL,
  country           TEXT,
  logo_url          TEXT,
  channel_number    INTEGER,
  catchup_type      TEXT,
  catchup_days      INTEGER,
  tvg_id            TEXT,        -- links to XMLTV <programme channel="...">
  first_seen_at     INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL   -- updated on every refresh; drives stale-channel cleanup
);
CREATE INDEX IF NOT EXISTS idx_channels_category ON channels(category_id);
CREATE INDEX IF NOT EXISTS idx_channels_tvg_id ON channels(tvg_id);

CREATE TABLE IF NOT EXISTS channel_variants (
  id                  TEXT PRIMARY KEY,
  channel_id          TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  provider_stream_id  TEXT NOT NULL,
  quality             TEXT,
  is_offline          INTEGER NOT NULL DEFAULT 0,
  sort_order          INTEGER NOT NULL DEFAULT 0   -- best quality first, see groupVariants
);
CREATE INDEX IF NOT EXISTS idx_variants_channel ON channel_variants(channel_id);

CREATE TABLE IF NOT EXISTS programmes (
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  start_at      INTEGER NOT NULL,   -- unix ms
  end_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_programmes_channel_time ON programmes(channel_id, start_at, end_at);

CREATE TABLE IF NOT EXISTS favourites (
  channel_id    TEXT PRIMARY KEY,
  added_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recents (
  channel_id    TEXT PRIMARY KEY,
  played_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recents_played_at ON recents(played_at DESC);

-- FTS5 over the normalised name. Kept in sync with the channels table by triggers rather
-- than application code, so a manual UPDATE/DELETE against channels can never desync it.
CREATE VIRTUAL TABLE IF NOT EXISTS channels_fts USING fts5(
  normalised_name,
  content='channels',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS channels_fts_insert AFTER INSERT ON channels BEGIN
  INSERT INTO channels_fts(rowid, normalised_name) VALUES (new.rowid, new.normalised_name);
END;

CREATE TRIGGER IF NOT EXISTS channels_fts_delete AFTER DELETE ON channels BEGIN
  INSERT INTO channels_fts(channels_fts, rowid, normalised_name) VALUES ('delete', old.rowid, old.normalised_name);
END;

CREATE TRIGGER IF NOT EXISTS channels_fts_update AFTER UPDATE ON channels BEGIN
  INSERT INTO channels_fts(channels_fts, rowid, normalised_name) VALUES ('delete', old.rowid, old.normalised_name);
  INSERT INTO channels_fts(rowid, normalised_name) VALUES (new.rowid, new.normalised_name);
END;

CREATE TABLE IF NOT EXISTS movie_categories (
  id            TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  provider_id   TEXT NOT NULL,
  raw_name      TEXT NOT NULL,
  country       TEXT,
  genre         TEXT,           -- classifyCategory(): advisory canonical genre, NULL = unrecognised
  language      TEXT,           -- ISO 639-1, "multi", or NULL
  service       TEXT,           -- streaming brand ("netflix", "disney+", ...) or NULL
  tags          TEXT NOT NULL DEFAULT ''   -- space-separated: ppv 4k 8k vip raw adult separator junk
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
  last_seen_at        INTEGER NOT NULL,
  remote_key          TEXT   -- sha1(normalizedHost + providerStreamId), see sync/remoteKey.ts
);
CREATE INDEX IF NOT EXISTS idx_movies_category ON movies(category_id);
CREATE INDEX IF NOT EXISTS idx_movies_remote_key ON movies(remote_key);

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
  country       TEXT,
  genre         TEXT,           -- classifyCategory(): advisory canonical genre, NULL = unrecognised
  language      TEXT,           -- ISO 639-1, "multi", or NULL
  service       TEXT,           -- streaming brand ("netflix", "disney+", ...) or NULL
  tags          TEXT NOT NULL DEFAULT ''   -- space-separated: ppv 4k 8k vip raw adult separator junk
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
  last_seen_at         INTEGER NOT NULL,
  remote_key           TEXT   -- sha1(normalizedHost + providerSeriesId), see sync/remoteKey.ts
);
CREATE INDEX IF NOT EXISTS idx_series_category ON series(category_id);
CREATE INDEX IF NOT EXISTS idx_series_remote_key ON series(remote_key);

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
  plot                 TEXT,
  remote_key           TEXT   -- sha1(normalizedHost + providerEpisodeId), see sync/remoteKey.ts
);
CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id);
CREATE INDEX IF NOT EXISTS idx_episodes_remote_key ON episodes(remote_key);

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

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
