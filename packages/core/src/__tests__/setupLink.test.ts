import { describe, expect, it } from "vitest";
import { buildSetupPayload, parseSetupLinkText, setupAppUrl, setupLinkUrl, summariseSetup } from "../sync/setupLink.js";
import { generateSetupLink } from "../sync/setupCrypto.js";

describe("parseSetupLinkText", () => {
  const link = generateSetupLink();
  const fragment = `${link.id}.${link.secret}`;

  it("reads the web address, the app address and the bare fragment", () => {
    expect(parseSetupLinkText(setupLinkUrl(link))).toEqual(link);
    expect(parseSetupLinkText(setupAppUrl(link))).toEqual(link);
    expect(parseSetupLinkText(`  https://www.evicted.dev/s/#${fragment} \n`)).toEqual(link);
    expect(parseSetupLinkText(`testcard:s#${fragment}`)).toEqual(link);
    expect(parseSetupLinkText(fragment)).toEqual(link);
  });

  it("refuses another site, another path, plain http and anything malformed", () => {
    for (const text of [
      `https://evil.example/s#${fragment}`,
      `https://evicted.dev.evil.example/s#${fragment}`,
      `https://evicted.dev@evil.example/s#${fragment}`,
      `https://evicted.dev/setup#${fragment}`,
      `http://evicted.dev/s#${fragment}`,
      `javascript:alert(1)//#${fragment}`,
      `file:///s#${fragment}`,
      "https://evicted.dev/s#short.secret",
      "https://evicted.dev/s",
      "",
      "x".repeat(400),
    ]) expect(parseSetupLinkText(text), text).toBeNull();
  });
});

describe("building and summarising a shared source", () => {
  it("shares only the login and what the receiver needs", () => {
    const payload = buildSetupPayload({
      name: "Living room",
      epgOptimise: true,
      content: { live: true, movies: false, series: false },
      source: { kind: "xtream", host: "http://tv.example.com:8080", username: "alice", password: "pw", backupHosts: [] },
    });
    expect(payload).toEqual({
      v: 1,
      name: "Living room",
      epgOptimise: true,
      source: { host: "http://tv.example.com:8080", username: "alice", password: "pw", content: { live: true, movies: false, series: false } },
    });
  });

  it("refuses a source that is not plainly an http(s) address", () => {
    expect(() => buildSetupPayload({ name: "x", source: { kind: "m3u", playlistUrl: "file:///etc/passwd" } })).toThrow();
    expect(() => buildSetupPayload({ name: "", source: { kind: "m3u", playlistUrl: "http://a.example/l.m3u" } })).toThrow();
  });

  it("shows the person a name and a host, never a login", () => {
    const xtream = summariseSetup(buildSetupPayload({ name: "Mum's TV", source: { kind: "xtream", host: "http://tv.example.com:8080", username: "alice", password: "hunter2" } }));
    expect(xtream).toEqual({ name: "Mum's TV", kind: "xtream", host: "tv.example.com:8080", epgOptimise: false });
    const m3u = summariseSetup(buildSetupPayload({ name: "List", source: { kind: "m3u", playlistUrl: "http://p.example.com/get.php?username=alice&password=hunter2" } }));
    expect(m3u.host).toBe("p.example.com");
    expect(JSON.stringify([xtream, m3u])).not.toContain("hunter2");
    expect(JSON.stringify([xtream, m3u])).not.toContain("alice");
  });
});
