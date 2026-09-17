import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncClient } from "../sync/client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("SyncClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signIn posts to /auth/sign-in/email and returns the session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user: { id: "u1" }, token: "tok" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => undefined });
    const result = await client.signIn("a@b.com", "pw");

    expect(result).toEqual({ userId: "u1", sessionToken: "tok" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sync.example.com/auth/sign-in/email");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("attaches a bearer token on pull when one is available", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ sources: [], movieFavourites: [], movieRecents: [], seriesFavourites: [], seriesRecents: [], progress: [], serverCursor: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => "session-tok" });
    await client.pull(0);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer session-tok");
  });

  it("rejects a malformed pull response instead of returning it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sources: "not-an-array" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => undefined });
    await expect(client.pull(0)).rejects.toThrow();
  });

  it("getSalt returns undefined on a 404 (no salt set yet)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "no salt set for this account yet" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => "tok" });
    await expect(client.getSalt()).resolves.toBeUndefined();
  });

  it("getSalt returns the salt when one exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ salt: "c2FsdA==" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => "tok" });
    await expect(client.getSalt()).resolves.toBe("c2FsdA==");
  });
});
