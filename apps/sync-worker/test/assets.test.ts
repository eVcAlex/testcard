import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("the site and the API share one Worker", () => {
  it("serves the SPA shell for the home page and for client routes", async () => {
    for (const path of ["/", "/link", "/download"]) {
      const res = await SELF.fetch(`https://example.com${path}`, { headers: { "sec-fetch-mode": "navigate", accept: "text/html" } });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<div id="root">');
    }
  });

  it("sends the link page headers that keep it uncached and unframed", async () => {
    const res = await SELF.fetch("https://example.com/link", { headers: { "sec-fetch-mode": "navigate", accept: "text/html" } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("a browser navigation to a release file reaches the Worker, not the SPA", async () => {
    const res = await SELF.fetch("https://example.com/app/missing.apk", { headers: { "sec-fetch-mode": "navigate", accept: "text/html" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("API paths still reach the Worker", async () => {
    expect((await SELF.fetch("https://example.com/sync/pull")).status).toBe(401);
  });
});
