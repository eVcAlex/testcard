import type Database from "better-sqlite3";

export interface Migration {
  readonly version: number;
  readonly up: (db: Database.Database) => void;
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((row) => row.name === column);
}

/** `ALTER TABLE ADD COLUMN`, skipped if the column is somehow already present. */
function addColumn(db: Database.Database, table: string, columnDef: string): void {
  const column = columnDef.split(/\s+/)[0];
  if (column !== undefined && !hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  }
}

/**
 * Forward-only schema migrations. `schema.ts`'s `SCHEMA_SQL` always describes the *latest*
 * shape, so a fresh database is built correct and skips every migration; these bring an
 * older database (one created by a previous release) up to `SCHEMA_VERSION`. `openDatabase`
 * runs the pending set inside one transaction and bumps the stored version.
 *
 * Adding a migration: append an entry here and bump `SCHEMA_VERSION` + `SCHEMA_SQL` to match.
 * Never edit or reorder a shipped migration.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 2,
    up: (db) => {
      // Phase 4a — editable sources + per-source auto-refresh.
      addColumn(db, "sources", "original_input TEXT");
      addColumn(db, "sources", "refresh_interval_hours INTEGER");
    },
  },
  {
    version: 3,
    up: (db) => {
      // Phase 4a.1 — `original_input` briefly stored the raw pasted URL for an Xtream source,
      // which is a get.php link carrying the plaintext username/password in its query string.
      // It was never read back (the edit form only ever gets a redacted display + editable
      // fields), so this is a straight leak with no offsetting benefit: drop it. SQLite has
      // supported DROP COLUMN since 3.35 (2021); better-sqlite3 ^12 bundles well past that.
      if (hasColumn(db, "sources", "original_input")) {
        db.exec(`ALTER TABLE sources DROP COLUMN original_input`);
      }
    },
  },
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
  {
    version: 6,
    up: (db) => {
      // Per-source content switches: which of live TV / movies / series a source loads.
      addColumn(db, "sources", "include_live INTEGER NOT NULL DEFAULT 1");
      addColumn(db, "sources", "include_movies INTEGER NOT NULL DEFAULT 1");
      addColumn(db, "sources", "include_series INTEGER NOT NULL DEFAULT 1");
    },
  },
  {
    version: 7,
    up: (db) => {
      // Advisory category classification (genre/language/service/tags). Columns only: the values are
      // filled by reclassifyCategories() on open, keyed by schema_meta.classifier_version.
      for (const table of ["categories", "movie_categories", "series_categories"]) {
        addColumn(db, table, "genre TEXT");
        addColumn(db, table, "language TEXT");
        addColumn(db, table, "service TEXT");
        addColumn(db, table, "tags TEXT NOT NULL DEFAULT ''");
      }
    },
  },
  {
    version: 8,
    up: (db) => {
      // Episode stills. Episode lists already fetched have none, so mark them stale: each series refetches on next open.
      addColumn(db, "episodes", "image_url TEXT");
      db.exec(`UPDATE series SET episodes_fetched_at = NULL`);
    },
  },
  {
    version: 9,
    up: (db) => {
      // Source order. Also a one-off clean-up: content switched off before switching it off removed anything left its rows behind.
      addColumn(db, "sources", "sort_order INTEGER");
      db.exec(`
        DELETE FROM channels WHERE source_id IN (SELECT id FROM sources WHERE include_live = 0);
        DELETE FROM categories WHERE source_id IN (SELECT id FROM sources WHERE include_live = 0);
        DELETE FROM movies WHERE source_id IN (SELECT id FROM sources WHERE include_movies = 0);
        DELETE FROM movie_categories WHERE source_id IN (SELECT id FROM sources WHERE include_movies = 0);
        DELETE FROM series WHERE source_id IN (SELECT id FROM sources WHERE include_series = 0);
        DELETE FROM series_categories WHERE source_id IN (SELECT id FROM sources WHERE include_series = 0);
      `);
    },
  },
  {
    version: 10,
    up: (db) => {
      // Categories pinned to the Home page.
      db.exec(`CREATE TABLE IF NOT EXISTS home_pins (
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('live', 'movies', 'series')),
  category_key  TEXT NOT NULL,   -- the category's provider_id: the same on every device, unlike the local category id
  label         TEXT NOT NULL,
  pinned_at     INTEGER NOT NULL,
  PRIMARY KEY (source_id, kind, category_key)
);
`);
    },
  },
  {
    version: 11,
    up: (db) => {
      // Skip intro: what the viewer last skipped in a series.
      db.exec(`CREATE TABLE IF NOT EXISTS series_skip (
  series_id   TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
  from_secs   INTEGER NOT NULL,   -- where the viewer started skipping the opening
  to_secs     INTEGER NOT NULL,   -- where they landed
  updated_at  INTEGER NOT NULL
);
`);
    },
  },
  {
    version: 12,
    up: (db) => {
      // channels/movies/series had an index on category_id but not source_id, so every "how much
      // does this source hold" count (the Sources screen, every sync/refresh completion) did a
      // full table scan — tens of thousands of rows, synchronously, on the JS thread.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_channels_source ON channels(source_id);
        CREATE INDEX IF NOT EXISTS idx_movies_source ON movies(source_id);
        CREATE INDEX IF NOT EXISTS idx_series_source ON series(source_id);
      `);
    },
  },
  {
    version: 13,
    up: (db) => {
      // Profiles, synced with the account (see docs/adr/0011-tv-profiles.md).
      db.exec(`CREATE TABLE IF NOT EXISTS profiles (
  id          TEXT PRIMARY KEY,   -- 'main' is the account's own; others are random
  name        TEXT NOT NULL,
  colour      INTEGER NOT NULL DEFAULT 0,
  avatar      TEXT,               -- one of the app's avatars, or NULL for the name's first letter
  pin         TEXT,               -- a hash of the PIN, or NULL
  position    INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,   -- sync clock (last write wins); 0 for Main until it is first changed
  deleted_at  INTEGER             -- sync tombstone
);
CREATE TABLE IF NOT EXISTS profile_stash (
  profile_id  TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  row         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_stash_profile ON profile_stash(profile_id);
`);
    },
  },
  {
    version: 14,
    up: (db) => {
      // Hiding categories and channels, and the viewer's own order for favourite channels.
      db.exec(`CREATE TABLE IF NOT EXISTS hidden_categories (
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('live', 'movies', 'series')),
  category_key  TEXT NOT NULL,
  label         TEXT NOT NULL,
  hidden_at     INTEGER NOT NULL,
  PRIMARY KEY (source_id, kind, category_key)
);
CREATE TABLE IF NOT EXISTS hidden_channels (
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  channel_key   TEXT NOT NULL,
  label         TEXT NOT NULL,
  hidden_at     INTEGER NOT NULL,
  PRIMARY KEY (source_id, channel_key)
);
`);
      // Channel favourites and recents sync from here on (sync/channelHistory.ts): the ones already here are sent once.
      db.exec(`CREATE TABLE IF NOT EXISTS pending_channel_sync (
  kind          TEXT NOT NULL CHECK (kind IN ('favourite', 'recent')),
  remote_key    TEXT NOT NULL,
  row           TEXT NOT NULL,
  received_at   INTEGER NOT NULL,
  PRIMARY KEY (kind, remote_key)
);`);
      // Only where the table is there without the column: a very old database gains the whole table later, from
      // SCHEMA_SQL's shape.
      const addColumn = (table: string, column: string) => {
        const columns = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[];
        if (columns.length > 0 && !columns.some((entry) => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER`);
      };
      addColumn("favourites", "position");
      addColumn("favourites", "updated_at");
      addColumn("recents", "updated_at");
      const now = Date.now();
      for (const table of ["favourites", "recents"]) {
        if ((db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).some((entry) => entry.name === "updated_at")) {
          db.prepare(`UPDATE ${table} SET updated_at = ? WHERE updated_at IS NULL`).run(now);
        }
      }
    },
  },
  {
    version: 15,
    up: (db) => {
      // Other server addresses a provider gives for the same account, tried when the main one is down.
      const columns = db.prepare(`SELECT name FROM pragma_table_info('sources')`).all() as { name: string }[];
      if (columns.length > 0 && !columns.some((entry) => entry.name === "backup_urls")) db.exec(`ALTER TABLE sources ADD COLUMN backup_urls TEXT`);
    },
  },
];

/** The migrations still needed to bring a database at `fromVersion` up to date. Pure. */
export function pendingMigrations(
  fromVersion: number,
  all: readonly Migration[] = MIGRATIONS,
): Migration[] {
  return all.filter((migration) => migration.version > fromVersion).sort((a, b) => a.version - b.version);
}
