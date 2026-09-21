import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { searchAll } from "../db/searchQueries.js";

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  const now = Date.now();
  for (const id of ["a", "b"]) db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES (?, 'xtream', ?, 'http://x', ?)").run(id, id, now);
  const movieCat = db.prepare("INSERT INTO movie_categories (id, source_id, provider_id, raw_name, tags) VALUES (?, ?, ?, ?, ?)");
  movieCat.run("a:m1", "a", "1", "ACTION", "");
  movieCat.run("a:m2", "a", "2", "XXX", "adult");
  movieCat.run("b:m1", "b", "1", "DRAMA", "");
  const seriesCat = db.prepare("INSERT INTO series_categories (id, source_id, provider_id, raw_name, tags) VALUES (?, ?, ?, ?, ?)");
  seriesCat.run("a:s1", "a", "1", "DRAMA", "");
  const chanCat = db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name, tags) VALUES (?, ?, ?, ?, ?)");
  chanCat.run("a:c1", "a", "1", "SPORT", "");

  const movie = db.prepare("INSERT INTO movies (id, source_id, category_id, provider_stream_id, name, poster_url, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  let n = 0;
  const addMovie = (source: string, cat: string, name: string, poster: string | null) => {
    n += 1;
    movie.run(`${source}:m${n}`, source, cat, String(n), name, poster, now, now);
  };
  addMovie("a", "a:m1", "Spider-Man (2002)", "http://p");
  addMovie("a", "a:m1", "4K-TOP - Spider-Man (2002)", "http://p");
  addMovie("a", "a:m1", "Spider Verse (2018)", null);
  addMovie("a", "a:m2", "Spider Adult Feature", "http://p");
  addMovie("b", "b:m1", "Spiderwick Chronicles (2008)", "http://p");
  addMovie("a", "a:m1", "Heat (1995)", "http://p");

  db.prepare("INSERT INTO series (id, source_id, category_id, provider_series_id, name, poster_url, first_seen_at, last_seen_at) VALUES ('a:s1', 'a', 'a:s1', '1', 'Spider Show (2020)', 'http://p', ?, ?)").run(now, now);
  const channel = db.prepare("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, first_seen_at, last_seen_at) VALUES (?, 'a', 'a:c1', ?, ?, ?, ?)");
  channel.run("a:ch1", "Sky Sports Main Event", "UK| Sky Sports Main Event", now, now);
  channel.run("a:ch2", "Sky Sports Main Event", "UK| Sky Sports Main Event FHD", now, now);
  channel.run("a:ch3", "BT Sport 1", "UK| BT Sport 1", now, now);
  return db;
}

describe("searchAll", () => {
  it("finds films, series and channels from one query, matching word starts", () => {
    const db = seed();
    const results = searchAll(db, "spid");
    expect(results.movies.map((movie) => movie.name)).toEqual(expect.arrayContaining(["Spider-Man (2002)", "Spiderwick Chronicles (2008)"]));
    expect(results.series.map((show) => show.name)).toEqual(["Spider Show (2020)"]);
    expect(searchAll(db, "sky spor").channels).toHaveLength(1);
  });

  it("puts titles with a poster first and shows one title once across qualities", () => {
    const names = searchAll(seed(), "spider").movies.map((movie) => movie.name);
    expect(names.filter((name) => name.includes("Spider-Man"))).toHaveLength(1);
    expect(names[names.length - 1]).toBe("Spider Verse (2018)");
  });

  it("leaves out adult categories", () => {
    expect(searchAll(seed(), "spider").movies.map((movie) => movie.name)).not.toContain("Spider Adult Feature");
  });

  it("scopes to one source", () => {
    const results = searchAll(seed(), "spider", { sourceId: "b" });
    expect(results.movies.map((movie) => movie.name)).toEqual(["Spiderwick Chronicles (2008)"]);
    expect(results.channels).toEqual([]);
  });

  it("ignores a query that is too short and survives punctuation", () => {
    const db = seed();
    expect(searchAll(db, "s")).toEqual({ movies: [], series: [], channels: [] });
    expect(() => searchAll(db, 'spider" OR (-')).not.toThrow();
  });
});
