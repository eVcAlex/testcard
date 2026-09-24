import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { listFavouriteChannels, listRecentChannels, moveFavourite, recordRecent, removeChannelFromRecents, toggleFavourite } from "../db/queries.js";
import { applyChannelHistory, channelKeyFor, collectChannelHistory } from "../sync/channelHistory.js";

/** A device with the same source (same account key) under its own local id. */
function device(sourceId: string, channels: readonly string[]) {
  const db = migrateDatabase(new Database(":memory:"));
  db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at, remote_key, sync_updated_at) VALUES (?, 'xtream', 'One', 'http://x', 1, 'shared-key', 1)").run(sourceId);
  db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name) VALUES (?, ?, 'news', 'News')").run(`${sourceId}:news`, sourceId);
  for (const key of channels) addChannel(db, sourceId, key);
  return db;
}

function addChannel(db: Database.Database, sourceId: string, key: string) {
  db.prepare("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, 1, 1)").run(`${sourceId}:${key}`, sourceId, `${sourceId}:news`, key, key);
}

describe("channel favourites and recents", () => {
  it("reach another device with the same source, in the viewer's order", () => {
    const phone = device("aaa", ["bbc", "sky", "itv"]);
    for (const key of ["bbc", "sky", "itv"]) toggleFavourite(phone, `aaa:${key}`);
    moveFavourite(phone, "aaa:bbc", -1);
    recordRecent(phone, "aaa:sky");
    const sent = collectChannelHistory(phone, 0);

    const tv = device("zzz", ["bbc", "sky", "itv"]);
    expect(applyChannelHistory(tv, sent.channelFavourites, sent.channelRecents)).toBe(true);
    expect(listFavouriteChannels(tv).map((row) => row.id)).toEqual(listFavouriteChannels(phone).map((row) => row.id.replace("aaa:", "zzz:")));
    expect(listRecentChannels(tv).map((row) => row.id)).toEqual(["zzz:sky"]);

    removeChannelFromRecents(phone, "aaa:sky");
    toggleFavourite(phone, "aaa:itv");
    const later = collectChannelHistory(phone, Date.now() + 1);
    applyChannelHistory(tv, later.channelFavourites, later.channelRecents);
    expect(listRecentChannels(tv)).toEqual([]);
    expect(listFavouriteChannels(tv).map((row) => row.id)).not.toContain("zzz:itv");
  });

  it("keeps a row for a channel not here yet, and applies it once the channel arrives", () => {
    const phone = device("aaa", ["bbc"]);
    toggleFavourite(phone, "aaa:bbc");
    const sent = collectChannelHistory(phone, 0);
    const tv = device("zzz", []);
    applyChannelHistory(tv, sent.channelFavourites, []);
    expect(listFavouriteChannels(tv)).toEqual([]);
    addChannel(tv, "zzz", "bbc");
    applyChannelHistory(tv, [], []);
    expect(listFavouriteChannels(tv).map((row) => row.id)).toEqual(["zzz:bbc"]);
    expect(tv.prepare("SELECT COUNT(*) AS n FROM pending_channel_sync").get()).toEqual({ n: 0 });
  });

  it("gives the Android database's stand-in for NUL the same key", () => {
    expect(channelKeyFor("k", "s", "s:bbc\u0001hd")).toBe(channelKeyFor("k", "s", "s:bbc\0hd"));
  });
});
