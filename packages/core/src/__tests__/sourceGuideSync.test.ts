import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { importEpg } from "../epg/importEpg.js";
import { collectLocalChanges } from "../sync/localChanges.js";
import { decryptCredentials } from "../sync/credentialCrypto.js";

const credentials = async () => ({ baseUrl: "http://x", username: "u", password: "p" });

function seed() {
  const db = migrateDatabase(new Database(":memory:"));
  db.prepare("INSERT INTO sources (id, kind, name, base_url, epg_url, created_at, remote_key, sync_updated_at) VALUES ('s1', 'xtream', 'One', 'http://x', 'http://guide/epg.xml', 1, 'key-s1', 10)").run();
  db.prepare("INSERT INTO sources (id, kind, name, playlist_url, created_at, remote_key, sync_updated_at) VALUES ('s2', 'm3u', 'Two', 'http://p/list.m3u', 1, 'key-s2', 10)").run();
  return db;
}

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

describe("a source's guide address", () => {
  it("rides in the source's sealed record, null when none is set", async () => {
    const db = seed();
    const push = await collectLocalChanges(db, 0, "pw", "salt", credentials);
    const open = async (key: string) => {
      const row = push.sources.find((source) => source.remoteKey === key)!;
      return decryptCredentials({ blob: row.credentialsBlob!, iv: row.credentialsIv! }, "pw", "salt");
    };
    expect(await open("key-s1")).toMatchObject({ epgUrl: "http://guide/epg.xml" });
    expect(await open("key-s2")).toMatchObject({ epgUrl: null });
  });

  it("is sent once more for sources that had one before it synced", async () => {
    const db = seed();
    // Already pushed up to 100: only the source with an address is due again, and only the first time.
    expect((await collectLocalChanges(db, 100, "pw", "salt", credentials)).sources.map((source) => source.remoteKey)).toEqual(["key-s1"]);
    const since = (db.prepare("SELECT MAX(sync_updated_at) AS at FROM sources").get() as { at: number }).at;
    expect((await collectLocalChanges(db, since, "pw", "salt", credentials)).sources).toEqual([]);
  });
});

describe("a source's backup server addresses", () => {
  it("ride in its sealed record with the login", async () => {
    const db = seed();
    db.prepare(`UPDATE sources SET backup_urls = ? WHERE id = 's1'`).run(JSON.stringify(["http://b1", "http://b2"]));
    const push = await collectLocalChanges(db, 0, "pw", "salt", credentials);
    const row = push.sources.find((source) => source.remoteKey === "key-s1")!;
    expect(await decryptCredentials({ blob: row.credentialsBlob!, iv: row.credentialsIv! }, "pw", "salt")).toMatchObject({ host: "http://x", backupHosts: ["http://b1", "http://b2"] });
  });
});

describe("a source whose provider moved", () => {
  it("sends the server it connects to, and the address its history is matched by", async () => {
    const db = seed();
    const moved = async () => ({ baseUrl: "http://new-host", username: "u", password: "p" });
    const push = await collectLocalChanges(db, 0, "pw", "salt", moved);
    const row = push.sources.find((source) => source.remoteKey === "key-s1")!;
    expect(await decryptCredentials({ blob: row.credentialsBlob!, iv: row.credentialsIv! }, "pw", "salt")).toMatchObject({ host: "http://new-host", keyHost: "http://x" });
  });
});

describe("importEpg's horizon", () => {
  it("fills every copy of a channel, and channels the guide only knows by name", async () => {
    const db = seed();
    db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name) VALUES ('s1:c', 's1', 'c', 'UK')").run();
    const channel = db.prepare("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, tvg_id, first_seen_at, last_seen_at) VALUES (?, 's1', 's1:c', ?, ?, ?, 1, 1)");
    channel.run("hd", "BBC One HD", "UK: BBC ONE HD", "bbc1.uk");
    channel.run("fhd", "BBC One FHD", "UK: BBC ONE FHD", "bbc1.uk");
    channel.run("itv", "ITV 1", "UK: ITV 1 HD", "provider.itv");
    const hour = 60 * 60 * 1000;
    const now = Date.now();
    const programme = (id: string, title: string) => `<programme channel="${id}" start="${stamp(now)}" stop="${stamp(now + hour)}"><title>${title}</title></programme>`;
    const xml = `<tv><channel id="bbc1.uk"><display-name>BBC One</display-name></channel><channel id="ITV1.uk"><display-name>ITV 1</display-name></channel>${programme("bbc1.uk", "News")}${programme("ITV1.uk", "Quiz")}</tv>`;
    const result = await importEpg(db, "s1", streamOf(xml), { horizonMs: 36 * hour });
    expect(result.channels).toBe(3);
    expect(db.prepare("SELECT channel_id AS id, title FROM programmes ORDER BY channel_id").all()).toEqual([
      { id: "fhd", title: "News" },
      { id: "hd", title: "News" },
      { id: "itv", title: "Quiz" },
    ]);
  });

  it("keeps only listings starting within it", async () => {
    const db = seed();
    db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name) VALUES ('s1:c', 's1', 'c', 'News')").run();
    db.prepare("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, tvg_id, first_seen_at, last_seen_at) VALUES ('ch1', 's1', 's1:c', 'News', 'News', 'news.uk', 1, 1)").run();
    const hour = 60 * 60 * 1000;
    const now = Date.now();
    const programme = (start: number, title: string) => `<programme channel="news.uk" start="${stamp(start)}" stop="${stamp(start + hour)}"><title>${title}</title></programme>`;
    const xml = `<tv>${programme(now - hour / 2, "Now")}${programme(now + 3 * hour, "Later")}${programme(now + 72 * hour, "Too far")}</tv>`;
    const result = await importEpg(db, "s1", streamOf(xml), { horizonMs: 36 * hour });
    expect(result.programmes).toBe(2);
    expect((db.prepare("SELECT title FROM programmes ORDER BY start_at").all() as { title: string }[]).map((row) => row.title)).toEqual(["Now", "Later"]);
  });
});
