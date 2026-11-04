import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchResponding } from "../source/fetchResponding.js";
import { resetListRelay, setListRelay } from "../source/listRelay.js";

afterEach(() => {
  vi.unstubAllGlobals();
  resetListRelay();
});

const blocked = () => vi.fn(async () => Promise.reject(new TypeError("fetch failed")));

describe("fetchResponding with the list relay", () => {
  it("asks the relay when the provider cannot be reached directly", async () => {
    vi.stubGlobal("fetch", blocked());
    const relay = vi.fn(async () => new Response("#EXTM3U"));
    setListRelay(relay);
    const response = await fetchResponding("http://provider.test/get.php?username=u&password=p");
    expect(await response.text()).toBe("#EXTM3U");
    expect(relay).toHaveBeenCalledWith("http://provider.test/get.php?username=u&password=p", expect.any(AbortSignal));
  });

  it("does not use the relay when the direct request works", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("direct")));
    const relay = vi.fn(async () => new Response("relayed"));
    setListRelay(relay);
    expect(await (await fetchResponding("http://provider.test/a")).text()).toBe("direct");
    expect(relay).not.toHaveBeenCalled();
  });

  it("does not relay an answer that is not a refusal of the viewer's address", async () => {
    for (const status of [401, 404, 500]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status })));
      const relay = vi.fn(async () => new Response("relayed"));
      setListRelay(relay);
      expect((await fetchResponding("http://provider.test/a")).status).toBe(status);
      expect(relay).not.toHaveBeenCalled();
    }
  });

  it("asks the relay when the provider refuses the viewer with a 403, and uses its answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));
    setListRelay(async () => new Response("#EXTM3U"));
    const response = await fetchResponding("http://provider.test/a");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("#EXTM3U");
  });

  it("keeps the provider's own 403 when the relay cannot do better", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));
    setListRelay(async () => new Response("{}", { status: 403 }));
    expect((await fetchResponding("http://provider.test/a")).status).toBe(403);
  });

  it("asks the relay again when it is refused in a way that may pass", async () => {
    vi.stubGlobal("fetch", blocked());
    const relay = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 403 })).mockResolvedValueOnce(new Response("ok"));
    setListRelay(relay);
    expect(await (await fetchResponding("http://provider.test/a")).text()).toBe("ok");
    expect(relay).toHaveBeenCalledTimes(2);
  });

  it("does not keep asking when the relay says it is switched off or the account is not accepted", async () => {
    vi.stubGlobal("fetch", blocked());
    const relay = vi.fn(async () => new Response("{}", { status: 401 }));
    setListRelay(relay);
    await expect(fetchResponding("http://provider.test/a")).rejects.toThrow("fetch failed (relay: HTTP 401)");
    expect(relay).toHaveBeenCalledTimes(1);
  });

  it("throws the direct failure when signed out", async () => {
    vi.stubGlobal("fetch", blocked());
    setListRelay(async () => undefined);
    await expect(fetchResponding("http://provider.test/a")).rejects.toThrow("fetch failed");
  });

  it("throws the direct failure when the relay does not get a good answer", async () => {
    vi.stubGlobal("fetch", blocked());
    setListRelay(async () => new Response("{}", { status: 502 }));
    await expect(fetchResponding("http://provider.test/a")).rejects.toThrow("fetch failed");
  });

  it("throws the direct failure when the relay itself fails", async () => {
    vi.stubGlobal("fetch", blocked());
    setListRelay(async () => Promise.reject(new Error("offline")));
    await expect(fetchResponding("http://provider.test/a")).rejects.toThrow("fetch failed");
  });

  it("sends a provider that needed the relay there first next time", async () => {
    const direct = blocked();
    vi.stubGlobal("fetch", direct);
    setListRelay(async () => new Response("ok"));
    await fetchResponding("http://provider.test/a");
    await fetchResponding("http://provider.test/b");
    expect(direct).toHaveBeenCalledTimes(1);
  });

  it("does not relay a request that is not a plain GET", async () => {
    vi.stubGlobal("fetch", blocked());
    const relay = vi.fn(async () => new Response("ok"));
    setListRelay(relay);
    await expect(fetchResponding("http://provider.test/a", { method: "POST" })).rejects.toThrow("fetch failed");
    expect(relay).not.toHaveBeenCalled();
  });

  it("notes why the relay failed on the direct error, without the address", async () => {
    vi.stubGlobal("fetch", blocked());
    setListRelay(async () => new Response(JSON.stringify({ error: "could not reach the provider", detail: "http://p.test/get.php?password=secret" }), { status: 502 }));
    const error = await fetchResponding("http://p.test/get.php?password=secret").catch((e: Error) => e);
    expect((error as Error).message).toBe("fetch failed (relay: HTTP 502, could not reach the provider)");
    expect((error as Error).message).not.toContain("secret");
  });
});
