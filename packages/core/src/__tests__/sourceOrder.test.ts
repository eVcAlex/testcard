import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { moveSource, orderedSourceIds, stampSourceOrder } from "../sync/sourceOrder.js";
import { collectLocalChanges } from "../sync/localChanges.js";
import { decryptCredentials } from "../sync/credentialCrypto.js";

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  const add = (id: string, createdAt: number) =>
    db
      .prepare("INSERT INTO sources (id, kind, name, base_url, created_at, remote_key, sync_updated_at) VALUES (?, 'xtream', ?, 'http://x', ?, ?, ?)")
      .run(id, id, createdAt, `key-${id}`, 1);
  add("a", 100);
  add("b", 200);
  add("c", 300);
  return db;
}

describe("source order", () => {
  it("falls back to the oldest first when nothing has been placed", () => {
    expect(orderedSourceIds(seed())).toEqual(["a", "b", "c"]);
  });

  it("moves a source up or down and refuses to go past either end", () => {
    const db = seed();
    expect(moveSource(db, "c", -1)).toBe(true);
    expect(orderedSourceIds(db)).toEqual(["a", "c", "b"]);
    expect(moveSource(db, "a", -1)).toBe(false);
    expect(moveSource(db, "b", 1)).toBe(false);
    expect(moveSource(db, "missing", 1)).toBe(false);
    expect(orderedSourceIds(db)).toEqual(["a", "c", "b"]);
  });

  it("stamps the moved sources as edited so the new order is pushed", () => {
    const db = seed();
    moveSource(db, "b", -1);
    const stamped = db.prepare("SELECT id FROM sources WHERE sync_updated_at > 1").all();
    expect(stamped.length).toBe(3);
  });

  it("places sources that arrive without a position after the placed ones", () => {
    const db = seed();
    stampSourceOrder(db);
    db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES ('d', 'xtream', 'd', 'http://x', 1)").run();
    expect(orderedSourceIds(db)).toEqual(["a", "b", "c", "d"]);
  });

  it("puts the position in the pushed payload", async () => {
    const db = seed();
    moveSource(db, "c", -1);
    const push = await collectLocalChanges(db, 0, "password", "salt", async () => ({ baseUrl: "http://x", username: "u", password: "p" }));
    const row = push.sources.find((source) => source.remoteKey === "key-c");
    const payload = await decryptCredentials({ blob: row!.credentialsBlob!, iv: row!.credentialsIv! }, "password", "salt");
    expect(payload).toMatchObject({ position: 1 });
  });
});

describe("the upgrade clean-up", () => {
  it("leaves nothing behind for content that was switched off", () => {
    const db = seed();
    db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name, tags) VALUES ('a:1', 'a', '1', 'N', '')").run();
    db.prepare("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, first_seen_at, last_seen_at) VALUES ('a:c1', 'a', 'a:1', 'One', 'One', 1, 1)").run();
    db.prepare("UPDATE sources SET include_live = 0 WHERE id = 'a'").run();
    // A database opened by an older build is at version 8; opening it now runs the clean-up.
    db.prepare("UPDATE schema_meta SET value = '8' WHERE key = 'version'").run();
    migrateDatabase(db);
    expect(db.prepare("SELECT COUNT(*) AS n FROM channels").get()).toEqual({ n: 0 });
  });
});
