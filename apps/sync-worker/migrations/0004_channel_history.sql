-- Favourite and recently watched live channels, synced like films' and series'. `remote_key` is a hash of the source's
-- key and the provider's channel key (the same on every device); a profile's own rows sit under its `p.<id>.` prefix.
CREATE TABLE IF NOT EXISTS channel_favourites (
  user_id     TEXT NOT NULL,
  remote_key  TEXT NOT NULL,
  added_at    INTEGER NOT NULL,
  position    INTEGER,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (user_id, remote_key)
);
CREATE INDEX IF NOT EXISTS idx_channel_favourites_user_updated ON channel_favourites(user_id, updated_at);

CREATE TABLE IF NOT EXISTS channel_recents (
  user_id     TEXT NOT NULL,
  remote_key  TEXT NOT NULL,
  played_at   INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (user_id, remote_key)
);
CREATE INDEX IF NOT EXISTS idx_channel_recents_user_updated ON channel_recents(user_id, updated_at);
