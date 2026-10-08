import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { handleWaitlist, MAX_PER_IP_PER_DAY } from "../src/routes/waitlist.js";
import type { Env } from "../src/index.js";

function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.post("/waitlist", handleWaitlist);
  return a;
}

let n = 0;
/** A distinct caller per test, so rate limits never leak between them. */
const freshIp = () => `203.0.113.${++n}`;

function send(body: unknown, init: { ip?: string; headers?: Record<string, string>; raw?: string } = {}) {
  return app().request(
    "https://testcard.test/waitlist",
    {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": init.ip ?? freshIp(), ...init.headers },
      body: init.raw ?? JSON.stringify(body),
    },
    env,
  );
}

const rows = () => env.DB.prepare(`SELECT email, windows, firetv, created_at FROM waitlist ORDER BY id`).all<{ email: string; windows: number; firetv: number; created_at: string }>();
const count = async () => (await rows()).results.length;

afterEach(() => vi.restoreAllMocks());

describe("POST /waitlist", () => {
  it("counts every address in an IPv6 /64 as one caller, however it is written", async () => {
    const forms = ["2001:db8:1:2::1", "2001:db8:1:2:0:0:0:9", "2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::ffff", "2001:0db8:1:2::5"];
    // db8 vs 0db8 is a different string but the same group; only the /64 prefix matters.
    for (const [i, ip] of forms.slice(0, MAX_PER_IP_PER_DAY).entries()) expect((await send({ email: `v6${i}@example.com` }, { ip })).status).toBe(200);
    expect((await send({ email: "v6x@example.com" }, { ip: "2001:db8:1:2::abcd" })).status).toBe(429);
    expect((await send({ email: "v6y@example.com" }, { ip: "2001:db8:1:3::1" })).status).toBe(200);
  });

  it("rejects addresses that could never receive an invitation", async () => {
    for (const email of ["john..doe@gmail.com", ".a@example.com", "a.@example.com", "x@1.2", "a@example.c"]) {
      expect((await send({ email })).status, email).toBe(400);
    }
  });

  it("keys an IPv4-mapped IPv6 address on its IPv4 part, not on one shared bucket", async () => {
    for (let i = 0; i < MAX_PER_IP_PER_DAY; i++) expect((await send({ email: `m${i}@example.com` }, { ip: "::ffff:198.51.100.7" })).status).toBe(200);
    expect((await send({ email: "mx@example.com" }, { ip: "::ffff:198.51.100.7" })).status).toBe(429);
    expect((await send({ email: "my@example.com" }, { ip: "::ffff:198.51.100.8" })).status).toBe(200);
  });

  it("stores a valid signup, normalised, and never echoes the email", async () => {
    const res = await send({ email: "  Alice@Example.COM ", windows: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const stored = (await rows()).results.find((r) => r.email === "alice@example.com");
    expect(stored).toMatchObject({ windows: 1, firetv: 0 });
    expect(Number.isNaN(Date.parse(stored!.created_at))).toBe(false);
  });

  it("answers a duplicate exactly like a new signup and keeps one row", async () => {
    const first = await send({ email: "dupe@example.com" });
    const before = await count();
    const second = await send({ email: "DUPE@example.com", firetv: true });
    expect(second.status).toBe(first.status);
    expect(await second.json()).toEqual(await first.json());
    expect(await count()).toBe(before);
  });

  it("returns 200 and stores nothing when the honeypot is filled", async () => {
    const before = await count();
    const res = await send({ email: "bot@example.com", hp_note: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await count()).toBe(before);
  });

  it.each([
    ["missing", {}],
    ["empty", { email: "" }],
    ["no at", { email: "alice.example.com" }],
    ["no domain dot", { email: "a@localhost" }],
    ["spaces inside", { email: "a b@example.com" }],
    ["two ats", { email: "a@@example.com" }],
    ["leading dash label", { email: "a@-example.com" }],
    ["angle brackets", { email: "<a>@example.com" }],
    ["newline", { email: "a@example.com\nbcc:x@y.com" }],
    ["not a string", { email: 5 }],
    ["too long", { email: `${"a".repeat(60)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(60)}.com` }],
    ["bad flag type", { email: "ok@example.com", windows: "yes" }],
  ])("rejects an invalid email: %s", async (_name, body) => {
    const before = await count();
    const res = await send(body);
    expect(res.status).toBe(400);
    expect(await count()).toBe(before);
  });

  it("rejects malformed JSON", async () => {
    expect((await send(null, { raw: "{nope" })).status).toBe(400);
  });

  it("rejects an oversized body", async () => {
    const before = await count();
    const res = await send({ email: "big@example.com", hp_note: "x".repeat(5000) });
    expect(res.status).toBe(413);
    expect(await count()).toBe(before);
  });

  it("rejects other content types", async () => {
    const res = await send(null, { headers: { "content-type": "text/plain" }, raw: JSON.stringify({ email: "t@example.com" }) });
    expect(res.status).toBe(415);
    const form = await send(null, { headers: { "content-type": "application/x-www-form-urlencoded" }, raw: "email=t%40example.com" });
    expect(form.status).toBe(415);
  });

  it("rejects a cross-origin request and accepts the same origin", async () => {
    const before = await count();
    const cross = await send({ email: "x@example.com" }, { headers: { origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
    expect(cross.headers.get("access-control-allow-origin")).toBeNull();
    expect(await count()).toBe(before);
    expect((await send({ email: "same@example.com" }, { headers: { origin: "https://testcard.test" } })).status).toBe(200);
  });

  it("limits each caller per day and leaves other callers alone", async () => {
    const ip = freshIp();
    for (let i = 0; i < MAX_PER_IP_PER_DAY; i++) expect((await send({ email: `rl${i}@example.com` }, { ip })).status).toBe(200);
    const blocked = await send({ email: "rl-extra@example.com" }, { ip });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("cache-control")).toBe("no-store");
    expect(typeof ((await blocked.json()) as { error: string }).error).toBe("string");
    expect((await rows()).results.some((r) => r.email === "rl-extra@example.com")).toBe(false);
    expect((await send({ email: "other-caller@example.com" })).status).toBe(200);
  });

  it("stores only a hash of the IP and prunes earlier days", async () => {
    const ip = freshIp();
    await env.DB.prepare(`INSERT INTO waitlist_rate (ip_hash, day, count) VALUES ('old', '2000-01-01', 3)`).run();
    await send({ email: "hash@example.com" }, { ip });
    const all = await env.DB.prepare(`SELECT ip_hash, day FROM waitlist_rate`).all<{ ip_hash: string; day: string }>();
    expect(all.results.some((r) => r.day === "2000-01-01")).toBe(false);
    expect(all.results.length).toBeGreaterThan(0);
    for (const r of all.results) {
      expect(r.ip_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.ip_hash).not.toContain(ip);
    }
  });

  it("never logs a raw IP or an email", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const ip = "198.51.100.77";
    await send({ email: "private.person@example.com" }, { ip });
    await send({ email: "private.person@example.com" }, { ip });
    await send({ email: "not an email private.person" }, { ip });
    await send({ email: "bot@example.com", hp_note: "x" }, { ip });
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain(ip);
    expect(logged).not.toContain("private.person");
  });
});
