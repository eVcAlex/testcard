-- Bytes the web player's stream proxy has carried for each account, per UTC day, so one account cannot run up the bill.
CREATE TABLE IF NOT EXISTS watch_usage (
  user_id TEXT NOT NULL,
  day     TEXT NOT NULL,
  bytes   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
