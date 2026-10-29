import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { importEpg } from "../epg/importEpg.js";
import { guideKey, matchGuide, type GuideChannel, type MatchableChannel } from "../epg/matchGuide.js";

const channel = (id: string, rawName: string, country: string | null = null, tvgId: string | null = null): MatchableChannel => ({ id, rawName, country, tvgId });
const guide: GuideChannel[] = [
  { id: "BBCOne.uk", names: ["BBC One", "BBC 1"] },
  { id: "Sky1.uk", names: ["Sky 1"] },
  { id: "Sky1.de", names: ["Sky 1"] },
  { id: "Dave.uk", names: ["Dave"] },
  { id: "ITV1.uk", names: ["ITV1"] },
  { id: "ITV1plus1.uk", names: ["ITV1 +1"] },
];

describe("guideKey", () => {
  it("reads quality words, styling, case and punctuation as the same channel", () => {
    expect(guideKey("UK| BBC One HD")).toBe(guideKey("BBC One"));
    expect(guideKey("Sky Sports Main Event ᵁᴴᴰ")).toBe(guideKey("sky sports main event"));
    expect(guideKey("Comedy & Drama")).toBe(guideKey("Comedy and Drama"));
  });
  it("keeps +1 apart from the channel itself", () => {
    expect(guideKey("ITV1 +1")).not.toBe(guideKey("ITV1"));
  });
});

describe("matchGuide", () => {
  it("leaves a channel whose own tvg-id the guide knows alone", () => {
    const { matches, stats } = matchGuide([channel("c1", "Whatever", null, "Dave.uk")], guide);
    expect(matches.size).toBe(0);
    expect(stats).toMatchObject({ exact: 1, matched: 0 });
  });

  it("links a channel with no or an unknown tvg-id by name", () => {
    const { matches } = matchGuide([channel("c1", "UK| BBC One HD"), channel("c2", "Dave", null, "gone.id")], guide);
    expect(matches.get("c1")).toEqual({ guideId: "BBCOne.uk", method: "name" });
    expect(matches.get("c2")).toEqual({ guideId: "Dave.uk", method: "name" });
  });

  it("does not take +1 for the channel itself", () => {
    const { matches } = matchGuide([channel("c1", "ITV1 +1 HD")], guide);
    expect(matches.get("c1")?.guideId).toBe("ITV1plus1.uk");
  });

  it("uses the channel's country to choose between guide channels of one name", () => {
    expect(matchGuide([channel("c1", "Sky 1", "UK")], guide).matches.get("c1")?.guideId).toBe("Sky1.uk");
    expect(matchGuide([channel("c1", "Sky 1", "DE")], guide).matches.get("c1")?.guideId).toBe("Sky1.de");
  });

  it("does not guess between equal fits, and says so", () => {
    const { matches, stats } = matchGuide([channel("c1", "Sky 1")], guide);
    expect(matches.size).toBe(0);
    expect(stats).toMatchObject({ ambiguous: 1, unmatched: 0 });
  });

  it("counts a channel nothing fits as unmatched, and one only another market fits as unmatched", () => {
    const { stats } = matchGuide([channel("c1", "Unknown Channel"), channel("c2", "Sky 1", "US")], guide);
    expect(stats).toMatchObject({ unmatched: 2, matched: 0, ambiguous: 0 });
  });

  it("prefers a curated alias, but only for a guide id the guide has", () => {
    const aliases = new Map([[guideKey("The Beeb"), "BBCOne.uk"], [guideKey("Ghost"), "nope.uk"]]);
    const { matches } = matchGuide([channel("c1", "The Beeb"), channel("c2", "Ghost")], guide, { aliases });
    expect(matches.get("c1")).toEqual({ guideId: "BBCOne.uk", method: "alias" });
    expect(matches.has("c2")).toBe(false);
  });

  it("reports every channel in its counts", () => {
    const channels = [channel("a", "Dave"), channel("b", "Sky 1"), channel("c", "Nope"), channel("d", "x", null, "Dave.uk")];
    const { stats } = matchGuide(channels, guide);
    expect(stats.exact + stats.matched + stats.ambiguous + stats.unmatched).toBe(stats.channels);
  });
});

const streamOf = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

const stamp = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`;
};

function seeded() {
  const db = migrateDatabase(new Database(":memory:"));
  db.prepare("INSERT INTO sources (id, kind, name, playlist_url, created_at) VALUES ('s1', 'm3u', 'One', 'http://p/l.m3u', 1)").run();
  db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name) VALUES ('cat', 's1', 'c', 'UK')").run();
  const insert = db.prepare(
    "INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, country, tvg_id, first_seen_at, last_seen_at) VALUES (?, 's1', 'cat', ?, ?, ?, ?, 1, 1)",
  );
  insert.run("ch-good", "Dave", "Dave", "UK", "Dave.uk"); // links by its own tvg-id
  insert.run("ch-bbc", "BBC One", "UK| BBC One HD", "UK", null); // no tvg-id: needs the name
  insert.run("ch-none", "Mystery", "Mystery", null, null); // nothing in the guide
  return db;
}

const now = Date.now();
const xmltv = `<?xml version="1.0"?><tv>
<channel id="Dave.uk"><display-name>Dave</display-name></channel>
<channel id="BBCOne.uk"><display-name>BBC One</display-name><display-name>BBC 1</display-name></channel>
<programme start="${stamp(now - 3600_000)}" stop="${stamp(now + 3600_000)}" channel="Dave.uk"><title>Quiz</title></programme>
<programme start="${stamp(now - 3600_000)}" stop="${stamp(now + 3600_000)}" channel="BBCOne.uk"><title>News</title></programme>
</tv>`;

const titlesFor = (db: Database.Database, id: string) =>
  (db.prepare("SELECT title FROM programmes WHERE channel_id = ?").all(id) as { title: string }[]).map((row) => row.title);

describe("importEpg with optimising", () => {
  it("imports exactly as before when off", async () => {
    const db = seeded();
    const result = await importEpg(db, "s1", streamOf(xmltv));
    expect(titlesFor(db, "ch-good")).toEqual(["Quiz"]);
    expect(titlesFor(db, "ch-bbc")).toEqual([]);
    expect(result.matching).toBeUndefined();
  });

  it("also fills a channel the tvg-id missed, and says how the channels fared", async () => {
    const db = seeded();
    const result = await importEpg(db, "s1", streamOf(xmltv), { optimise: true });
    expect(titlesFor(db, "ch-good")).toEqual(["Quiz"]);
    expect(titlesFor(db, "ch-bbc")).toEqual(["News"]);
    expect(titlesFor(db, "ch-none")).toEqual([]);
    expect(result.matching).toEqual({ channels: 3, exact: 1, matched: 1, ambiguous: 0, unmatched: 1 });
  });

  it("never changes a channel's id, name, tvg-id or stream", async () => {
    const db = seeded();
    const before = db.prepare("SELECT * FROM channels ORDER BY id").all();
    await importEpg(db, "s1", streamOf(xmltv), { optimise: true });
    expect(db.prepare("SELECT * FROM channels ORDER BY id").all()).toEqual(before);
  });

  it("goes back to the plain result on the next import with it off", async () => {
    const db = seeded();
    await importEpg(db, "s1", streamOf(xmltv), { optimise: true });
    await importEpg(db, "s1", streamOf(xmltv));
    expect(titlesFor(db, "ch-bbc")).toEqual([]);
    expect(titlesFor(db, "ch-good")).toEqual(["Quiz"]);
  });

  it("still imports a guide that has no channel list", async () => {
    const db = seeded();
    const bare = `<tv><programme start="${stamp(now - 3600_000)}" stop="${stamp(now + 3600_000)}" channel="Dave.uk"><title>Quiz</title></programme></tv>`;
    const result = await importEpg(db, "s1", streamOf(bare), { optimise: true });
    expect(titlesFor(db, "ch-good")).toEqual(["Quiz"]);
    expect(result.matching).toBeUndefined();
  });
});
