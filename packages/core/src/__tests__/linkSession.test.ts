import { describe, expect, it } from "vitest";
import { deriveLinkLookup, sealLinkSecrets } from "../sync/linkCrypto.js";
import { LinkExpiredError, startLinkSession } from "../sync/linkSession.js";

/** A stand-in for the Worker's link routes, holding one session in memory. */
function fakeServer() {
  const state: { lookup?: string; salt?: string; sealed?: { blob: string; iv: string }; polls: number } = { polls: 0 };
  const fetchFake = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/link/start") {
      const body = JSON.parse(String(init?.body)) as { lookup: string; salt: string };
      state.lookup = body.lookup;
      state.salt = body.salt;
      return new Response(JSON.stringify({ expiresAt: 9_000_000_000_000_000 }), { status: 200 });
    }
    if (path === "/link/poll") {
      state.polls += 1;
      if (state.sealed === undefined) return new Response(JSON.stringify({ status: "waiting" }), { status: 200 });
      return new Response(JSON.stringify({ status: "ready", ...state.sealed }), { status: 200 });
    }
    return new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  return { state, fetchFake };
}

const noSleep = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe("the TV's link session", () => {
  it("registers a lookup that is not the code, then opens what the page sealed", async () => {
    const { state, fetchFake } = fakeServer();
    const session = await startLinkSession("https://x.test", { fetch: fetchFake, sleep: noSleep });
    expect(state.lookup).toBe(await deriveLinkLookup(session.code));
    expect(state.lookup).not.toContain(session.code);

    const waiting = session.waitForApproval(new AbortController().signal);
    // The person answers on the page after a couple of polls.
    setTimeout(async () => {
      state.sealed = await sealLinkSecrets({ email: "a@b.co", password: "pw" }, session.code, state.salt!);
    }, 20);
    expect(await waiting).toEqual({ email: "a@b.co", password: "pw" });
    expect(state.polls).toBeGreaterThan(0);
  });

  it("ends with LinkExpiredError when the server forgets the code", async () => {
    const fetchFake = (async (url: string) => {
      if (new URL(url).pathname === "/link/start") return new Response(JSON.stringify({ expiresAt: 1_000_000 }), { status: 200 });
      return new Response("gone", { status: 404 });
    }) as unknown as typeof fetch;
    const session = await startLinkSession("https://x.test", { fetch: fetchFake, sleep: noSleep });
    await expect(session.waitForApproval(new AbortController().signal)).rejects.toBeInstanceOf(LinkExpiredError);
  });

  it("ends with LinkExpiredError when the clock passes the expiry, even with the network down", async () => {
    let calls = 0;
    const fetchFake = (async (url: string) => {
      if (new URL(url).pathname === "/link/start") return new Response(JSON.stringify({ expiresAt: 100 }), { status: 200 });
      calls += 1;
      throw new Error("offline");
    }) as unknown as typeof fetch;
    let clock = 0;
    const session = await startLinkSession("https://x.test", { fetch: fetchFake, sleep: async () => void (clock += 60), now: () => clock });
    await expect(session.waitForApproval(new AbortController().signal)).rejects.toBeInstanceOf(LinkExpiredError);
    expect(calls).toBeGreaterThan(1);
  });

  it("stops when cancelled", async () => {
    const { fetchFake } = fakeServer();
    const controller = new AbortController();
    const session = await startLinkSession("https://x.test", { fetch: fetchFake });
    const waiting = session.waitForApproval(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports a server that will not start the session", async () => {
    const fetchFake = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(startLinkSession("https://x.test", { fetch: fetchFake })).rejects.toThrow("Could not reach");
  });
});
