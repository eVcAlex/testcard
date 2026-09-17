import { describe, expect, it } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { handlePull } from "../src/routes/pull.js";
import { handlePush } from "../src/routes/push.js";
import type { Env } from "../src/index.js";

function testApp() {
  const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>();
  app.use("*", async (c, next) => {
    c.set("userId", "test-user");
    await next();
  });
  app.get("/sync/pull", handlePull);
  app.post("/sync/push", handlePush);
  return app;
}

describe("POST /sync/push then GET /sync/pull", () => {
  it("round-trips a favourite and a progress row", async () => {
    const app = testApp();
    const ctx = createExecutionContext();

    const pushRes = await app.request(
      "/sync/push",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: [],
          movieFavourites: [{ remoteKey: "movie-abc", addedAt: 1000, updatedAt: 1000, deletedAt: null }],
          movieRecents: [],
          seriesFavourites: [],
          seriesRecents: [],
          progress: [
            { remoteKey: "movie-abc", itemType: "movie", positionSecs: 300, durationSecs: 7200, watched: false, updatedAt: 1000, deletedAt: null },
          ],
        }),
      },
      env,
      ctx,
    );
    expect(pushRes.status).toBe(200);
    // The cursor is the max client-authored updatedAt of what was pushed, never server wall-clock.
    expect((await pushRes.json()).newCursor).toBe(1000);

    const pullRes = await app.request("/sync/pull?since=0", {}, env, ctx);
    expect(pullRes.status).toBe(200);
    const pulled = await pullRes.json();
    expect(pulled.movieFavourites).toHaveLength(1);
    expect(pulled.movieFavourites[0].remoteKey).toBe("movie-abc");
    expect(pulled.progress).toHaveLength(1);
    expect(pulled.progress[0].positionSecs).toBe(300);
    // Likewise on the way back: max updatedAt of the returned rows, not Date.now().
    expect(pulled.serverCursor).toBe(1000);
  });

  it("derives cursors from client-authored updatedAt, never server wall-clock", async () => {
    const app = testApp();
    const ctx = createExecutionContext();
    const before = Date.now();

    // All timestamps are deliberately far in the past. A wall-clock cursor would come back as
    // roughly Date.now() and skip any row written between the SELECT and the response.
    const pushRes = await app.request(
      "/sync/push",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: [],
          movieFavourites: [{ remoteKey: "cursor-a", addedAt: 100, updatedAt: 100, deletedAt: null }],
          movieRecents: [{ remoteKey: "cursor-b", playedAt: 900, updatedAt: 900, deletedAt: null }],
          seriesFavourites: [],
          seriesRecents: [{ remoteKey: "cursor-c", playedAt: 400, updatedAt: 400, deletedAt: null }],
          progress: [],
        }),
      },
      env,
      ctx,
    );
    expect(pushRes.status).toBe(200);
    const { newCursor } = await pushRes.json();
    expect(newCursor).toBe(900); // max across all six arrays
    expect(newCursor).toBeLessThan(before);

    // An empty push must not advance the cursor either.
    const emptyPushRes = await app.request(
      "/sync/push",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: [], movieFavourites: [], movieRecents: [], seriesFavourites: [], seriesRecents: [], progress: [] }),
      },
      env,
      ctx,
    );
    expect((await emptyPushRes.json()).newCursor).toBe(0);

    // A pull that returns rows reports their high-water mark...
    const pulled = await (await app.request("/sync/pull?since=0", {}, env, ctx)).json();
    expect(pulled.serverCursor).toBe(900);
    expect(pulled.serverCursor).toBeLessThan(before);

    // ...and a pull that returns nothing leaves `since` exactly where it was, so a client's stored
    // cursor never drifts forward past rows it has not seen.
    const emptyPull = await (await app.request("/sync/pull?since=900", {}, env, ctx)).json();
    expect(emptyPull.movieRecents).toHaveLength(0);
    expect(emptyPull.serverCursor).toBe(900);
  });

  it("rejects a malformed `since` with 400 rather than silently returning nothing", async () => {
    const app = testApp();
    const ctx = createExecutionContext();
    const res = await app.request("/sync/pull?since=abc", {}, env, ctx);
    expect(res.status).toBe(400);
  });

  it("does not overwrite a newer row with an older push (last-write-wins)", async () => {
    const app = testApp();
    const ctx = createExecutionContext();

    await app.request(
      "/sync/push",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: [],
          movieFavourites: [],
          movieRecents: [],
          seriesFavourites: [],
          seriesRecents: [],
          progress: [{ remoteKey: "movie-xyz", itemType: "movie", positionSecs: 500, durationSecs: 7200, watched: false, updatedAt: 2000, deletedAt: null }],
        }),
      },
      env,
      ctx,
    );
    await app.request(
      "/sync/push",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: [],
          movieFavourites: [],
          movieRecents: [],
          seriesFavourites: [],
          seriesRecents: [],
          progress: [{ remoteKey: "movie-xyz", itemType: "movie", positionSecs: 100, durationSecs: 7200, watched: false, updatedAt: 1000, deletedAt: null }],
        }),
      },
      env,
      ctx,
    );

    const pullRes = await app.request("/sync/pull?since=0", {}, env, ctx);
    const pulled = await pullRes.json();
    const row = pulled.progress.find((p: { remoteKey: string }) => p.remoteKey === "movie-xyz");
    expect(row.positionSecs).toBe(500); // the older (stale) push must not have won
  });
});
