import { afterEach, describe, expect, it, vi } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import app from "../src/index.js";
import { capped } from "../src/routes/relay.js";

/** The list relay in the real app, signed in by a real sign-up. */
const ORIGIN = "https://sync.test";
const base = env as unknown as { DB: D1Database; SYNC_AUTH_SECRET: string };
const call = (path: string, init?: RequestInit, bindings: Record<string, string> = { LIST_RELAY: "on" }) =>
  app.fetch(new Request(`${ORIGIN}${path}`, init), { ...base, ...bindings } as never, createExecutionContext());

async function signedInCookie(): Promise<string> {
  const response = await call("/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email: `relay-${crypto.randomUUID()}@example.com`, password: "correct-horse-battery-staple", name: "r" }),
  });
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

const list = (address: string) => `/relay/list?u=${encodeURIComponent(address)}`;

afterEach(() => vi.restoreAllMocks());

describe("GET /relay/list", () => {
  it("turns away a caller who is not signed in, and never fetches for them", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect((await call(list("http://provider.example/get.php?username=u&password=p"))).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("is off until LIST_RELAY is on", async () => {
    const cookie = await signedInCookie();
    expect((await call(list("http://provider.example/get.php"), { headers: { cookie } }, { LIST_RELAY: "off" })).status).toBe(404);
  });

  it("returns the provider's list as it came, asking as `node` and without the caller's cookie", async () => {
    const cookie = await signedInCookie();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("#EXTM3U\n#EXTINF:-1,One\nhttp://p.example/1.ts\n", { headers: { "content-type": "audio/x-mpegurl" } }));
    // audio/x-mpegurl is what providers call an M3U: it must not be mistaken for an audio stream.
    const response = await call(list("http://provider.example/get.php?username=u&password=p"), { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("#EXTINF:-1,One");
    const sent = new Headers(((spy.mock.calls[0] as unknown[])[1] as RequestInit).headers);
    expect(sent.get("user-agent")).toBe("node");
    expect(sent.get("cookie")).toBeNull();
  });

  it("passes the provider's refusal on, so the app can tell blocked from broken", async () => {
    const cookie = await signedInCookie();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<h1>403</h1>", { status: 403, headers: { "content-type": "text/html" } }));
    expect((await call(list("http://provider.example/get.php"), { headers: { cookie } })).status).toBe(403);
  });

  it("will not carry video", async () => {
    const cookie = await signedInCookie();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { headers: { "content-type": "video/mp4" } }));
    expect((await call(list("http://provider.example/film.mp4"), { headers: { cookie } })).status).toBe(415);
  });

  it("refuses private addresses and addresses with a login in the userinfo", async () => {
    const cookie = await signedInCookie();
    const spy = vi.spyOn(globalThis, "fetch");
    expect((await call(list("http://192.168.1.1/get.php"), { headers: { cookie } })).status).toBe(400);
    expect((await call(list("http://u:p@provider.example/get.php"), { headers: { cookie } })).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("says the provider could not be reached when the fetch fails", async () => {
    const cookie = await signedInCookie();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));
    const response = await call(list("http://provider.example/get.php"), { headers: { cookie } });
    expect(response.status).toBe(502);
    expect((await response.json()) as { host: string }).toMatchObject({ host: "provider.example" });
  });
});

describe("capped", () => {
  const stream = (...chunks: string[]) => new ReadableStream<Uint8Array>({ start(c) { chunks.forEach((t) => c.enqueue(new TextEncoder().encode(t))); c.close(); } });

  it("passes a body under the limit through whole", async () => {
    expect(await new Response(capped(stream("ab", "cd"), 10)).text()).toBe("abcd");
  });

  it("fails the stream over the limit, rather than ending it short", async () => {
    await expect(new Response(capped(stream("abcdef", "ghijkl"), 8)).text()).rejects.toThrow("list too large");
  });
});
