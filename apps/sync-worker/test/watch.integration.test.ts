import { afterEach, describe, expect, it, vi } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import app from "../src/index.js";

/** The real app, signed in by a real sign-up: the stream proxy must know who is asking, by the session cookie a media element sends. */
const ORIGIN = "https://sync.test";
const base = env as unknown as { DB: D1Database; SYNC_AUTH_SECRET: string };
const call = (path: string, init?: RequestInit, bindings: Record<string, string> = { WEB_PLAYER: "on" }) =>
  app.fetch(new Request(`${ORIGIN}${path}`, init), { ...base, ...bindings } as never, createExecutionContext());

async function signedInCookie(): Promise<string> {
  const response = await call("/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email: `watch-${crypto.randomUUID()}@example.com`, password: "correct-horse-battery-staple", name: "w" }),
  });
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

afterEach(() => vi.restoreAllMocks());

describe("GET /watch/p in the real app", () => {
  const target = `/watch/p?u=${encodeURIComponent("http://provider.example/film.mp4")}`;

  it("turns away a caller who is not signed in, and never fetches for them", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect((await call(target)).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("streams for a signed-in caller by their session cookie", async () => {
    const cookie = await signedInCookie();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("film", { headers: { "content-type": "video/mp4" } }));
    const response = await call(target, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("film");
    expect(response.headers.get("content-type")).toBe("video/mp4");
  });

  it("does not forward the viewer's cookie to the provider", async () => {
    const cookie = await signedInCookie();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x"));
    await call(target, { headers: { cookie } });
    const sent = new Headers(((spy.mock.calls[0] as unknown[])[1] as RequestInit).headers);
    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("authorization")).toBeNull();
  });

  it("is off until WEB_PLAYER is on, even for a signed-in caller", async () => {
    const cookie = await signedInCookie();
    expect((await call(target, { headers: { cookie } }, { WEB_PLAYER: "off" })).status).toBe(404);
  });
});
