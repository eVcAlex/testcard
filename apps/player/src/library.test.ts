import { describe, expect, it, vi } from "vitest";
import type { SyncPullResponse, SyncPushRequest } from "@testcard/sync-schema";
import { Library } from "./library.ts";

const pulled = (over: Partial<SyncPullResponse> = {}): SyncPullResponse => ({
  sources: [], movieFavourites: [], movieRecents: [], seriesFavourites: [], seriesRecents: [], progress: [], profiles: [], channelFavourites: [], channelRecents: [], serverCursor: 0, ...over,
});
const fake = () => {
  const pushes: SyncPushRequest[] = [];
  return { pushes, client: { push: vi.fn(async (request: SyncPushRequest) => (pushes.push(request), { newCursor: 1 })) } };
};

describe("Library", () => {
  it("reads Main's rows and leaves a profile's alone, and the other way round", () => {
    const rows = pulled({
      movieFavourites: [
        { remoteKey: "aaa", addedAt: 5, updatedAt: 5, deletedAt: null },
        { remoteKey: "p.kid1.bbb", addedAt: 6, updatedAt: 6, deletedAt: null },
        { remoteKey: "ccc", addedAt: 7, updatedAt: 7, deletedAt: 9 },
      ],
      progress: [{ remoteKey: "p.kid1.bbb", itemType: "movie", positionSecs: 90, durationSecs: 100, watched: false, updatedAt: 1, deletedAt: null }],
    });
    const main = new Library(fake().client, "", rows);
    expect(main.keys("movieFavs")).toEqual(["aaa"]);
    expect(main.placeOf("bbb")).toBeUndefined();
    const kid = new Library(fake().client, "p.kid1.", rows);
    expect(kid.keys("movieFavs")).toEqual(["bbb"]);
    expect(kid.placeOf("bbb")).toEqual({ position: 90, duration: 100, watched: false });
  });

  it("orders channel favourites by the viewer's own order, then newest", () => {
    const row = (remoteKey: string, addedAt: number, position: number | null) => ({ remoteKey, addedAt, position, updatedAt: addedAt, deletedAt: null });
    const library = new Library(fake().client, "", pulled({ channelFavourites: [row("a", 1, null), row("b", 2, 1), row("c", 3, 0), row("d", 9, null)] }));
    expect(library.keys("channelFavs")).toEqual(["c", "b", "d", "a"]);
  });

  it("sends a heart under the profile's prefix, and a removal as a tombstone, as one push", async () => {
    vi.useFakeTimers();
    const { client, pushes } = fake();
    let t = 100;
    const library = new Library(client, "p.kid1.", pulled(), () => (t += 1));
    library.toggleFavourite("seriesFavs", "show");
    library.toggleFavourite("channelFavs", "ch.1");
    library.toggleFavourite("channelFavs", "ch.1");
    expect(library.has("channelFavs", "ch.1")).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.seriesFavourites[0]).toMatchObject({ remoteKey: "p.kid1.show", deletedAt: null });
    const channelRows = pushes[0]?.channelFavourites ?? [];
    expect(channelRows.map((row) => row.deletedAt !== null)).toEqual([false, true]);
    vi.useRealTimers();
  });

  it("keeps a place, calls it watched past 95%, and sends the latest place once", async () => {
    const { client, pushes } = fake();
    const library = new Library(client, "", pulled());
    library.keepPlace("film", "movie", 60, 1000);
    library.keepPlace("film", "movie", 970, 1000);
    expect(library.placeOf("film")).toEqual({ position: 970, duration: 1000, watched: true });
    await library.send();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.progress).toHaveLength(1);
    expect(pushes[0]?.progress[0]).toMatchObject({ remoteKey: "film", itemType: "movie", positionSecs: 970, durationSecs: 1000, watched: true });
  });

  it("keeps what it could not send for the next try", async () => {
    const calls: SyncPushRequest[] = [];
    let down = true;
    const client = { push: async (request: SyncPushRequest) => (calls.push(request), down ? Promise.reject(new Error("offline")) : { newCursor: 1 }) };
    const library = new Library(client, "", pulled());
    library.played("movieRecents", "film");
    await library.send();
    expect(library.unsaved).toBe(true);
    down = false;
    await library.send();
    expect(library.unsaved).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.movieRecents[0]?.remoteKey).toBe("film");
  });
});
