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
export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('xtream', 'm3u')),
  name          TEXT NOT NULL,
  base_url      TEXT,           -- xtream only
  playlist_url  TEXT,           -- m3u only
  epg_url       TEXT,           -- m3u only, optional
  created_at    INTEGER NOT NULL,
  last_refreshed_at INTEGER
);

CREATE TABLE IF NOT EXISTS categories (
  id            TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  provider_id   TEXT NOT NULL,
  raw_name      TEXT NOT NULL,
  country       TEXT            -- parsed "UK", "CA", ... or NULL; drives the sidebar tree
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

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
