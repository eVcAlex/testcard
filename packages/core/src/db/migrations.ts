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
];

/** The migrations still needed to bring a database at `fromVersion` up to date. Pure. */
export function pendingMigrations(
  fromVersion: number,
  all: readonly Migration[] = MIGRATIONS,
): Migration[] {
  return all.filter((migration) => migration.version > fromVersion).sort((a, b) => a.version - b.version);
}
