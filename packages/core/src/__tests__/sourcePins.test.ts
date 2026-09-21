import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { applySourcePins, listHomePins, pinCategory, pinnedCategoryIds, pinsForSource, unpinCategory } from "../sync/sourcePins.js";
import { collectLocalChanges } from "../sync/localChanges.js";
import { decryptCredentials } from "../sync/credentialCrypto.js";

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at, remote_key, sync_updated_at) VALUES ('s1', 'xtream', 'One', 'http://x', 1, 'key-s1', 1)").run();
  db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name) VALUES ('s1:c9', 's1', '9', 'UK | Sky Sports')").run();
  db.prepare("INSERT INTO movie_categories (id, source_id, provider_id, raw_name) VALUES ('s1:m3', 's1', '3', 'Documentary')").run();
  return db;
}

describe("home pins", () => {
  it("pins and unpins a category, and lists it with this device's id for it", () => {
    const db = seed();
    expect(pinCategory(db, "live", "s1:c9", "Sky Sports")).toBe(true);
    expect(pinCategory(db, "movies", "s1:m3", "Documentary")).toBe(true);
    expect(listHomePins(db).map((pin) => [pin.kind, pin.label, pin.categoryId])).toEqual([
      ["live", "Sky Sports", "s1:c9"],
      ["movies", "Documentary", "s1:m3"],
    ]);
    expect([...pinnedCategoryIds(db, "live")]).toEqual(["s1:c9"]);
    unpinCategory(db, "live", "s1:c9");
    expect(listHomePins(db).map((pin) => pin.label)).toEqual(["Documentary"]);
  });

  it("refuses a category this device does not have", () => {
    expect(pinCategory(seed(), "live", "nope", "x")).toBe(false);
  });

  it("stamps the source as edited so the change is pushed", () => {
    const db = seed();
    pinCategory(db, "live", "s1:c9", "Sky Sports");
    expect((db.prepare("SELECT sync_updated_at AS at FROM sources WHERE id = 's1'").get() as { at: number }).at).toBeGreaterThan(1);
  });

  it("travels inside the source's encrypted record and comes out the other side", async () => {
    const db = seed();
    pinCategory(db, "live", "s1:c9", "Sky Sports");
    const push = await collectLocalChanges(db, 0, "password", "salt", async () => ({ baseUrl: "http://x", username: "u", password: "p" }));
    const source = push.sources[0]!;
    const payload = await decryptCredentials({ blob: source.credentialsBlob!, iv: source.credentialsIv! }, "password", "salt");
    expect(payload).toMatchObject({ pins: [{ kind: "live", key: "9", label: "Sky Sports" }] });
  });

  it("takes on pins from another device, replacing its own set, without touching the sync clock", () => {
    const db = seed();
    pinCategory(db, "movies", "s1:m3", "Documentary");
    const before = (db.prepare("SELECT sync_updated_at AS at FROM sources WHERE id = 's1'").get() as { at: number }).at;
    applySourcePins(db, "s1", [{ kind: "live", key: "9", label: "Sky Sports" }]);
    expect(pinsForSource(db, "s1")).toEqual([{ kind: "live", key: "9", label: "Sky Sports" }]);
    expect((db.prepare("SELECT sync_updated_at AS at FROM sources WHERE id = 's1'").get() as { at: number }).at).toBe(before);
  });

  it("keeps a pin whose category is not imported here yet, without an id", () => {
    const db = seed();
    applySourcePins(db, "s1", [{ kind: "series", key: "77", label: "Later" }]);
    expect(listHomePins(db)[0]).toMatchObject({ label: "Later", categoryId: null });
  });

  it("goes when its source is removed", () => {
    const db = seed();
    pinCategory(db, "live", "s1:c9", "Sky Sports");
    db.pragma("foreign_keys = ON");
    db.prepare("DELETE FROM sources WHERE id = 's1'").run();
    expect(listHomePins(db)).toEqual([]);
  });
});
