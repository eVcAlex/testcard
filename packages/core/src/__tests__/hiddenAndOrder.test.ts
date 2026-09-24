import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { browseChannels, listCategories, listFavouriteChannels, moveFavourite, toggleFavourite } from "../db/queries.js";
import { browseMovies, listMovieCategories, listMoviePlayOrder } from "../db/vodQueries.js";
import { listSeriesVersions } from "../db/seriesQueries.js";
import { searchAll } from "../db/searchQueries.js";
import { applySourceHidden, hiddenForSource, hideCategory, hideChannel, listHidden, unhide } from "../sync/hidden.js";
import { collectLocalChanges } from "../sync/localChanges.js";
import { decryptCredentials } from "../sync/credentialCrypto.js";

const credentials = async () => ({ baseUrl: "http://x", username: "u", password: "p" });

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  const source = db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at, remote_key, sync_updated_at, sort_order) VALUES (?, 'xtream', ?, 'http://x', 1, ?, 1, ?)");
  source.run("s1", "One", "k1", 0);
  source.run("s2", "Two", "k2", 1);
  db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name) VALUES ('s1:news', 's1', 'news', 'News'), ('s1:sport', 's1', 'sport', 'Sport')").run();
  const channel = db.prepare("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, first_seen_at, last_seen_at) VALUES (?, 's1', ?, ?, ?, 1, 1)");
  channel.run("s1:bbc", "s1:news", "BBC News", "BBC News");
  channel.run("s1:sky", "s1:news", "Sky News", "Sky News");
  channel.run("s1:espn", "s1:sport", "ESPN", "ESPN");
  db.prepare("INSERT INTO movie_categories (id, source_id, provider_id, raw_name) VALUES ('s1:mc', 's1', 'mc', 'Films'), ('s2:mc', 's2', 'mc', 'Films'), ('s1:kids', 's1', 'kids', 'Kids')").run();
  const movie = db.prepare("INSERT INTO movies (id, source_id, category_id, provider_stream_id, name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, 1, 1)");
  movie.run("s1:1", "s1", "s1:mc", "1", "EN - Dune (2021)");
  movie.run("s2:9", "s2", "s2:mc", "9", "4K-EN - Dune (2021)");
  movie.run("s1:2", "s1", "s1:kids", "2", "EN - Bluey Movie (2024)");
  db.prepare("INSERT INTO series_categories (id, source_id, provider_id, raw_name) VALUES ('s1:sc', 's1', 'sc', 'Shows'), ('s2:sc', 's2', 'sc', 'Shows')").run();
  const show = db.prepare("INSERT INTO series (id, source_id, category_id, provider_series_id, name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, 1, 1)");
  show.run("s1:s1", "s1", "s1:sc", "1", "EN - Severance (2022)");
  show.run("s2:s7", "s2", "s2:sc", "7", "Severance (2022)");
  return db;
}

describe("hiding", () => {
  it("takes a hidden category and channel out of lists and search, and brings them back", () => {
    const db = seed();
    hideCategory(db, "live", "s1:sport", "Sport");
    hideChannel(db, "s1:sky", "Sky News");
    hideCategory(db, "movies", "s1:kids", "Kids");
    expect(listCategories(db).map((row) => row.id)).toEqual(["s1:news"]);
    expect(browseChannels(db).map((row) => row.id)).toEqual(["s1:bbc"]);
    expect(listMovieCategories(db).map((row) => row.id)).not.toContain("s1:kids");
    expect(browseMovies(db).map((row) => row.id)).not.toContain("s1:2");
    expect(searchAll(db, "Bluey").movies).toEqual([]);
    expect(searchAll(db, "Sky").channels).toEqual([]);

    const sky = listHidden(db).find((entry) => entry.kind === "channel")!;
    unhide(db, sky);
    expect(browseChannels(db).map((row) => row.id)).toEqual(["s1:bbc", "s1:sky"]);
  });

  it("rides in the source's record and replaces the set on another device", async () => {
    const db = seed();
    hideChannel(db, "s1:sky", "Sky News");
    hideCategory(db, "live", "s1:sport", "Sport");
    const push = await collectLocalChanges(db, 0, "pw", "salt", credentials);
    const row = push.sources.find((source) => source.remoteKey === "k1")!;
    const payload = await decryptCredentials({ blob: row.credentialsBlob!, iv: row.credentialsIv! }, "pw", "salt");
    expect(payload).toMatchObject({ hidden: [{ kind: "live", key: "sport", label: "Sport" }, { kind: "channel", key: "sky", label: "Sky News" }] });

    const tv = seed();
    hideChannel(tv, "s1:bbc", "BBC News");
    applySourceHidden(tv, "s1", payload.hidden ?? []);
    expect(hiddenForSource(tv, "s1").map((entry) => entry.key)).toEqual(["sport", "sky"]);
    expect(browseChannels(tv).map((row) => row.id)).toEqual(["s1:bbc"]);
  });
});

describe("favourite channel order", () => {
  it("starts newest first and follows the viewer's moves", () => {
    const db = seed();
    for (const id of ["s1:bbc", "s1:sky", "s1:espn"]) {
      toggleFavourite(db, id);
      db.prepare("UPDATE favourites SET added_at = ? WHERE channel_id = ?").run({ "s1:bbc": 1, "s1:sky": 2, "s1:espn": 3 }[id], id);
    }
    expect(listFavouriteChannels(db).map((row) => row.id)).toEqual(["s1:espn", "s1:sky", "s1:bbc"]);
    expect(moveFavourite(db, "s1:bbc", -1)).toBe(true);
    expect(listFavouriteChannels(db).map((row) => row.id)).toEqual(["s1:espn", "s1:bbc", "s1:sky"]);
    expect(moveFavourite(db, "s1:espn", -1)).toBe(false);
  });
});

describe("copies of a title", () => {
  it("plays the 4K copy first, and the one holding the position when resuming", () => {
    const db = seed();
    expect(listMoviePlayOrder(db, "s1:1", false)).toEqual(["s2:9", "s1:1"]);
    expect(listMoviePlayOrder(db, "s1:1", true)).toEqual(["s1:1", "s2:9"]);
    expect(listMoviePlayOrder(db, "s1:2", false)).toEqual(["s1:2"]);
  });

  it("finds a series in another source", () => {
    const db = seed();
    expect(listSeriesVersions(db, "s1:s1").map((row) => row.id)).toEqual(["s2:s7"]);
  });
});
