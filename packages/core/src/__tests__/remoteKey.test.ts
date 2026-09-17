import { describe, expect, it } from "vitest";
import { normalizeProviderHost, remoteKeyFor } from "../sync/remoteKey.js";

describe("normalizeProviderHost", () => {
  it("strips scheme, default port, and case", () => {
    expect(normalizeProviderHost("http://Example.com:80")).toBe("example.com");
    expect(normalizeProviderHost("https://Example.com:443")).toBe("example.com");
  });

  it("keeps a non-default port", () => {
    expect(normalizeProviderHost("http://example.com:8080")).toBe("example.com:8080");
  });

  it("treats a bare host (no scheme) the same as an http:// one", () => {
    expect(normalizeProviderHost("example.com")).toBe(normalizeProviderHost("http://example.com"));
  });
});

describe("remoteKeyFor", () => {
  it("is stable for the same host+id regardless of how the host was spelled", () => {
    const a = remoteKeyFor("http://example.com:80", "501");
    const b = remoteKeyFor("EXAMPLE.com", "501");
    return Promise.all([a, b]).then(([keyA, keyB]) => {
      expect(keyA).toBe(keyB);
      expect(keyA).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  it("differs for a different provider id", async () => {
    const a = await remoteKeyFor("example.com", "501");
    const b = await remoteKeyFor("example.com", "502");
    expect(a).not.toBe(b);
  });
});
