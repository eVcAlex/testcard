import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { renameChannels } from "../db/channelNames.js";

describe("renameChannels", () => {
  it("tidies stored names from the raw name on open, keeping ids, once", () => {
    const db = migrateDatabase(new Database(":memory:"));
    db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES ('s', 'xtream', 'S', 'http://x', 1)").run();
    db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name, tags) VALUES ('s:c', 's', '1', 'UK', '')").run();
    const add = db.prepare("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, first_seen_at, last_seen_at) VALUES (?, 's', 's:c', ?, ?, 1, 1)");
    add.run("one", "[UK] BBC ONE", "[UK] BBC ONE HD (1080p50)");
    add.run("two", "Sky News", "Sky News");

    db.prepare("DELETE FROM schema_meta WHERE key = 'display_name_version'").run();
    renameChannels(db);
    const names = db.prepare("SELECT id, normalised_name AS name FROM channels ORDER BY id").all();
    expect(names).toEqual([
      { id: "one", name: "BBC One HD" },
      { id: "two", name: "Sky News" },
    ]);
    // Search follows the new name.
    expect(db.prepare("SELECT COUNT(*) AS n FROM channels_fts WHERE channels_fts MATCH 'one'").get()).toEqual({ n: 1 });

    db.prepare("UPDATE channels SET normalised_name = 'left alone' WHERE id = 'two'").run();
    renameChannels(db);
    expect(db.prepare("SELECT normalised_name AS name FROM channels WHERE id = 'two'").get()).toEqual({ name: "left alone" });
  });
});
