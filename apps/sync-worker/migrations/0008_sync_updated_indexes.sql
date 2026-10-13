-- Every pull filters each table on `user_id = ? AND updated_at > ?` (src/routes/pull.ts). The tables made in 0001 only had
-- their (user_id, remote_key) primary key, so a pull read every row the account had ever synced to find the few changed
-- since its cursor. Later tables (0003, 0004) were made with this index from the start.
CREATE INDEX IF NOT EXISTS idx_sources_user_updated ON sources(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_movie_favourites_user_updated ON movie_favourites(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_movie_recents_user_updated ON movie_recents(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_series_favourites_user_updated ON series_favourites(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_series_recents_user_updated ON series_recents(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_playback_progress_user_updated ON playback_progress(user_id, updated_at);
