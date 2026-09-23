import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchResponding } from "../source/fetchResponding.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchResponding", () => {
  it("gives up on a provider that never starts answering", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      ),
    );
    await expect(fetchResponding("http://provider.test/player_api.php", {}, 20)).rejects.toThrow("The provider did not respond");
  });

  it("returns the response when the provider answers in time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    const response = await fetchResponding("http://provider.test/player_api.php", {}, 1000);
    expect(await response.text()).toBe("ok");
  });

  it("passes other failures through unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Network request failed"))));
    await expect(fetchResponding("http://provider.test/player_api.php")).rejects.toThrow("Network request failed");
  });
});
