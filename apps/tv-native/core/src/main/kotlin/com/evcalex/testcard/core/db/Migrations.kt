package com.evcalex.testcard.core.db

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.execSQL

/**
 * Forward-only schema migrations (`migrations.ts`, verbatim): they bring a database an older release left behind up to
 * [SCHEMA_VERSION]. A fresh database is built from `schema.sql` and skips every one. Never edit or reorder a shipped migration.
 */
internal class Migration(val version: Int, val up: (SQLiteConnection) -> Unit)

private fun SQLiteConnection.columnsOf(table: String): List<String> = query("SELECT name FROM pragma_table_info('$table')") { it.getText(0) }

/** `ALTER TABLE ADD COLUMN`, skipped if the column is somehow already present. */
private fun SQLiteConnection.addColumn(table: String, columnDef: String) {
    val column = columnDef.split(Regex("\\s+"))[0]
    if (column !in columnsOf(table)) execSQL("ALTER TABLE $table ADD COLUMN $columnDef")
}

private fun SQLiteConnection.script(sql: String) { for (statement in splitStatements(sql)) execSQL(statement) }

internal val MIGRATIONS: List<Migration> = listOf(
    Migration(2) { db ->
        // Editable sources + per-source auto-refresh.
        db.addColumn("sources", "original_input TEXT")
        db.addColumn("sources", "refresh_interval_hours INTEGER")
    },
    Migration(3) { db ->
        // `original_input` briefly stored the raw pasted URL (with the plaintext login in it): dropped.
        if ("original_input" in db.columnsOf("sources")) db.execSQL("ALTER TABLE sources DROP COLUMN original_input")
    },
    Migration(4) { db ->
        // VOD & series catalogue, lazy per-item detail fetch, playback progress.
        db.script(
            """
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
            """,
        )
    },
    Migration(5) { db ->
        // Device sync: remote_key / sync-clock columns on every syncable table.
        db.addColumn("sources", "remote_key TEXT")
        db.addColumn("sources", "sync_updated_at INTEGER")
        db.addColumn("sources", "sync_deleted_at INTEGER")
        db.addColumn("movies", "remote_key TEXT")
        db.addColumn("series", "remote_key TEXT")
        db.addColumn("episodes", "remote_key TEXT")
        for (table in listOf("movie_favourites", "movie_recents", "series_favourites", "series_recents")) {
            db.addColumn(table, "remote_key TEXT")
            db.addColumn(table, "updated_at INTEGER")
        }
        db.addColumn("playback_progress", "remote_key TEXT")
        db.addColumn("playback_progress", "deleted_at INTEGER")
        db.script(
            """
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
            """,
        )
    },
    Migration(6) { db ->
        // Per-source content switches: which of live TV / movies / series a source loads.
        db.addColumn("sources", "include_live INTEGER NOT NULL DEFAULT 1")
        db.addColumn("sources", "include_movies INTEGER NOT NULL DEFAULT 1")
        db.addColumn("sources", "include_series INTEGER NOT NULL DEFAULT 1")
    },
    Migration(7) { db ->
        // Advisory category classification columns; the values are filled by reclassifyCategories() on open.
        for (table in listOf("categories", "movie_categories", "series_categories")) {
            db.addColumn(table, "genre TEXT")
            db.addColumn(table, "language TEXT")
            db.addColumn(table, "service TEXT")
            db.addColumn(table, "tags TEXT NOT NULL DEFAULT ''")
        }
    },
    Migration(8) { db ->
        // Episode stills. Episode lists already fetched have none, so mark them stale: each series refetches on next open.
        db.addColumn("episodes", "image_url TEXT")
        db.execSQL("UPDATE series SET episodes_fetched_at = NULL")
    },
    Migration(9) { db ->
        // Source order. Also a one-off clean-up: content switched off before switching it off removed anything left its rows behind.
        db.addColumn("sources", "sort_order INTEGER")
        db.script(
            """
        DELETE FROM channels WHERE source_id IN (SELECT id FROM sources WHERE include_live = 0);
        DELETE FROM categories WHERE source_id IN (SELECT id FROM sources WHERE include_live = 0);
        DELETE FROM movies WHERE source_id IN (SELECT id FROM sources WHERE include_movies = 0);
        DELETE FROM movie_categories WHERE source_id IN (SELECT id FROM sources WHERE include_movies = 0);
        DELETE FROM series WHERE source_id IN (SELECT id FROM sources WHERE include_series = 0);
        DELETE FROM series_categories WHERE source_id IN (SELECT id FROM sources WHERE include_series = 0);
            """,
        )
    },
    Migration(10) { db ->
        // Categories pinned to the Home page.
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS home_pins (
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('live', 'movies', 'series')),
  category_key  TEXT NOT NULL,
  label         TEXT NOT NULL,
  pinned_at     INTEGER NOT NULL,
  PRIMARY KEY (source_id, kind, category_key)
)""",
        )
    },
    Migration(11) { db ->
        // Skip intro: what the viewer last skipped in a series.
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS series_skip (
  series_id   TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
  from_secs   INTEGER NOT NULL,
  to_secs     INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
)""",
        )
    },
    Migration(12) { db ->
        db.script(
            """
        CREATE INDEX IF NOT EXISTS idx_channels_source ON channels(source_id);
        CREATE INDEX IF NOT EXISTS idx_movies_source ON movies(source_id);
        CREATE INDEX IF NOT EXISTS idx_series_source ON series(source_id);
            """,
        )
    },
    Migration(13) { db ->
        // Profiles, synced with the account (docs/adr/0011-tv-profiles.md).
        db.script(
            """CREATE TABLE IF NOT EXISTS profiles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  colour      INTEGER NOT NULL DEFAULT 0,
  avatar      TEXT,
  pin         TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE TABLE IF NOT EXISTS profile_stash (
  profile_id  TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  row         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_stash_profile ON profile_stash(profile_id);
""",
        )
    },
    Migration(14) { db ->
        // Hiding categories and channels, and the viewer's own order for favourite channels.
        db.script(
            """CREATE TABLE IF NOT EXISTS hidden_categories (
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
""",
        )
        // Channel favourites and recents sync from here on: the ones already here are sent once.
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS pending_channel_sync (
  kind          TEXT NOT NULL CHECK (kind IN ('favourite', 'recent')),
  remote_key    TEXT NOT NULL,
  row           TEXT NOT NULL,
  received_at   INTEGER NOT NULL,
  PRIMARY KEY (kind, remote_key)
)""",
        )
        // Only where the table is there without the column: a very old database gains the whole table later.
        fun addIntColumn(table: String, column: String) {
            val columns = db.columnsOf(table)
            if (columns.isNotEmpty() && column !in columns) db.execSQL("ALTER TABLE $table ADD COLUMN $column INTEGER")
        }
        addIntColumn("favourites", "position")
        addIntColumn("favourites", "updated_at")
        addIntColumn("recents", "updated_at")
        val now = com.evcalex.testcard.core.nowMs()
        for (table in listOf("favourites", "recents")) {
            if ("updated_at" in db.columnsOf(table)) db.run("UPDATE $table SET updated_at = ? WHERE updated_at IS NULL", now)
        }
    },
    Migration(15) { db ->
        // Other server addresses a provider gives for the same account, tried when the main one is down.
        val columns = db.columnsOf("sources")
        if (columns.isNotEmpty() && "backup_urls" !in columns) db.execSQL("ALTER TABLE sources ADD COLUMN backup_urls TEXT")
    },
)

/** The migrations still needed to bring a database at [from] up to date. */
internal fun pendingMigrations(from: Int): List<Migration> = MIGRATIONS.filter { it.version > from }.sortedBy { it.version }
