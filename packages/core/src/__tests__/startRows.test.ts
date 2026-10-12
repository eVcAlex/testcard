import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { pinCategory } from "../sync/sourcePins.js";
import { buildStartRows } from "../db/startRows.js";

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at, remote_key) VALUES ('s1', 'xtream', 'One', 'http://x', 1, 'key-s1')").run();
  db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name) VALUES ('s1:c9', 's1', '9', 'UK | Sky Sports')").run();
  db.prepare("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, first_seen_at, last_seen_at) VALUES ('ch1', 's1', 's1:c9', 'Sky Sports 1', 'UK | Sky Sports 1', 1, 1)").run();
  return db;
}

describe("Home rows", () => {
  it("is empty with nothing watched or pinned", () => {
    expect(buildStartRows(seed(), null)).toEqual([]);
  });

  it("shows a pinned category as a pinned row of its channels, and nothing for another source", () => {
    const db = seed();
    pinCategory(db, "live", "s1:c9", "Sky Sports");
    const rows = buildStartRows(db, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pinned: true, items: [{ kind: "channel", id: "ch1" }] });
    expect(buildStartRows(db, "other")).toEqual([]);
  });
});
