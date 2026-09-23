import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { getPlaybackProgress, setPlaybackProgress, setWatched, shouldPromptResume } from "../db/progressQueries.js";
import { collectLocalChanges } from "../sync/localChanges.js";

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES ('s', 'xtream', 'S', 'http://x', 1)").run();
  db.prepare("INSERT INTO movie_categories (id, source_id, provider_id, raw_name) VALUES ('mc', 's', '1', 'M')").run();
  db.prepare("INSERT INTO movies (id, source_id, category_id, provider_stream_id, name, duration_secs, first_seen_at, last_seen_at, remote_key) VALUES ('m1', 's', 'mc', '1', 'Film', 6000, 1, 1, 'rk-m1')").run();
  db.prepare("INSERT INTO movies (id, source_id, category_id, provider_stream_id, name, first_seen_at, last_seen_at) VALUES ('m2', 's', 'mc', '2', 'No length', 1, 1)").run();
  return db;
}

describe("setWatched", () => {
  it("marks a title watched at its end, so nothing offers to resume it", () => {
    const db = seed();
    setPlaybackProgress(db, "movie", "m1", 1200, 6000);
    setWatched(db, "movie", ["m1"], true);
    const row = getPlaybackProgress(db, "movie", "m1");
    expect(row?.watched).toBe(1);
    expect(shouldPromptResume(row?.position_secs ?? 0, row?.duration_secs)).toBe(false);
  });

  it("marks a title unwatched back at the start", () => {
    const db = seed();
    setWatched(db, "movie", ["m1"], true);
    setWatched(db, "movie", ["m1"], false);
    const row = getPlaybackProgress(db, "movie", "m1");
    expect(row?.watched).toBe(0);
    expect(row?.position_secs).toBe(0);
  });

  it("works for a title whose length is not known yet", () => {
    const db = seed();
    setWatched(db, "movie", ["m2"], true);
    expect(getPlaybackProgress(db, "movie", "m2")?.watched).toBe(1);
  });

  it("is picked up by the next sync push", async () => {
    const db = seed();
    setWatched(db, "movie", ["m1"], true);
    const changes = await collectLocalChanges(db, 0, "password", "c2FsdHNhbHRzYWx0c2FsdA==", async () => ({ baseUrl: "http://x", username: "u", password: "p" }));
    expect(changes.progress).toEqual([expect.objectContaining({ remoteKey: "rk-m1", watched: true, deletedAt: null })]);
  });

  it("ignores ids that are not in the catalogue", () => {
    const db = seed();
    setWatched(db, "movie", ["gone"], true);
    expect(getPlaybackProgress(db, "movie", "gone")).toBeUndefined();
  });
});
