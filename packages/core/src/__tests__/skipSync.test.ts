import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { getSkipWindow, saveSkipWindow } from "../db/seriesQueries.js";
import { applySourceSkips, skipsForSource } from "../sync/sourcePins.js";
import { collectLocalChanges } from "../sync/localChanges.js";
import { decryptCredentials } from "../sync/credentialCrypto.js";

function seed(seriesRemoteKey = "rk-show") {
  const db = migrateDatabase(new Database(":memory:"));
  db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at, remote_key, sync_updated_at) VALUES ('s', 'xtream', 'S', 'http://x', 1, 'key-s', 1)").run();
  db.prepare("INSERT INTO series_categories (id, source_id, provider_id, raw_name) VALUES ('sc', 's', '1', 'S')").run();
  db.prepare("INSERT INTO series (id, source_id, category_id, provider_series_id, name, first_seen_at, last_seen_at, remote_key) VALUES ('sr', 's', 'sc', '1', 'Show', 1, 1, ?)").run(seriesRemoteKey);
  return db;
}

describe("skip intro across devices", () => {
  it("marks the source as edited when a skip is saved", () => {
    const db = seed();
    saveSkipWindow(db, "sr", 20, 95);
    expect((db.prepare("SELECT sync_updated_at AS at FROM sources WHERE id = 's'").get() as { at: number }).at).toBeGreaterThan(1);
  });

  it("goes into the source's encrypted record by the series' remote key", async () => {
    const db = seed();
    saveSkipWindow(db, "sr", 20, 95);
    expect(skipsForSource(db, "s")).toEqual([{ key: "rk-show", from: 20, to: 95 }]);
    const push = await collectLocalChanges(db, 0, "password", "salt", async () => ({ baseUrl: "http://x", username: "u", password: "p" }));
    const row = push.sources[0]!;
    const payload = await decryptCredentials({ blob: row.credentialsBlob!, iv: row.credentialsIv! }, "password", "salt");
    expect(payload).toMatchObject({ skips: [{ key: "rk-show", from: 20, to: 95 }] });
  });

  it("is taken on by another device that has the same series under its own id", () => {
    const other = seed();
    // That device's own ids differ; only the remote key matches.
    other.prepare("UPDATE series SET id = 'other-id' WHERE id = 'sr'").run();
    applySourceSkips(other, "s", [{ key: "rk-show", from: 25, to: 100 }, { key: "rk-unknown", from: 1, to: 2 }]);
    expect(getSkipWindow(other, "other-id")).toEqual({ fromSecs: 25, toSecs: 100 });
  });

  it("is left out of the record when there are none", async () => {
    const db = seed();
    const push = await collectLocalChanges(db, 0, "password", "salt", async () => ({ baseUrl: "http://x", username: "u", password: "p" }));
    const row = push.sources[0]!;
    const payload = (await decryptCredentials({ blob: row.credentialsBlob!, iv: row.credentialsIv! }, "password", "salt")) as { skips?: unknown };
    expect(payload.skips).toBeUndefined();
  });
});
