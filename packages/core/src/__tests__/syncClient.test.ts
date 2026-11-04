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

  it("relayList asks /relay/list with the session and the address encoded, and hands back the response as it is", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("#EXTM3U", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => "tok" });
    const response = await client.relayList("http://p.test/get.php?username=u&password=p", new AbortController().signal);
    expect(await response.text()).toBe("#EXTM3U");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sync.example.com/relay/list?u=http%3A%2F%2Fp.test%2Fget.php%3Fusername%3Du%26password%3Dp");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok", Origin: "https://sync.example.com" });
  });

  it("relayList refuses without sending anything when signed out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => undefined });
    await expect(client.relayList("http://p.test/a", new AbortController().signal)).rejects.toThrow("Not signed in");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails with the server's own reply and the status, for the controller to word", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "Invalid email or password" }, 401)));
    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => undefined });
    await expect(client.signIn("a@b.com", "pw")).rejects.toMatchObject({ status: 401, message: '{"message":"Invalid email or password"}' });
  });

  it("treats a 404 as no salt yet, but as a failure anywhere else", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("Not Found", { status: 404 })));
    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => "tok" });
    await expect(client.getSalt()).resolves.toBeUndefined();
    await expect(client.signIn("a@b.com", "pw")).rejects.toMatchObject({ status: 404 });
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

describe("SyncClient timeouts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // A fetch that never answers, until its signal says stop (as a real one does).
  const hangingFetch = () =>
    vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    );

  it("gives up on a request that never answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => "tok" });
    const pull = expect(client.pull(0)).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(15_001);
    await pull;
  });

  it("abortAll cuts off requests under way at once", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const client = new SyncClient({ baseUrl: "https://sync.example.com", getSessionToken: () => "tok" });
    const pull = expect(client.pull(0)).rejects.toThrow("aborted");
    client.abortAll();
    await pull;
  });
});
