import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson, generateSalt } from "@testcard/core/src/sync/credentialCrypto.ts";
import { remoteKeyFor } from "@testcard/core/src/sync/remoteKey.ts";
import { emptyDraft } from "@testcard/core/src/sync/sourceDraft.ts";
import { PROFILE_ID_PATTERN, type SyncProfile, type SyncPullResponse, type SyncPushRequest, type SyncSource } from "@testcard/sync-schema";
import { AccountEditor, MAX_PROFILES, newProfileId } from "./account.ts";

const PASSWORD = "correct horse";
const salt = generateSalt();

/** A server in memory: last write wins, as the Worker's push does. */
function fakeServer() {
  const sources = new Map<string, SyncSource>();
  const profiles = new Map<string, SyncProfile>();
  let clock = 0;
  const pushes: SyncPushRequest[] = [];
  const pull = async (since: number): Promise<SyncPullResponse> => ({
    sources: [...sources.values()].filter((row) => row.updatedAt > since),
    profiles: [...profiles.values()].filter((row) => row.updatedAt > since),
    movieFavourites: [], movieRecents: [], seriesFavourites: [], seriesRecents: [], progress: [], channelFavourites: [], channelRecents: [],
    serverCursor: clock,
  });
  const client = {
    pull,
    push: async (request: SyncPushRequest) => {
      pushes.push(request);
      for (const row of request.sources) if ((sources.get(row.remoteKey)?.updatedAt ?? -1) < row.updatedAt) sources.set(row.remoteKey, row);
      for (const row of request.profiles) if ((profiles.get(row.remoteKey)?.updatedAt ?? -1) < row.updatedAt) profiles.set(row.remoteKey, row);
      return { newCursor: clock };
    },
  };
  const seedSource = async (key: string, label: string, payload: object, at: number) => {
    const sealed = await encryptJson(payload, PASSWORD, salt);
    sources.set(key, { remoteKey: key, updatedAt: at, deletedAt: null, label, credentialsBlob: sealed.blob, credentialsIv: sealed.iv });
    clock = Math.max(clock, at);
  };
  const seedProfile = async (key: string, payload: object, at: number) => {
    const sealed = await encryptJson(payload, PASSWORD, salt);
    profiles.set(key, { remoteKey: key, updatedAt: at, deletedAt: null, blob: sealed.blob, iv: sealed.iv });
    clock = Math.max(clock, at);
  };
  const open = async () => AccountEditor.open(client, PASSWORD, salt, await pull(0));
  const sourcePayload = async (key: string) => {
    const row = sources.get(key) as SyncSource;
    return decryptJson({ blob: row.credentialsBlob as string, iv: row.credentialsIv as string }, PASSWORD, salt) as Promise<Record<string, unknown>>;
  };
  return { sources, profiles, pushes, client, seedSource, seedProfile, open, sourcePayload };
}

const xtream = { host: "http://old.example:8080", username: "u", password: "p", keyHost: "http://first.example", pins: [{ kind: "live", key: "7", label: "News" }], hidden: [{ kind: "channel", key: "9", label: "X" }], skips: [], position: 0, futureField: { from: "a newer app" } };
const draft = (over: Partial<ReturnType<typeof emptyDraft>>) => ({ ...emptyDraft("xtream"), name: "Home", server: "new.example:8080", username: "u", ...over });

describe("AccountEditor sources", () => {
  it("changes the login and keeps everything else on the record as it was", async () => {
    const server = fakeServer();
    await server.seedSource("k1", "Home", xtream, 10);
    const editor = await server.open();
    await editor.saveSource("k1", draft({ name: "Renamed" }));
    const sent = await server.sourcePayload("k1");
    expect(sent).toMatchObject({ host: "http://new.example:8080", username: "u", password: "p", keyHost: "http://first.example", pins: xtream.pins, hidden: xtream.hidden, futureField: xtream.futureField });
    // Fields the record never had are not invented: a device would take them as an instruction.
    for (const field of ["epgUrl", "content", "backupHosts"]) expect(sent).not.toHaveProperty(field);
    expect(server.sources.get("k1")?.label).toBe("Renamed");
    expect(server.sources.get("k1")?.updatedAt).toBeGreaterThan(10);
  });

  it("writes a field only when the form changed it", async () => {
    const server = fakeServer();
    await server.seedSource("k1", "Home", { ...xtream, epgUrl: "http://guide.example/x.xml", backupHosts: ["http://b.example"] }, 10);
    const editor = await server.open();
    const same = editor.draftOf("k1") as ReturnType<typeof emptyDraft>;
    await editor.saveSource("k1", { ...same, name: "Only a rename" });
    expect(await server.sourcePayload("k1")).toMatchObject({ epgUrl: "http://guide.example/x.xml", backupHosts: ["http://b.example"], host: "http://old.example:8080" });
    await editor.saveSource("k1", { ...same, epgUrl: "" });
    expect((await server.sourcePayload("k1")).epgUrl).toBeNull();
  });

  it("reads the account again first, so an edit made on a TV in the meantime is not written over", async () => {
    const server = fakeServer();
    await server.seedSource("k1", "Home", xtream, 10);
    const editor = await server.open();
    const pinned = [{ kind: "live", key: "1", label: "Sport" }];
    await server.seedSource("k1", "Home", { ...xtream, pins: pinned }, 50); // a TV pinned a category after the page opened
    await editor.saveSource("k1", draft({}));
    expect((await server.sourcePayload("k1")).pins).toEqual(pinned);
  });

  it("adds a source under the key a device would give it, with its first address as the history key, and refuses a repeat", async () => {
    const server = fakeServer();
    const editor = await server.open();
    const id = await editor.saveSource(undefined, draft({ password: "secret", backupUrls: "b.example" }));
    expect(id).toBe(await remoteKeyFor("http://new.example:8080", "source"));
    expect(await server.sourcePayload(id)).toMatchObject({ host: "http://new.example:8080", keyHost: "http://new.example:8080", backupHosts: ["http://b.example"], content: { live: true, movies: true, series: true } });
    expect(editor.sources().map((source) => source.id)).toEqual([id]);
    await expect(editor.saveSource(undefined, draft({ password: "secret" }))).rejects.toThrow(/already/);
  });

  it("takes a pasted Xtream link as a login", async () => {
    const server = fakeServer();
    const editor = await server.open();
    const id = await editor.saveSource(undefined, { ...emptyDraft("m3u"), name: "Pasted", playlistUrl: "http://p.example:80/get.php?username=a&password=b&type=m3u_plus" });
    expect(await server.sourcePayload(id)).toMatchObject({ username: "a", password: "b" });
  });

  it("removes with a tombstone and leaves a locked record alone", async () => {
    const server = fakeServer();
    await server.seedSource("k1", "Home", xtream, 10);
    const other = await encryptJson({ host: "http://x", username: "u", password: "p" }, "another password", salt);
    server.sources.set("k2", { remoteKey: "k2", updatedAt: 5, deletedAt: null, label: "Theirs", credentialsBlob: other.blob, credentialsIv: other.iv });
    const editor = await server.open();
    expect(editor.lockedCount()).toBe(1);
    expect(editor.sources().map((source) => source.id)).toEqual(["k1"]);
    await editor.removeSource("k1");
    await editor.removeSource("k2");
    expect(server.sources.get("k1")).toMatchObject({ deletedAt: expect.any(Number), credentialsBlob: null });
    expect(server.sources.get("k2")?.updatedAt).toBe(5);
    expect(server.pushes.flatMap((push) => push.sources.map((row) => row.remoteKey))).toEqual(["k1"]);
  });
});

describe("AccountEditor profiles", () => {
  const person = (over: object = {}) => ({ name: "Sam", colour: 2, avatar: "fox", pin: "abcd1234", position: 1, ...over });

  it("renames and recolours without touching the PIN, avatar or place", async () => {
    const server = fakeServer();
    await server.seedProfile("psam", person(), 10);
    const editor = await server.open();
    await editor.saveProfile("psam", { name: "Samantha", colour: 5 });
    const row = server.profiles.get("psam") as SyncProfile;
    expect(await decryptJson({ blob: row.blob as string, iv: row.iv as string }, PASSWORD, salt)).toEqual(person({ name: "Samantha", colour: 5 }));
  });

  it("adds a profile with a valid id, up to the limit", async () => {
    const server = fakeServer();
    const editor = await server.open();
    const ids: string[] = [];
    for (let i = 1; i < MAX_PROFILES; i++) ids.push(await editor.saveProfile(undefined, { name: `P${i}`, colour: i }));
    expect(ids.every((id) => PROFILE_ID_PATTERN.test(id))).toBe(true);
    await expect(editor.saveProfile(undefined, { name: "One too many", colour: 0 })).rejects.toThrow(/up to 4/);
    expect(editor.profiles()).toHaveLength(MAX_PROFILES);
  });

  it("removes with a tombstone, never Main", async () => {
    const server = fakeServer();
    await server.seedProfile("psam", person(), 10);
    const editor = await server.open();
    await expect(editor.removeProfile("main")).rejects.toThrow(/main/);
    await editor.removeProfile("psam");
    expect(server.profiles.get("psam")).toMatchObject({ deletedAt: expect.any(Number), blob: null, iv: null });
    expect(editor.profiles().map((profile) => profile.id)).toEqual(["main"]);
  });
});

describe("newProfileId", () => {
  it("is letters and digits only", () => {
    expect(PROFILE_ID_PATTERN.test(newProfileId())).toBe(true);
  });
});
