import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { deleteProfile, listProfiles, MAIN_PROFILE, saveProfile } from "../db/profiles.js";
import { swapProfile } from "../db/profileSwap.js";
import { applyRemoteChanges, collectLocalChanges } from "../sync/localChanges.js";
import { applyHeldPins, holdPinsForMain, listHomePins, pinCategory, pinsForSource } from "../sync/sourcePins.js";
import { decryptCredentials } from "../sync/credentialCrypto.js";
import type { SyncPullResponse } from "@testcard/sync-schema";

const credentials = async () => ({ baseUrl: "http://x", username: "u", password: "p" });

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at, remote_key, sync_updated_at) VALUES ('s1', 'xtream', 'One', 'http://x', 1, 'key-s1', 1)").run();
  db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name) VALUES ('s1:c9', 's1', '9', 'Sky Sports')").run();
  db.prepare("INSERT INTO movie_categories (id, source_id, provider_id, raw_name) VALUES ('s1:mc', 's1', '1', 'Films')").run();
  db.prepare("INSERT INTO movies (id, source_id, category_id, provider_stream_id, name, first_seen_at, last_seen_at, remote_key) VALUES ('m1', 's1', 's1:mc', '1', 'Film', 1, 1, 'mk1')").run();
  return db;
}

const empty: SyncPullResponse = { sources: [], movieFavourites: [], movieRecents: [], seriesFavourites: [], seriesRecents: [], progress: [], profiles: [], serverCursor: 0 };
const noSource = async () => undefined;

describe("profile sync", () => {
  it("pushes another profile's rows under its prefix, and Main's without one", async () => {
    const db = seed();
    db.prepare("INSERT INTO movie_favourites (movie_id, added_at, remote_key, updated_at) VALUES ('m1', 5, 'mk1', 5)").run();
    expect((await collectLocalChanges(db, 0, "pw", "salt", credentials)).movieFavourites.map((row) => row.remoteKey)).toEqual(["mk1"]);
    expect((await collectLocalChanges(db, 0, "pw", "salt", credentials, "kid1")).movieFavourites.map((row) => row.remoteKey)).toEqual(["p.kid1.mk1"]);
  });

  it("applies only the watching profile's rows, and never holds the cursor back on another's", async () => {
    const db = seed();
    const pulled = { ...empty, movieFavourites: [{ remoteKey: "p.kid1.mk1", addedAt: 7, updatedAt: 7, deletedAt: null }, { remoteKey: "p.kid2.zz", addedAt: 8, updatedAt: 8, deletedAt: null }] };
    expect((await applyRemoteChanges(db, pulled, "pw", "salt", noSource, noSource)).deferredBeforeMs).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM movie_favourites").get()).toEqual({ n: 0 });
    await applyRemoteChanges(db, pulled, "pw", "salt", noSource, noSource, "kid1");
    expect(db.prepare("SELECT movie_id AS id, remote_key AS key FROM movie_favourites").all()).toEqual([{ id: "m1", key: "mk1" }]);
  });

  it("round-trips a profile, sealed, and a deletion", async () => {
    const phone = seed();
    saveProfile(phone, { id: "kid1", name: "Sam", colour: 2, avatar: "fox", pin: "abc", position: 1 });
    const push = await collectLocalChanges(phone, 0, "pw", "salt", credentials);
    const sent = push.profiles.find((row) => row.remoteKey === "kid1")!;
    expect(sent.blob).not.toContain("Sam");

    const tv = seed();
    await applyRemoteChanges(tv, { ...empty, profiles: push.profiles }, "pw", "salt", noSource, noSource);
    expect(listProfiles(tv).map((profile) => [profile.id, profile.name, profile.avatar, profile.pin])).toEqual([
      [MAIN_PROFILE, "Main", null, null],
      ["kid1", "Sam", "fox", "abc"],
    ]);

    deleteProfile(phone, "kid1");
    const gone = (await collectLocalChanges(phone, sent.updatedAt, "pw", "salt", credentials)).profiles;
    expect(gone).toMatchObject([{ remoteKey: "kid1", blob: null, deletedAt: expect.any(Number) }]);
    await applyRemoteChanges(tv, { ...empty, profiles: gone }, "pw", "salt", noSource, noSource);
    expect(listProfiles(tv).map((profile) => profile.id)).toEqual([MAIN_PROFILE]);
  });

  it("keeps Home pins out of the source record while another profile watches, and holds pins that arrive for Main", async () => {
    const db = seed();
    pinCategory(db, "live", "s1:c9", "Sky Sports");
    swapProfile(db, MAIN_PROFILE, "kid1");
    const source = (await collectLocalChanges(db, 0, "pw", "salt", credentials, "kid1")).sources[0]!;
    expect(await decryptCredentials({ blob: source.credentialsBlob!, iv: source.credentialsIv! }, "pw", "salt")).not.toHaveProperty("pins");

    holdPinsForMain(db, "s1", [{ kind: "live", key: "9", label: "Sky Sports" }, { kind: "movies", key: "1", label: "Films" }]);
    expect(listHomePins(db)).toEqual([]);
    swapProfile(db, "kid1", MAIN_PROFILE);
    expect(pinsForSource(db, "s1").map((pin) => pin.label)).toEqual(["Sky Sports", "Films"]);
    applyHeldPins(db);
    expect(pinsForSource(db, "s1")).toHaveLength(2);
  });

  it("gives each profile its own pull cursor", () => {
    const db = seed();
    db.prepare("INSERT INTO sync_state (id, last_pulled_at, last_pushed_at) VALUES (1, 500, 500)").run();
    swapProfile(db, MAIN_PROFILE, "kid1");
    expect(db.prepare("SELECT last_pulled_at AS at FROM sync_state").get()).toEqual({ at: 0 });
    db.prepare("UPDATE sync_state SET last_pulled_at = 90").run();
    swapProfile(db, "kid1", MAIN_PROFILE);
    expect(db.prepare("SELECT last_pulled_at AS at FROM sync_state").get()).toEqual({ at: 500 });
    swapProfile(db, MAIN_PROFILE, "kid1");
    expect(db.prepare("SELECT last_pulled_at AS at FROM sync_state").get()).toEqual({ at: 90 });
  });
});
