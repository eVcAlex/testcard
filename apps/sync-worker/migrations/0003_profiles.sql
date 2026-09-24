-- The people who watch on an account's TVs (see docs/adr/0011-tv-profiles.md). Encrypted on the device like a
-- source's login, so the server holds no names. `remote_key` is the profile's random id; blob/iv are null only on a
-- tombstone. A profile's own favourites, recents and progress live in the existing tables under `p.<id>.` keys.
CREATE TABLE IF NOT EXISTS profiles (
  user_id     TEXT NOT NULL,
  remote_key  TEXT NOT NULL,
  blob        TEXT,
  iv          TEXT,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (user_id, remote_key)
);
CREATE INDEX IF NOT EXISTS idx_profiles_user_updated ON profiles(user_id, updated_at);
