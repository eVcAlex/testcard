import { describe, expect, it } from "vitest";
import { explainFailure } from "../source/explainFailure.js";

const wrap = (m: string) => `Error invoking remote method 'testcard:invoke': ${m}`;

describe("explainFailure", () => {
  it("drops Electron's wrapper and Node's error names", () => {
    const text = explainFailure(wrap("TypeError: fetch failed"), "IPTV VOD");
    expect(text).toMatch(/^Couldn't reach IPTV VOD\./);
    expect(text).not.toMatch(/Error invoking|TypeError/);
  });

  it("explains a refusal by the provider", () => {
    const text = explainFailure(wrap("Error: Xtream get_live_categories failed: HTTP 403 (403 Forbidden nginx)"), "TREX");
    expect(text).toContain("TREX refused the request (HTTP 403)");
    expect(text).toContain("Check the login with Edit");
    expect(text).not.toContain("nginx");
  });

  it("says what a provider that sent no list means", () => {
    expect(explainFailure("Xtream get_vod_categories: the provider did not send a list (it sent an object with user_info). The account may be expired or disabled.", "MegaOTT VOD")).toMatch(
      /^MegaOTT VOD answered, but not with a list\./,
    );
  });

  it("explains a dead server address, a slow provider, throttling and a provider fault", () => {
    expect(explainFailure("getaddrinfo ENOTFOUND line.example.com", "A")).toContain("no longer exists");
    expect(explainFailure("The provider did not respond. Try again in a moment.", "A")).toContain("didn't answer in time");
    expect(explainFailure("Xtream x failed: HTTP 429", "A")).toContain("too many requests");
    expect(explainFailure("Failed to fetch playlist: HTTP 502", "A")).toContain("server had a problem (HTTP 502)");
  });

  it("says what the relay did when it was tried too", () => {
    expect(explainFailure("fetch failed (relay: HTTP 502, could not reach the provider)", "A")).toContain("couldn't reach it either");
    expect(explainFailure("fetch failed (relay: HTTP 401, unauthorized)", "A")).toContain("sign in again");
    expect(explainFailure("fetch failed (relay: HTTP 429, daily limit reached)", "A")).toContain("daily limit");
    expect(explainFailure("fetch failed (relay: HTTP 404, not found)", "A")).toContain("switched off");
    expect(explainFailure("fetch failed (relay: HTTP 418)", "A")).toContain("(HTTP 418)");
  });

  it("hints at signing in when no relay was tried", () => {
    expect(explainFailure("fetch failed", "A")).toContain("Signing in lets Testcard try another route");
  });

  it("explains a stream the player could not open", () => {
    expect(explainFailure("loading failed")).toContain("Couldn't open the stream");
    expect(explainFailure("The stream could not be opened.")).toContain("another network or a VPN");
  });

  it("passes the unrecognised through tidied", () => {
    expect(explainFailure("Error: something odd happened")).toBe("Something odd happened.");
    expect(explainFailure("")).toBe("That didn't work. Try again.");
  });
});
