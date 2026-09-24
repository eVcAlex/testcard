import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { forgetProfile, swapProfile } from "../db/profileSwap.js";

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES ('s1', 'xtream', 'One', 'http://x', 1)").run();
  db.prepare("INSERT INTO movie_favourites (movie_id, added_at, remote_key, updated_at) VALUES ('m1', 10, 'k1', 10)").run();
  db.prepare("INSERT INTO playback_progress (item_type, item_id, position_secs, duration_secs, updated_at) VALUES ('movie', 'm1', 300, 6000, 10)").run();
  db.prepare("INSERT INTO home_pins (source_id, kind, category_key, label, pinned_at) VALUES ('s1', 'live', '9', 'Sky Sports', 10)").run();
  db.prepare("INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) VALUES ('movie_favourites', 'k0', 5)").run();
  db.prepare("INSERT INTO schema_meta (key, value) VALUES ('ui:captions', 'main-captions'), ('ui:source', 'shared')").run();
  return db;
}

const count = (db: Database.Database, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const meta = (db: Database.Database, key: string) => (db.prepare("SELECT value FROM schema_meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;

describe("profile swap", () => {
  it("empties the personal tables for a new profile and keeps the shared ones", () => {
    const db = seed();
    swapProfile(db, "main", "kid", ["ui:captions"]);
    for (const table of ["movie_favourites", "playback_progress", "home_pins", "sync_tombstones"]) expect(count(db, table)).toBe(0);
    expect(count(db, "sources")).toBe(1);
    expect(meta(db, "ui:captions")).toBeUndefined();
    expect(meta(db, "ui:source")).toBe("shared");
  });

  it("brings each profile's own rows back when it is picked again", () => {
    const db = seed();
    swapProfile(db, "main", "kid", ["ui:captions"]);
    db.prepare("INSERT INTO movie_favourites (movie_id, added_at, remote_key, updated_at) VALUES ('m2', 20, 'k2', 20)").run();
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('ui:captions', 'kid-captions')").run();

    swapProfile(db, "kid", "main", ["ui:captions"]);
    expect(db.prepare("SELECT movie_id AS id, updated_at AS at FROM movie_favourites").all()).toEqual([{ id: "m1", at: 10 }]);
    expect(db.prepare("SELECT position_secs AS at FROM playback_progress").get()).toEqual({ at: 300 });
    expect(count(db, "home_pins")).toBe(1);
    expect(count(db, "sync_tombstones")).toBe(1);
    expect(meta(db, "ui:captions")).toBe("main-captions");

    swapProfile(db, "main", "kid", ["ui:captions"]);
    expect(db.prepare("SELECT movie_id AS id FROM movie_favourites").all()).toEqual([{ id: "m2" }]);
    expect(meta(db, "ui:captions")).toBe("kid-captions");
  });

  it("drops a stashed pin whose source has gone since", () => {
    const db = seed();
    swapProfile(db, "main", "kid");
    db.prepare("DELETE FROM sources WHERE id = 's1'").run();
    swapProfile(db, "kid", "main");
    expect(count(db, "home_pins")).toBe(0);
    expect(count(db, "movie_favourites")).toBe(1);
  });

  it("forgets a deleted profile's rows", () => {
    const db = seed();
    swapProfile(db, "main", "kid");
    swapProfile(db, "kid", "main");
    forgetProfile(db, "kid");
    swapProfile(db, "main", "kid");
    expect(count(db, "movie_favourites")).toBe(0);
  });
});
