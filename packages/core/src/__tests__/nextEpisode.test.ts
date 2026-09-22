import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { findNextEpisode, getUpNextEpisode } from "../db/seriesQueries.js";
import { setPlaybackProgress } from "../db/progressQueries.js";

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES ('s', 'xtream', 'S', 'http://x', 1)").run();
  db.prepare("INSERT INTO series_categories (id, source_id, provider_id, raw_name) VALUES ('c', 's', '1', 'C')").run();
  db.prepare("INSERT INTO series (id, source_id, category_id, provider_series_id, name, first_seen_at, last_seen_at) VALUES ('sr', 's', 'c', '1', 'Show', 1, 1)").run();
  for (const season of [1, 2]) db.prepare("INSERT INTO seasons (id, series_id, season_number) VALUES (?, 'sr', ?)").run(`sr:${season}`, season);
  // Inserted out of order on purpose: the query must go by season and episode number, not row order.
  const add = (season: number, ep: number) => db.prepare("INSERT INTO episodes (id, season_id, series_id, provider_episode_id, episode_number, name) VALUES (?, ?, 'sr', ?, ?, ?)").run(`e${season}${ep}`, `sr:${season}`, `${season}${ep}`, ep, `S${season}E${ep}`);
  add(2, 1);
  add(1, 2);
  add(1, 1);
  add(2, 2);
  return db;
}

describe("the next episode", () => {
  it("is the next in the same season", () => {
    expect(findNextEpisode(seed(), "e11")).toMatchObject({ id: "e12", seasonNumber: 1, episodeNumber: 2 });
  });
  it("rolls over to the first episode of the next season", () => {
    expect(findNextEpisode(seed(), "e12")).toMatchObject({ id: "e21", seasonNumber: 2, episodeNumber: 1 });
  });
  it("is nothing after the last episode, or for an unknown one", () => {
    expect(findNextEpisode(seed(), "e22")).toBeUndefined();
    expect(findNextEpisode(seed(), "nope")).toBeUndefined();
  });
});

describe("the up-next episode (Home's Continue watching, and the series page's big button)", () => {
  it("is the first episode when nothing has been watched", () => {
    expect(getUpNextEpisode(seed(), "sr")).toMatchObject({ episode: { id: "e11" }, resume: false });
  });
  it("resumes the episode left partway through", () => {
    const db = seed();
    setPlaybackProgress(db, "episode", "e12", 200, 1200); // well under the watched threshold
    expect(getUpNextEpisode(db, "sr")).toMatchObject({ episode: { id: "e12" }, resume: true });
  });
  it("moves on to the next unwatched episode once one is finished", () => {
    const db = seed();
    setPlaybackProgress(db, "episode", "e11", 1150, 1200); // crosses the watched threshold
    expect(getUpNextEpisode(db, "sr")).toMatchObject({ episode: { id: "e12" }, resume: false });
  });
  it("is nothing for a series with no episodes yet", () => {
    expect(getUpNextEpisode(seed(), "unknown")).toBeUndefined();
  });
});

import { clearSkipWindow, getSkipWindow, saveSkipWindow } from "../db/seriesQueries.js";

describe("skip intro memory", () => {
  it("remembers the last skip per series, and forgets on request", () => {
    const db = seed();
    expect(getSkipWindow(db, "sr")).toBeUndefined();
    saveSkipWindow(db, "sr", 22.4, 96.7);
    expect(getSkipWindow(db, "sr")).toEqual({ fromSecs: 22, toSecs: 97 });
    saveSkipWindow(db, "sr", 30, 110);
    expect(getSkipWindow(db, "sr")).toEqual({ fromSecs: 30, toSecs: 110 });
    clearSkipWindow(db, "sr");
    expect(getSkipWindow(db, "sr")).toBeUndefined();
  });

  it("goes when its series does", () => {
    const db = seed();
    db.pragma("foreign_keys = ON");
    saveSkipWindow(db, "sr", 20, 90);
    db.prepare("DELETE FROM series WHERE id = 'sr'").run();
    expect(getSkipWindow(db, "sr")).toBeUndefined();
  });
});
