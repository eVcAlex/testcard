import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { listChannelFeeds } from "../db/channelFeeds.js";
import { fallbackRank, sameChannelKey } from "../normalise/displayName.js";

describe("sameChannelKey", () => {
  it.each([
    ["BBC One HD", "bbc one"],
    ["BBC One 4K", "bbc one"],
    ["BBC One", "bbc one"],
    ["BBC One (1080p50)", "bbc one"],
    ["Sky Sports F1 UHD HDR", "sky sports f1"],
    ["HD", "hd"],
  ])("%s → %s", (name, key) => expect(sameChannelKey(name)).toBe(key));

  it("tries HD before an unmarked copy, SD after, 4K last", () => {
    const names = ["BBC One 4K", "BBC One SD", "BBC One", "BBC One HD"];
    expect([...names].sort((a, b) => fallbackRank(a) - fallbackRank(b))).toEqual(["BBC One HD", "BBC One", "BBC One SD", "BBC One 4K"]);
  });
});

describe("listChannelFeeds", () => {
  const setup = () => {
    const db = migrateDatabase(new Database(":memory:"));
    for (const source of ["s", "t"]) {
      db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at) VALUES (?, 'xtream', ?, 'http://x', 1)").run(source, source);
      db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name, tags) VALUES (?, ?, '1', 'UK', '')").run(`${source}:c`, source);
    }
    const channel = db.prepare(
      "INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, country, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)",
    );
    const variant = db.prepare("INSERT INTO channel_variants (id, channel_id, provider_stream_id, quality, sort_order) VALUES (?, ?, ?, ?, ?)");
    const add = (id: string, source: string, name: string, country: string | null, streams: string[]) => {
      channel.run(id, source, `${source}:c`, name, name, country);
      streams.forEach((stream, at) => variant.run(`${id}:${at}`, id, stream, at === 0 ? null : `${at}`, at));
    };
    return { db, add };
  };

  it("tries the channel's own feeds, then the same channel in other qualities, this source first", () => {
    const { db, add } = setup();
    add("uhd", "s", "BBC One 4K", "UK", ["1", "2"]);
    add("hd", "s", "BBC One HD", "UK", ["3"]);
    add("sd", "s", "BBC One SD", "UK", ["4"]);
    add("other", "t", "BBC One HD", "UK", ["5"]);
    add("us", "s", "BBC One HD", "US", ["6"]);
    add("two", "s", "BBC One Scotland", "UK", ["7"]);
    expect(listChannelFeeds(db, "uhd").map((feed) => feed.variantId)).toEqual(["uhd:0", "uhd:1", "hd:0", "sd:0", "other:0"]);
  });

  it("skips a stream it has already listed", () => {
    const { db, add } = setup();
    add("a", "s", "Sky News", null, ["1"]);
    add("b", "s", "Sky News HD", null, ["1", "2"]);
    expect(listChannelFeeds(db, "a").map((feed) => feed.variantId)).toEqual(["a:0", "b:1"]);
  });

  it("gives nothing for a channel that is gone", () => {
    const { db } = setup();
    expect(listChannelFeeds(db, "missing")).toEqual([]);
  });
});
