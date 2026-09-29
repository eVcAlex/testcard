import { describe, expect, it } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { guideFileName } from "@testcard/sync-schema";
import { handleRegisterGuide } from "../src/routes/guides.js";
import { handleRelease } from "../src/routes/release.js";
import type { Env } from "../src/index.js";

function testApp() {
  const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>();
  app.use("*", async (c, next) => {
    c.set("userId", "test-user");
    await next();
  });
  app.post("/guides/register", handleRegisterGuide);
  return app;
}

const register = (url: string) =>
  testApp().request("/guides/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }, env, createExecutionContext());

describe("POST /guides/register", () => {
  it("lists a public guide once, whoever asks, and answers with its file name", async () => {
    const url = "https://example.com/epg.xml.gz";
    const first = await register(url);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ file: await guideFileName(url) });
    await register(url);
    const rows = await env.DB.prepare(`SELECT url FROM guide_sources WHERE url = ?`).bind(url).all();
    expect(rows.results).toHaveLength(1);
  });

  it("refuses an address with a login in it, and lists nothing for it", async () => {
    const url = "https://example.com/xmltv.php?username=a&password=b";
    expect((await register(url)).status).toBe(400);
    const rows = await env.DB.prepare(`SELECT url FROM guide_sources WHERE url = ?`).bind(url).all();
    expect(rows.results).toHaveLength(0);
  });
});

describe("serving a gzipped guide file", () => {
  it("passes the bucket's content encoding on to the device", async () => {
    const object = { body: new Uint8Array([31, 139, 8]), size: 3, httpEtag: '"x"', httpMetadata: { contentEncoding: "gzip" } };
    const app = new Hono<{ Bindings: Env }>();
    app.get("/app/:file", handleRelease);
    const response = await app.request("/app/guide-abc.json", {}, { RELEASES: { get: async () => object } } as unknown as Env, createExecutionContext());
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("content-type")).toBe("application/json");
  });
});
