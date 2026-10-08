import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMessage, errorStatus, joinWaitlist, signUp } from "./api.ts";

const stub = (f: () => Promise<Response>) => vi.stubGlobal("fetch", vi.fn(f));
const caught = (p: Promise<unknown>) => p.then(() => { throw new Error("expected rejection"); }, (e) => e);

afterEach(() => vi.unstubAllGlobals());

describe("api errors (real wretch)", () => {
  it("reads status and the better-auth message from a JSON error body", async () => {
    stub(async () => new Response(JSON.stringify({ message: "Password too weak" }), { status: 400, headers: { "content-type": "application/json" } }));
    const e = await caught(signUp("a@b.co", "x"));
    expect(errorStatus(e)).toBe(400);
    expect(errorMessage(e)).toBe("Password too weak");
  });

  it("a non-JSON error body gives a status and no message", async () => {
    stub(async () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
    const e = await caught(signUp("a@b.co", "x"));
    expect(errorStatus(e)).toBe(502);
    expect(errorMessage(e)).toBeUndefined();
  });

  it("a network failure has no status", async () => {
    stub(async () => { throw new TypeError("Failed to fetch"); });
    const e = await caught(signUp("a@b.co", "x"));
    expect(errorStatus(e)).toBeUndefined();
  });
});

describe("joinWaitlist", () => {
  it("POSTs the JSON body to /waitlist", async () => {
    const f = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", f);
    const res = await joinWaitlist({ email: "a@b.co", windows: true });
    expect(res.status).toBe(200);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/waitlist");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.co", windows: true });
  });
});
