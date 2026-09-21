import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { removeSourceRows } from "../sync/sourceRemoval.js";
import { applyRemoteChanges, collectLocalChanges } from "../sync/localChanges.js";
import type { SyncPullResponse } from "@testcard/sync-schema";

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  const now = Date.now();
  const source = db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at, remote_key, sync_updated_at) VALUES (?, 'xtream', ?, 'http://x', ?, ?, ?)");
  source.run("a", "A", now, "key-a", now - 1000);
  source.run("b", "B", now, "key-b", now - 1000);
  db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name, tags) VALUES ('a:1', 'a', '1', 'NEWS', '')").run();
  db.prepare("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, first_seen_at, last_seen_at) VALUES ('a:c1', 'a', 'a:1', 'One', 'One', ?, ?)").run(now, now);
  db.prepare("INSERT INTO favourites (channel_id, added_at) VALUES ('a:c1', ?)").run(now);
  return db;
}

const empty: Omit<SyncPullResponse, "sources"> = { movieFavourites: [], movieRecents: [], seriesFavourites: [], seriesRecents: [], progress: [], serverCursor: 0 };
const noCredentials = async () => ({ baseUrl: "http://x", username: "u", password: "p" });

describe("removeSourceRows", () => {
  it("removes the source and what hung off it, and leaves the other source alone", () => {
    const db = seed();
    removeSourceRows(db, "a", { recordTombstone: true });
    expect(db.prepare("SELECT id FROM sources").all()).toEqual([{ id: "b" }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM channels").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM favourites").get()).toEqual({ n: 0 });
  });

  it("records a tombstone the push then carries, without credentials", async () => {
    const db = seed();
    removeSourceRows(db, "a", { recordTombstone: true });
    const push = await collectLocalChanges(db, Date.now() + 1, "password", "salt", noCredentials);
    const removed = push.sources.filter((row) => row.deletedAt !== null);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ remoteKey: "key-a", label: null, credentialsBlob: null, credentialsIv: null });
  });

  it("records nothing when the removal came from another device", () => {
    const db = seed();
    removeSourceRows(db, "a", { recordTombstone: false });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sync_tombstones").get()).toEqual({ n: 0 });
  });

  it("does nothing for a source that is not there", () => {
    const db = seed();
    removeSourceRows(db, "missing", { recordTombstone: true });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sources").get()).toEqual({ n: 2 });
  });
});

describe("applyRemoteChanges with a removed source", () => {
  it("hands the removal to the caller instead of ignoring it", async () => {
    const db = seed();
    const removed: [string, number][] = [];
    const pull: SyncPullResponse = { ...empty, sources: [{ remoteKey: "key-a", label: null, credentialsBlob: null, credentialsIv: null, updatedAt: 5, deletedAt: 5 }] };
    await applyRemoteChanges(db, pull, "password", "salt", async () => undefined, async (key, at) => void removed.push([key, at]));
    expect(removed).toEqual([["key-a", 5]]);
  });
});
