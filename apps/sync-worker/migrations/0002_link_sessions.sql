-- Signing a TV in with a code (see docs/superpowers/specs/2026-09-21-tv-code-sign-in-design.md).
-- `lookup` is a slow hash of the code, never the code. `blob`/`iv` are the account's email and password sealed under a key
-- made from the code, so the server cannot read them. Rows live 10 minutes and are deleted the moment the TV collects them.
CREATE TABLE IF NOT EXISTS link_sessions (
  lookup      TEXT PRIMARY KEY,
  salt        TEXT NOT NULL,
  blob        TEXT,
  iv          TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_link_sessions_expires ON link_sessions(expires_at);
