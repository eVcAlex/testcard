import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { applySourceContent } from "../sync/sourceContent.js";
import { collectLocalChanges } from "../sync/localChanges.js";
import { decryptCredentials } from "../sync/credentialCrypto.js";

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  const now = Date.now();
  db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at, remote_key, sync_updated_at) VALUES ('a', 'xtream', 'A', 'http://x', ?, 'key-a', ?)").run(now, now);
  db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name, tags) VALUES ('a:1', 'a', '1', 'NEWS', '')").run();
  db.prepare("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, first_seen_at, last_seen_at) VALUES ('a:c1', 'a', 'a:1', 'One', 'One', ?, ?)").run(now, now);
  return db;
}

describe("applySourceContent", () => {
  it("turning live off removes the source's channels and categories", () => {
    const db = seed();
    const turnedOn = applySourceContent(db, "a", { live: false, movies: true, series: true });
    expect(turnedOn).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM channels").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM categories").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT include_live AS live FROM sources WHERE id = 'a'").get()).toEqual({ live: 0 });
  });

  it("turning something on says the source needs importing", () => {
    const db = seed();
    applySourceContent(db, "a", { live: true, movies: false, series: true });
    expect(applySourceContent(db, "a", { live: true, movies: true, series: true })).toBe(true);
  });

  it("leaves things alone when nothing changes, and for an unknown source", () => {
    const db = seed();
    expect(applySourceContent(db, "a", { live: true, movies: true, series: true })).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM channels").get()).toEqual({ n: 1 });
    expect(applySourceContent(db, "missing", { live: false, movies: false, series: false })).toBe(false);
  });
});

describe("the push carries the content switches", () => {
  it("puts them in the encrypted payload", async () => {
    const db = seed();
    db.prepare("UPDATE sources SET include_live = 0, sync_updated_at = ? WHERE id = 'a'").run(Date.now() + 10);
    const push = await collectLocalChanges(db, 0, "password", "salt", async () => ({ baseUrl: "http://x", username: "u", password: "p" }));
    const row = push.sources.find((source) => source.remoteKey === "key-a");
    expect(row).toBeDefined();
    const payload = await decryptCredentials({ blob: row!.credentialsBlob!, iv: row!.credentialsIv! }, "password", "salt");
    expect(payload).toMatchObject({ content: { live: false, movies: true, series: true } });
  });
});
