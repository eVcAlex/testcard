import { afterEach, describe, expect, it, vi } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { handleWatchProxy, isPrivateHost, refusal, rewritePlaylist } from "../src/routes/watch.js";
import type { Env } from "../src/index.js";

function app() {
  const hono = new Hono<{ Bindings: Env; Variables: { userId: string } }>();
  hono.use("*", async (c, next) => {
    c.set("userId", "test-user");
    await next();
  });
  hono.on(["GET", "HEAD"], "/watch/p", handleWatchProxy);
  return hono;
}

const ask = (target: string, bindings: Partial<Env> = { WEB_PLAYER: "on" }, headers: Record<string, string> = {}) =>
  app().request(`/watch/p?u=${encodeURIComponent(target)}`, { headers }, { ...env, ...bindings } as Env, createExecutionContext());

afterEach(() => vi.restoreAllMocks());

describe("which addresses are fetched", () => {
  it("knows private hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "[::1]", "fd00::1", "fe80::1", "box.local"]) expect(isPrivateHost(host), host).toBe(true);
    for (const host of ["example.com", "8.8.8.8", "172.32.0.1", "172.15.0.1"]) expect(isPrivateHost(host), host).toBe(false);
  });

  it("refuses other schemes, logins in the address, and this service itself", () => {
    expect(refusal(new URL("file:///etc/passwd"), false)).toMatch(/http/);
    expect(refusal(new URL("http://user:pw@example.com/"), false)).toMatch(/credentials/);
    expect(refusal(new URL("https://evicted.dev/auth/session"), false)).not.toBeNull();
    expect(refusal(new URL("https://testcard-sync.evcalex.workers.dev/sync/pull"), false)).not.toBeNull();
    expect(refusal(new URL("http://provider.example:8080/live/a/b/1.m3u8"), false)).toBeNull();
  });
});

describe("rewritePlaylist", () => {
  it("sends segments, keys and absolute addresses back through the proxy", () => {
    const out = rewritePlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nseg/1.ts\nhttp://o.example/2.ts', new URL("http://p.example/live/a.m3u8"), "/watch/p").split("\n");
    expect(out[1]).toBe(`#EXT-X-MAP:URI="/watch/p?u=${encodeURIComponent("http://p.example/live/init.mp4")}"`);
    expect(out[2]).toBe(`/watch/p?u=${encodeURIComponent("http://p.example/live/seg/1.ts")}`);
    expect(out[3]).toBe(`/watch/p?u=${encodeURIComponent("http://o.example/2.ts")}`);
  });
});

describe("GET /watch/p", () => {
  it("is not there unless switched on", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect((await ask("http://p.example/a.m3u8", {})).status).toBe(404);
    expect((await ask("http://p.example/a.m3u8", { WEB_PLAYER: "off" })).status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses private addresses without fetching them", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect((await ask("http://127.0.0.1:8080/x")).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("follows a redirect, checking where it goes, and serves a rewritten playlist", async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      seen.push(url);
      if (url === "http://p.example/old") return new Response(null, { status: 302, headers: { location: "/live/1.m3u8" } });
      return new Response("#EXTM3U\n#EXTINF:6,\nseg1.ts\n", { headers: { "content-type": "application/vnd.apple.mpegurl" } });
    });
    const response = await ask("http://p.example/old");
    expect(response.status).toBe(200);
    expect(seen).toEqual(["http://p.example/old", "http://p.example/live/1.m3u8"]);
    expect(await response.text()).toContain("/watch/p?u=http%3A%2F%2Fp.example%2Flive%2Fseg1.ts");
  });

  it("will not follow a redirect onto a private address", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }));
    expect((await ask("http://p.example/x")).status).toBe(400);
  });

  it("passes a Range request through and returns the partial body", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("2345", { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 2-5/10" } }));
    const response = await ask("http://p.example/film.mp4", { WEB_PLAYER: "on" }, { range: "bytes=2-5" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await response.text()).toBe("2345");
    expect(new Headers(((spy.mock.calls[0] as unknown[])[1] as RequestInit).headers).get("range")).toBe("bytes=2-5");
  });

  it("explains a provider it cannot reach", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network connection lost."));
    const response = await ask("http://p.example:8080/x");
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "could not reach the provider", host: "p.example:8080" });
  });
});

describe("daily allowance", () => {
  const withCap = { WEB_PLAYER: "on", WATCH_DAILY_CAP_MB: "1" } as Partial<Env>;

  it("counts what streamed and turns the account away once the day's allowance is used", async () => {
    await env.DB.prepare(`DELETE FROM watch_usage WHERE user_id = 'test-user'`).run();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(700 * 1024), { headers: { "content-type": "video/mp4" } }));
    for (const expected of [200, 200]) {
      const response = await ask("http://provider.example/film.mp4", withCap);
      expect(response.status).toBe(expected);
      await response.arrayBuffer();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const refused = await ask("http://provider.example/film.mp4", withCap);
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: string }).error).toBe("daily limit reached");
  });

  it("is off when no cap is set", async () => {
    await env.DB.prepare(`DELETE FROM watch_usage WHERE user_id = 'test-user'`).run();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(2 * 1024 * 1024)));
    for (let i = 0; i < 3; i += 1) expect((await ask("http://provider.example/film.mp4", { WEB_PLAYER: "on", WATCH_DAILY_CAP_MB: "0" })).status).toBe(200);
  });
});
