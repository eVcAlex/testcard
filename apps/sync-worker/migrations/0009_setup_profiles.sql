-- Sources shared by link (see packages/sync-schema/src/setup.ts). `blob`/`iv` are the source sealed under a secret that
-- only the link carries, so the server cannot read it; `claim_hash` is the hash of a proof derived from the same secret,
-- which a device must show to be handed the blob. Revoking empties the blob at once. `label` is the sender's own note.
CREATE TABLE IF NOT EXISTS setup_profiles (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  label       TEXT NOT NULL,
  claim_hash  TEXT NOT NULL,
  blob        TEXT NOT NULL,
  iv          TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  max_claims  INTEGER NOT NULL DEFAULT 1,
  claims      INTEGER NOT NULL DEFAULT 0,
  revoked_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_setup_profiles_user ON setup_profiles(user_id, created_at);
