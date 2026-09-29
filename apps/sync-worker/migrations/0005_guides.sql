-- Public TV guide addresses that devices have registered (see packages/sync-schema/src/guide.ts). A daily job reads
-- this list, builds a small file per address and puts it in the RELEASES bucket under `file`. Addresses only, no user.
CREATE TABLE IF NOT EXISTS guide_sources (
  file       TEXT PRIMARY KEY,
  url        TEXT NOT NULL UNIQUE,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
