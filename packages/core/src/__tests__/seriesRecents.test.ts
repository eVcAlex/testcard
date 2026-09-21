import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { listRecentSeries, recordSeriesRecent, removeSeriesFromRecents } from "../db/seriesQueries.js";

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  const now = Date.now();
  db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES ('a', 'xtream', 'a', 'http://x', ?)").run(now);
  db.prepare("INSERT INTO series_categories (id, source_id, provider_id, raw_name, tags) VALUES ('a:s1', 'a', '1', 'DRAMA', '')").run();
  const series = db.prepare("INSERT INTO series (id, source_id, category_id, provider_series_id, name, remote_key, first_seen_at, last_seen_at) VALUES (?, 'a', 'a:s1', ?, ?, ?, ?, ?)");
  series.run("a:1", "1", "One", "key-1", now, now);
  series.run("a:2", "2", "Two", null, now, now);
  return db;
}

describe("removeSeriesFromRecents", () => {
  it("takes the series out of the list and leaves the others", () => {
    const db = seed();
    recordSeriesRecent(db, "a:1");
    recordSeriesRecent(db, "a:2");
    removeSeriesFromRecents(db, "a:1");
    expect(listRecentSeries(db).map((row) => row.id)).toEqual(["a:2"]);
  });

  it("leaves a tombstone so the removal syncs, only for a series that has a remote key", () => {
    const db = seed();
    recordSeriesRecent(db, "a:1");
    recordSeriesRecent(db, "a:2");
    removeSeriesFromRecents(db, "a:1");
    removeSeriesFromRecents(db, "a:2");
    const tombstones = db.prepare("SELECT table_name, remote_key FROM sync_tombstones").all();
    expect(tombstones).toEqual([{ table_name: "series_recents", remote_key: "key-1" }]);
  });

  it("does nothing for a series that is not in the list", () => {
    const db = seed();
    removeSeriesFromRecents(db, "a:1");
    expect(db.prepare("SELECT COUNT(*) AS n FROM sync_tombstones").get()).toEqual({ n: 0 });
  });
});
