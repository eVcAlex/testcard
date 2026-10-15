import { describe, expect, it } from "vitest";
import { backupAddresses, checkDraftBasics, emptyDraft, guideAddress, playlistAddress, serverAddress } from "../sync/sourceDraft.js";

describe("sourceDraft", () => {
  it("reduces a pasted provider link to scheme and host", () => {
    expect(serverAddress("example.com:8080/get.php?username=a&password=b")).toBe("http://example.com:8080");
    expect(() => serverAddress("http://")).toThrow(/server address/);
  });

  it("takes only http(s) playlist and guide links; an empty guide is null", () => {
    expect(playlistAddress("  https://x.test/list.m3u ")).toBe("https://x.test/list.m3u");
    expect(() => playlistAddress("nope")).toThrow(/playlist/);
    expect(guideAddress("")).toBeNull();
    expect(() => guideAddress("file:///a")).toThrow(/guide/);
  });

  it("drops repeats in backup addresses and names the bad one", () => {
    expect(backupAddresses("a.test, http://a.test/x b.test")).toEqual(["http://a.test", "http://b.test"]);
    expect(() => backupAddresses("a.test http://")).toThrow(/"http:\/\/"/);
  });

  it("needs a name and at least one kind of content", () => {
    expect(() => checkDraftBasics(emptyDraft("xtream"))).toThrow(/name/);
    const named = { ...emptyDraft("xtream"), name: " Mine " };
    expect(checkDraftBasics(named).name).toBe("Mine");
    expect(() => checkDraftBasics({ ...named, content: { live: false, movies: false, series: false } })).toThrow(/at least one/);
  });
});
