import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { importVod } from "../db/importVod.js";
import { importSource } from "../db/importSource.js";
import { fetchAll } from "../source/inTurn.js";
import type { Source } from "../source/types.js";

const source = { id: "s", kind: "xtream", name: "S", baseUrl: "http://panel.example" } as unknown as Source;
const credentials = async () => ({ baseUrl: "http://panel.example", username: "u", password: "p" });

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES ('s', 'xtream', 'S', 'http://panel.example', 0)").run();
  return db;
}

/** A provider with two film categories; `names` sets each film's title. */
function provider(names: Record<number, string>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const action = new URL(url).searchParams.get("action");
    const category = new URL(url).searchParams.get("category_id");
    if (action === "get_vod_categories") return Response.json([{ category_id: "1", category_name: "Films" }, { category_id: "2", category_name: "More" }]);
    const ids = category === "1" ? [1, 2] : [3];
    return Response.json(ids.map((id) => ({ stream_id: id, name: names[id] ?? `Film ${id}`, category_id: category })));
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("a refresh writes only what changed", () => {
  it("keeps an unchanged film's details and key, and refreshes a changed one", async () => {
    const db = seed();
    provider({});
    await importVod(db, source, credentials);
    db.prepare("UPDATE movies SET details_fetched_at = 1, plot = 'kept'").run();
    const keys = new Map((db.prepare("SELECT id, remote_key AS k FROM movies").all() as { id: string; k: string }[]).map((row) => [row.id, row.k]));

    provider({ 2: "Film 2 (Director's cut)" });
    await importVod(db, source, credentials);
    const rows = db.prepare("SELECT id, name, details_fetched_at AS fetched, remote_key AS k FROM movies ORDER BY id").all() as { id: string; name: string; fetched: number | null; k: string }[];
    expect(rows.map((row) => [row.id, row.name, row.fetched])).toEqual([
      ["s:1", "Film 1", 1],
      ["s:2", "Film 2 (Director's cut)", null],
      ["s:3", "Film 3", 1],
    ]);
    for (const row of rows) expect(row.k).toBe(keys.get(row.id));
  });

  it("works every key out again when the stored ones no longer match the source's host", async () => {
    const db = seed();
    provider({});
    await importVod(db, source, credentials);
    const before = db.prepare("SELECT remote_key AS k FROM movies WHERE id = 's:1'").get() as { k: string };
    db.prepare("UPDATE movies SET remote_key = 'stale'").run();
    await importVod(db, source, credentials);
    expect(db.prepare("SELECT remote_key AS k FROM movies WHERE id = 's:1'").get()).toEqual(before);
  });

  it("leaves an unchanged channel's streams in place", async () => {
    const db = seed();
    const page = {
      category: { id: "s:1", sourceId: "s", providerId: "1", rawName: "News" },
      channels: [
        {
          id: "s:news",
          sourceId: "s",
          categoryId: "s:1",
          normalisedName: "News",
          rawName: "News",
          variants: [{ id: "s:news:1", channelId: "s:news", providerStreamId: "1", isOffline: false }],
        },
      ],
    };
    const adapter = { async *importAll() { yield page as never; } };
    await importSource(db, source, adapter);
    const rowid = (db.prepare("SELECT rowid FROM channel_variants").get() as { rowid: number }).rowid;
    await importSource(db, source, adapter);
    expect((db.prepare("SELECT rowid FROM channel_variants").get() as { rowid: number }).rowid).toBe(rowid);
  });
});

describe("fetchAll", () => {
  it("keeps the items' order and runs no more than the limit at once", async () => {
    let running = 0;
    let most = 0;
    const results = await fetchAll([5, 1, 3, 2, 4], async (n) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, n));
      running -= 1;
      return n * 10;
    }, 2);
    expect(results).toEqual([50, 10, 30, 20, 40]);
    expect(most).toBe(2);
  });
});
