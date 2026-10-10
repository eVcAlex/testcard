-- better-auth's own limiter (sign-in, sign-up, password change...), kept in D1 because a Worker isolate has no memory
-- worth trusting. Columns are the ones better-auth's `rateLimit` model expects; old rows are overwritten per key.
CREATE TABLE IF NOT EXISTS "rateLimit" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "key"         TEXT NOT NULL UNIQUE,
  "count"       INTEGER NOT NULL,
  "lastRequest" INTEGER NOT NULL
);
