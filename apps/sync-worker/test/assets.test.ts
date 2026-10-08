import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("the site and the API share one Worker", () => {
  it("serves the built home page", async () => {
    const res = await SELF.fetch("https://example.com/", { headers: { "sec-fetch-mode": "navigate", accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it("answers an unknown path with a real 404, not the SPA shell", async () => {
    for (const path of ["/no-such-page", "/link-nope/deeper"]) {
      const res = await SELF.fetch(`https://example.com${path}`, { headers: { "sec-fetch-mode": "navigate", accept: "text/html" } });
      expect(res.status).toBe(404);
      // The real 404.html is a prerendered React page, so it has a root; what marks it is the standby copy.
      expect(await res.text()).toContain("No signal");
    }
  });

  it("sends the unframed headers on the home page", async () => {
    const home = await SELF.fetch("https://example.com/", { headers: { "sec-fetch-mode": "navigate", accept: "text/html" } });
    expect(home.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it.each([
    ["GET", "/sync/pull"], ["POST", "/sync/push"], ["GET", "/sync/salt"], ["POST", "/sync/salt"],
    ["POST", "/guides/register"], ["GET", "/link/session"], ["GET", "/link/poll"], ["POST", "/link/start"],
    ["POST", "/link/approve"], ["POST", "/waitlist"], ["GET", "/waitlist"], ["GET", "/auth/get-session"], ["GET", "/app/x.apk"],
  ])("%s %s reaches the Worker, not the SPA shell", async (method, path) => {
    const res = await SELF.fetch(`https://example.com${path}`, { method, headers: { "sec-fetch-mode": "navigate", accept: "text/html" } });
    expect(await res.text()).not.toContain('<div id="root">');
  });

  it("a browser navigation to a release file reaches the Worker, not the SPA", async () => {
    const res = await SELF.fetch("https://example.com/app/missing.apk", { headers: { "sec-fetch-mode": "navigate", accept: "text/html" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("POST /waitlist reaches the Worker and is answered as JSON", async () => {
    const res = await SELF.fetch("https://example.com/waitlist", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    expect(res.status).toBe(415);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("API paths still reach the Worker", async () => {
    expect((await SELF.fetch("https://example.com/sync/pull")).status).toBe(401);
  });
});
