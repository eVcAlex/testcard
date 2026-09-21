import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { handleLinkApprove, handleLinkPage, handleLinkPoll, handleLinkSession, handleLinkStart } from "../src/routes/link.js";
import type { Env } from "../src/index.js";

function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.get("/link", handleLinkPage);
  a.post("/link/start", handleLinkStart);
  a.get("/link/session", handleLinkSession);
  a.post("/link/approve", handleLinkApprove);
  a.get("/link/poll", handleLinkPoll);
  return a;
}

let counter = 0;
/** A lookup value in the shape the real one has: base64 of 32 bytes. */
const freshLookup = () => btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => (i * 7 + ++counter) % 256)));
const SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const BLOB = "c2VhbGVkLXBheWxvYWQtZm9yLXRoZS10dg==";
const IV = "AAAAAAAAAAAAAAAA";

const post = (a: ReturnType<typeof app>, path: string, body: unknown) =>
  a.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
const get = (a: ReturnType<typeof app>, path: string) => a.request(path, {}, env);
const q = (lookup: string) => `?lookup=${encodeURIComponent(lookup)}`;

describe("signing a TV in with a code", () => {
  it("registers, hands out the salt, takes the sealed sign-in and gives it to the TV once", async () => {
    const a = app();
    const lookup = freshLookup();
    expect((await post(a, "/link/start", { lookup, salt: SALT })).status).toBe(200);
    expect(await (await get(a, `/link/session${q(lookup)}`)).json()).toEqual({ salt: SALT });
    expect(await (await get(a, `/link/poll${q(lookup)}`)).json()).toEqual({ status: "waiting" });

    expect((await post(a, "/link/approve", { lookup, blob: BLOB, iv: IV })).status).toBe(200);
    expect(await (await get(a, `/link/poll${q(lookup)}`)).json()).toEqual({ status: "ready", blob: BLOB, iv: IV });

    // Collected: gone.
    expect((await get(a, `/link/poll${q(lookup)}`)).status).toBe(404);
    expect((await get(a, `/link/session${q(lookup)}`)).status).toBe(404);
  });

  it("does not register a code that is already live", async () => {
    const a = app();
    const lookup = freshLookup();
    await post(a, "/link/start", { lookup, salt: SALT });
    expect((await post(a, "/link/start", { lookup, salt: SALT })).status).toBe(409);
  });

  it("takes a sign-in only once per code", async () => {
    const a = app();
    const lookup = freshLookup();
    await post(a, "/link/start", { lookup, salt: SALT });
    expect((await post(a, "/link/approve", { lookup, blob: BLOB, iv: IV })).status).toBe(200);
    expect((await post(a, "/link/approve", { lookup, blob: BLOB, iv: IV })).status).toBe(404);
    // Once approved, the code no longer offers its salt to a second page.
    expect((await get(a, `/link/session${q(lookup)}`)).status).toBe(404);
  });

  it("does not know a code that was never registered", async () => {
    const a = app();
    const lookup = freshLookup();
    expect((await get(a, `/link/session${q(lookup)}`)).status).toBe(404);
    expect((await get(a, `/link/poll${q(lookup)}`)).status).toBe(404);
    expect((await post(a, "/link/approve", { lookup, blob: BLOB, iv: IV })).status).toBe(404);
  });

  it("forgets a code after ten minutes", async () => {
    const a = app();
    const lookup = freshLookup();
    await post(a, "/link/start", { lookup, salt: SALT });
    await env.DB.prepare(`UPDATE link_sessions SET expires_at = ? WHERE lookup = ?`).bind(Date.now() - 1, lookup).run();
    expect((await get(a, `/link/session${q(lookup)}`)).status).toBe(404);
    expect((await post(a, "/link/approve", { lookup, blob: BLOB, iv: IV })).status).toBe(404);
    expect((await get(a, `/link/poll${q(lookup)}`)).status).toBe(404);
    // An expired row does not block the same value being registered again.
    expect((await post(a, "/link/start", { lookup, salt: SALT })).status).toBe(200);
  });

  it("refuses malformed or oversized input", async () => {
    const a = app();
    expect((await post(a, "/link/start", { lookup: "short", salt: SALT })).status).toBe(400);
    expect((await post(a, "/link/start", { lookup: freshLookup(), salt: "not base64!!" })).status).toBe(400);
    expect((await post(a, "/link/approve", { lookup: freshLookup(), blob: "A".repeat(5000), iv: IV })).status).toBe(400);
    expect((await get(a, "/link/session?lookup=%00")).status).toBe(400);
    const raw = await a.request("/link/start", { method: "POST", body: "{nope" }, env);
    expect(raw.status).toBe(400);
  });

  it("serves the page without letting it be cached or framed", async () => {
    const res = await get(app(), "/link");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await res.text();
    expect(html).toContain("Link your TV");
    expect(html).not.toMatch(/https?:\/\//);
  });
});
