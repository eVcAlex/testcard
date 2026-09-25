import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { getSeriesDetail, listSeriesVersions, withBorrowedSeasons } from "../db/seriesQueries.js";

/** The Pitt twice: the HD copy lists season 3 with nothing in it and has no season 4; the 4K copy has both. */
function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  const now = Date.now();
  db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES ('a', 'xtream', 'a', 'http://x', ?)").run(now);
  db.prepare("INSERT INTO series_categories (id, source_id, provider_id, raw_name, tags) VALUES ('a:c', 'a', '1', 'DRAMA', '')").run();
  const series = db.prepare("INSERT INTO series (id, source_id, category_id, provider_series_id, name, first_seen_at, last_seen_at) VALUES (?, 'a', 'a:c', ?, ?, ?, ?)");
  series.run("hd", "1", "The Pitt (2025)", now, now);
  series.run("uhd", "2", "4K - The Pitt (2025)", now, now);
  const season = db.prepare("INSERT INTO seasons (id, series_id, season_number) VALUES (?, ?, ?)");
  const episode = db.prepare("INSERT INTO episodes (id, season_id, series_id, provider_episode_id, episode_number, name) VALUES (?, ?, ?, ?, ?, ?)");
  for (const [seriesId, numbers] of [["hd", [1, 2, 3]], ["uhd", [1, 3, 4]]] as const) {
    for (const number of numbers) {
      const seasonId = `${seriesId}:s${number}`;
      season.run(seasonId, seriesId, number);
      const count = seriesId === "hd" && number === 3 ? 0 : 2;
      for (let at = 1; at <= count; at++) episode.run(`${seasonId}:e${at}`, seasonId, seriesId, `${seasonId}:${at}`, at, `Episode ${at}`);
    }
  }
  return db;
}

describe("withBorrowedSeasons", () => {
  it("fills an empty or missing season from another copy, and keeps the copy's own seasons", () => {
    const db = seed();
    expect(listSeriesVersions(db, "hd").map((row) => row.id)).toEqual(["uhd"]);
    const merged = withBorrowedSeasons(db, getSeriesDetail(db, "hd")!, ["uhd"]);
    expect(merged.seasons.map((season) => season.id)).toEqual(["hd:s1", "hd:s2", "uhd:s3", "uhd:s4"]);
    expect(merged.seasons[2]!.episodes.map((episode) => episode.id)).toEqual(["uhd:s3:e1", "uhd:s3:e2"]);
  });

  it("drops a season with no episodes anywhere", () => {
    const db = seed();
    const merged = withBorrowedSeasons(db, getSeriesDetail(db, "hd")!, []);
    expect(merged.seasons.map((season) => season.season_number)).toEqual([1, 2]);
  });

  it("works the other way round, and returns the detail as it was when nothing is missing", () => {
    const db = seed();
    const detail = getSeriesDetail(db, "uhd")!;
    expect(withBorrowedSeasons(db, detail, ["hd"]).seasons.map((season) => season.id)).toEqual(["uhd:s1", "hd:s2", "uhd:s3", "uhd:s4"]);
    const hd = withBorrowedSeasons(db, getSeriesDetail(db, "hd")!, ["uhd"]);
    expect(withBorrowedSeasons(db, hd, ["uhd"])).toBe(hd);
  });
});
