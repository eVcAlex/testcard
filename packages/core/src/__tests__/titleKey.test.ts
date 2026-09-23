import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { listMovieVersions } from "../db/vodQueries.js";
import { dedupeTitles, titleKey } from "../normalise/titleKey.js";

describe("titleKey", () => {
  it("matches one film across catalogue tags, 4K, spacing and a chart rank", () => {
    const keys = ["TOP - Dune: Part Two (2024)", "EN - Dune: Part Two  (2024)", "EN-TOP - 42. Dune: Part Two (2024)", "4K-EN - Dune: Part Two (2024)"].map(titleKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("keeps different years apart", () => {
    expect(titleKey("EN - Dune (2021)")).not.toBe(titleKey("EN - Dune (1984)"));
  });
});

describe("dedupeTitles", () => {
  it("keeps the first copy of a dated title", () => {
    const rows = [{ id: "a", name: "EN - Dune (2021)" }, { id: "b", name: "4K-EN - Dune  (2021)" }, { id: "c", name: "EN - Leo (2023)" }];
    expect(dedupeTitles(rows).map((row) => row.id)).toEqual(["a", "c"]);
  });

  it("never merges undated names, which are often a show's separate episodes", () => {
    const rows = [{ id: "a", name: "EN - WWE SmackDown" }, { id: "b", name: "EN - WWE SmackDown" }];
    expect(dedupeTitles(rows)).toHaveLength(2);
  });

  it("stops at the limit", () => {
    const rows = [{ name: "A (2001)" }, { name: "B (2002)" }, { name: "C (2003)" }];
    expect(dedupeTitles(rows, 2)).toHaveLength(2);
  });
});

describe("listMovieVersions", () => {
  function seed() {
    const db = migrateDatabase(new Database(":memory:"));
    db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES ('s', 'xtream', 'S', 'http://x', 1)").run();
    db.prepare("INSERT INTO movie_categories (id, source_id, provider_id, raw_name) VALUES ('mc', 's', '1', 'M')").run();
    const add = db.prepare("INSERT INTO movies (id, source_id, category_id, provider_stream_id, name, first_seen_at, last_seen_at) VALUES (?, 's', 'mc', ?, ?, 1, 1)");
    for (const [id, name] of [["m1", "EN - Dune  (2021)"], ["m2", "4K-EN - Dune  (2021)"], ["m3", "EN - Dune World  (2021)"], ["m4", "EN - Dune (1984)"], ["w1", "EN - WWE Raw"], ["w2", "EN - WWE Raw"]] as const) add.run(id, id, name);
    return db;
  }

  it("finds the other copies of the same dated title only", () => {
    expect(listMovieVersions(seed(), "m1").map((row) => row.id)).toEqual(["m2"]);
  });

  it("finds none for an undated name", () => {
    expect(listMovieVersions(seed(), "w1")).toEqual([]);
  });
});
