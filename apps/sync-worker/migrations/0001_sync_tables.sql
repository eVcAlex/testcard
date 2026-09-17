CREATE TABLE IF NOT EXISTS sources (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  remote_key        TEXT NOT NULL,
  -- Nullable on purpose: a tombstone (deleted_at set) carries no credentials, so deleting a source
  -- lets a device forget them instead of re-uploading the ciphertext forever. See
  -- packages/sync-schema's SyncSourceSchema, which enforces the all-or-nothing pairing.
  label             TEXT,
  credentials_blob  TEXT,
  credentials_iv    TEXT,
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
