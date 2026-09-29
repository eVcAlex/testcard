import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { buildGuide } from "../epg/buildGuide.js";
import { importGuideFile } from "../epg/importGuideFile.js";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
const programme = (channel: string, start: number, end: number, title: string) =>
  `<programme channel="${channel}" start="${stamp(start)}" stop="${stamp(end)}"><title>${title}</title><desc>Not kept.</desc></programme>`;

const streamOf = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

describe("buildGuide", () => {
  it("keeps every channel's programmes inside the window, in start order, without descriptions", async () => {
    const xml = `<tv>${[
      programme("bbc1", NOW + HOUR, NOW + 2 * HOUR, "Later"),
      programme("bbc1", NOW, NOW + HOUR, "Now"),
      programme("bbc1", NOW - 10 * HOUR, NOW - 9 * HOUR, "Long gone"),
      programme("bbc1", NOW + 48 * HOUR, NOW + 49 * HOUR, "Too far ahead"),
      programme("itv", NOW, NOW + HOUR, "Elsewhere"),
    ].join("")}</tv>`;
    const file = await buildGuide(streamOf(xml), { now: NOW, horizonMs: 36 * HOUR });
    expect(file.at).toBe(NOW);
    expect(file.c["bbc1"]).toEqual([
      [NOW, NOW + HOUR, "Now"],
      [NOW + HOUR, NOW + 2 * HOUR, "Later"],
    ]);
    expect(file.c["itv"]).toEqual([[NOW, NOW + HOUR, "Elsewhere"]]);
  });
});

describe("importGuideFile", () => {
  it("fills the programmes of the channels a source has, replacing what it held", async () => {
    const db = migrateDatabase(new Database(":memory:"));
    db.prepare("INSERT INTO sources (id, kind, name, playlist_url, created_at) VALUES ('s1', 'm3u', 'One', 'http://p/list.m3u', 1)").run();
    db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name) VALUES ('cat', 's1', 'news', 'News')").run();
    db.prepare("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, tvg_id, first_seen_at, last_seen_at) VALUES ('c1', 's1', 'cat', 'BBC One', 'BBC One', 'bbc1', 1, 1)").run();
    db.prepare("INSERT INTO programmes (channel_id, title, description, start_at, end_at) VALUES ('c1', 'Old', NULL, 1, 2)").run();
    const result = await importGuideFile(db, "s1", { at: NOW, c: { bbc1: [[NOW, NOW + HOUR, "Now"]], unknown: [[NOW, NOW + HOUR, "Nobody's"]] } });
    expect(result).toMatchObject({ channels: 1, programmes: 1 });
    expect(db.prepare("SELECT channel_id, title, start_at, end_at FROM programmes").all()).toEqual([{ channel_id: "c1", title: "Now", start_at: NOW, end_at: NOW + HOUR }]);
  });
});
