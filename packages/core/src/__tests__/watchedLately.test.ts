import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { listWatchedLately } from "../db/homeQueries.js";

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES ('s', 'xtream', 'S', 'http://x', 1)").run();
  db.prepare("INSERT INTO movie_categories (id, source_id, provider_id, raw_name) VALUES ('mc', 's', '1', 'M')").run();
  db.prepare("INSERT INTO series_categories (id, source_id, provider_id, raw_name) VALUES ('sc', 's', '1', 'S')").run();
  for (const id of ["m1", "m2"]) db.prepare("INSERT INTO movies (id, source_id, category_id, provider_stream_id, name, first_seen_at, last_seen_at) VALUES (?, 's', 'mc', ?, ?, 1, 1)").run(id, id, id);
  db.prepare("INSERT INTO series (id, source_id, category_id, provider_series_id, name, first_seen_at, last_seen_at) VALUES ('sr', 's', 'sc', '1', 'Show', 1, 1)").run();
  return db;
}

describe("watched lately", () => {
  it("puts films and shows in one list, the most recent first", () => {
    const db = seed();
    db.prepare("INSERT INTO movie_recents (movie_id, played_at) VALUES ('m1', 100), ('m2', 300)").run();
    db.prepare("INSERT INTO series_recents (series_id, played_at) VALUES ('sr', 200)").run();
    expect(listWatchedLately(db).map((entry) => `${entry.kind}:${entry.id}`)).toEqual(["movie:m2", "series:sr", "movie:m1"]);
  });

  it("leaves out titles that are no longer in the catalogue", () => {
    const db = seed();
    db.prepare("INSERT INTO movie_recents (movie_id, played_at) VALUES ('gone', 500)").run();
    expect(listWatchedLately(db)).toEqual([]);
  });
});
