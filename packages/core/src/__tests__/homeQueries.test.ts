import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { movieHome, seriesHome, titleKey } from "../db/homeQueries.js";

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  const now = Date.now();
  for (const id of ["a", "b"]) db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES (?, 'xtream', ?, 'http://x', ?)").run(id, id, now);
  const category = db.prepare("INSERT INTO movie_categories (id, source_id, provider_id, raw_name, genre, tags) VALUES (?, ?, ?, ?, ?, ?)");
  category.run("a:1", "a", "1", "ACTION", "action", "");
  category.run("a:2", "a", "2", "COMEDY", "comedy", "");
  category.run("a:3", "a", "3", "XXX", "action", "adult");
  category.run("b:1", "b", "1", "DRAMA", "drama", "");
  category.run("a:4", "a", "4", "ASIA MOVIES (MULTI-SUBS)", null, "");
  category.run("a:5", "a", "5", "FR - COMEDIE", "comedy", "");
  db.prepare("UPDATE movie_categories SET language = 'fr' WHERE id = 'a:5'").run();
  db.prepare("UPDATE movie_categories SET language = 'en' WHERE id = 'a:2'").run();
  const movie = db.prepare("INSERT INTO movies (id, source_id, category_id, provider_stream_id, name, poster_url, rating, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  let n = 0;
  const add = (source: string, cat: string, name: string, poster: string | null, rating: string | null, seenAt = now) => {
    n += 1;
    movie.run(`${source}:m${n}`, source, cat, String(n), name, poster, rating, seenAt, seenAt);
  };
  for (let i = 1; i <= 10; i += 1) add("a", "a:1", `Action Film ${i} (2020)`, "http://p", String(5 + i / 5), now + i);
  for (let i = 1; i <= 10; i += 1) add("a", "a:2", `Comedy Film ${i}`, "http://p", null, now + 100 + i);
  add("a", "a:1", "4K-TOP - Action Film 10 (2020)", "http://p", "9.8"); // same film in another quality
  add("a", "a:1", "No Poster", null, "9.5");
  for (let i = 1; i <= 8; i += 1) add("a", "a:3", `Adult ${i}`, "http://p", "9");
  for (let i = 1; i <= 8; i += 1) add("b", "b:1", `Drama Film ${i}`, "http://p", "7");
  for (let i = 1; i <= 8; i += 1) add("a", "a:4", `Asian Film ${i}`, "http://p", "8.5");
  for (let i = 1; i <= 8; i += 1) add("a", "a:5", `Film Francais ${i}`, "http://p", "8.4");
  add("a", "a:2", "Single Vote Wonder", "http://p", "10");
  for (let i = 1; i <= 4; i += 1) add("b", "b:1", `Fresh Film ${i} (2026)`, "http://p", String(6 + i / 2), now - 1000);
  for (let i = 1; i <= 4; i += 1) add("b", "b:1", `Last Year Film ${i} (2025)`, "http://p", String(9 - i / 4), now + 5000);
  add("b", "b:1", "Classic (2001)", "http://p", "9.5");
  return db;
}

describe("titleKey", () => {
  it("treats a quality-tagged copy as the same title", () => {
    expect(titleKey("4K-TOP - The Film (2020)")).toBe(titleKey("The Film (2020)"));
    expect(titleKey("The Film (2020)")).not.toBe(titleKey("The Film (2021)"));
  });
});

describe("movieHome", () => {
  it("builds top rated, recently added and genre rows", () => {
    const shelves = movieHome(seed(), { perShelf: 4, minTitles: 3 });
    expect(shelves.map((shelf) => shelf.key)).toEqual(expect.arrayContaining(["top", "genre:comedy", "genre:drama"]));
  });

  it("shows each title once across the whole page", () => {
    const ids = movieHome(seed()).flatMap((shelf) => shelf.items.map((item) => titleKey(item.name)));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves out adult categories and titles without a poster", () => {
    const names = movieHome(seed()).flatMap((shelf) => shelf.items.map((item) => item.name));
    expect(names.some((name) => name.startsWith("Adult"))).toBe(false);
    expect(names).not.toContain("No Poster");
  });

  it("puts the best rated first", () => {
    const top = movieHome(seed()).find((shelf) => shelf.key === "top");
    expect(top?.items[0]?.name).toBe("4K-TOP - Action Film 10 (2020)");
  });

  it("steers away from Asian catalogues, but not from other titles", () => {
    const names = movieHome(seed()).flatMap((shelf) => shelf.items.map((item) => item.name));
    expect(names.some((name) => name.startsWith("Asian"))).toBe(false);
    expect(names.some((name) => name.startsWith("Drama Film"))).toBe(true);
  });

  it("drops categories labelled with another language than the viewer's", () => {
    const seededAll = movieHome(seed()).flatMap((shelf) => shelf.items.map((item) => item.name));
    expect(seededAll.some((name) => name.startsWith("Film Francais"))).toBe(true);
    const english = movieHome(seed(), { language: "en" }).flatMap((shelf) => shelf.items.map((item) => item.name));
    expect(english.some((name) => name.startsWith("Film Francais"))).toBe(false);
    expect(english.some((name) => name.startsWith("Comedy Film"))).toBe(true);
  });

  it("does not trust a perfect 10 as a top rating", () => {
    const top = movieHome(seed()).find((shelf) => shelf.key === "top");
    expect(top?.items.map((item) => item.name)).not.toContain("Single Vote Wonder");
  });

  it("builds this-year rows from the year in each title", () => {
    const shelves = movieHome(seed(), { year: 2026, perShelf: 4, minTitles: 2 });
    expect(shelves.map((shelf) => shelf.key).slice(0, 3)).toEqual(["top", "new", "rated"]);
    const top = shelves.find((shelf) => shelf.key === "top");
    expect(top?.label).toBe("Top 10 this year");
    expect(top?.items.every((item) => /((2026|2025))/.test(item.name))).toBe(true);
    expect(top?.items.map((item) => item.name)).not.toContain("Classic (2001)");
  });

  it("puts the newest year first in New releases, whatever the provider added first", () => {
    const fresh = movieHome(seed(), { year: 2026, perShelf: 4, minTitles: 2 }).find((shelf) => shelf.key === "new");
    expect(fresh?.items[0]?.name).toMatch(/(2026)/);
  });

  it("scopes to one source", () => {
    const shelves = movieHome(seed(), { sourceId: "b" });
    expect(shelves.flatMap((shelf) => shelf.items).every((item) => item.source_id === "b")).toBe(true);
    expect(shelves.length).toBeGreaterThan(0);
  });

  it("drops rows too small to fill", () => {
    expect(movieHome(seed(), { minTitles: 50 })).toEqual([]);
  });
});

describe("seriesHome", () => {
  it("returns nothing for an empty catalogue", () => {
    expect(seriesHome(migrateDatabase(new Database(":memory:")))).toEqual([]);
  });
});
