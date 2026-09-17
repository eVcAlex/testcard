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

    const pullRes = await app.request("/sync/pull?since=0", {}, env, ctx);
    expect(pullRes.status).toBe(200);
    const pulled = await pullRes.json();
    expect(pulled.movieFavourites).toHaveLength(1);
    expect(pulled.movieFavourites[0].remoteKey).toBe("movie-abc");
    expect(pulled.progress).toHaveLength(1);
    expect(pulled.progress[0].positionSecs).toBe(300);
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
