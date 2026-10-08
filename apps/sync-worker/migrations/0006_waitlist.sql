-- Waitlist for the website. Email is the only personal data kept; duplicates are ignored by the route.
CREATE TABLE IF NOT EXISTS waitlist (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  windows    INTEGER NOT NULL DEFAULT 0,
  firetv     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Per-IP daily signup counter. ip_hash is SHA-256(ip + a salt derived from the date and the auth secret):
-- raw IPs are never stored, and the same address hashes differently each day. Old days are pruned by the route.
CREATE TABLE IF NOT EXISTS waitlist_rate (
  ip_hash TEXT NOT NULL,
  day     TEXT NOT NULL,
  count   INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, day)
);
