import { describe, expect, it } from "vitest";
import { guideNameKey, matchGuideChannels } from "../epg/matchGuideChannels.js";

describe("guideNameKey", () => {
  it("reduces a provider's channel name and a guide's display name to the same key", () => {
    expect(guideNameKey("UK: BBC One FHD")).toBe("bbcone");
    expect(guideNameKey("UK | BBC ONE HD")).toBe("bbcone");
    expect(guideNameKey("|UK| BBC One (Backup)")).toBe("bbcone");
    expect(guideNameKey("BBC One")).toBe("bbcone");
    expect(guideNameKey("[UK] Sky Sports Main Event UHD")).toBe("skysportsmainevent");
  });

  it("keeps what tells channels apart", () => {
    expect(guideNameKey("ITV1 +1")).not.toBe(guideNameKey("ITV1"));
    expect(guideNameKey("BBC One Scotland")).not.toBe(guideNameKey("BBC One"));
    expect(guideNameKey("Sky Sports News")).not.toBe(guideNameKey("Sky News"));
  });
});

describe("matchGuideChannels", () => {
  const guide = [
    { id: "BBCOne.uk", displayNames: ["BBC One"] },
    { id: "SkySportsMainEvent.uk", displayNames: ["Sky Sports Main Event"] },
    { id: "ITV1plus1.uk", displayNames: ["ITV1 +1"] },
  ];

  it("gives every channel carrying the same tvg-id the listings, not just the last one", () => {
    const map = matchGuideChannels(
      [
        { id: "hd", tvgId: "BBCOne.uk", names: ["BBC One HD"] },
        { id: "fhd", tvgId: "BBCOne.uk", names: ["BBC One FHD"] },
      ],
      guide,
    );
    expect(map.get("BBCOne.uk")).toEqual(["hd", "fhd"]);
  });

  it("matches ids ignoring case", () => {
    expect(matchGuideChannels([{ id: "a", tvgId: "bbcone.uk", names: [] }], guide).get("BBCOne.uk")).toEqual(["a"]);
  });

  it("falls back to the name when the id is the provider's own or missing", () => {
    const map = matchGuideChannels(
      [
        { id: "a", tvgId: "bbc1.provider", names: ["BBC One", "UK: BBC ONE FHD"] },
        { id: "b", tvgId: null, names: ["Sky Sports Main Event", "UK| SKY SPORTS MAIN EVENT UHD"] },
        { id: "c", tvgId: null, names: ["ITV1", "UK: ITV 1 HD"] },
      ],
      guide,
    );
    expect(map.get("BBCOne.uk")).toEqual(["a"]);
    expect(map.get("SkySportsMainEvent.uk")).toEqual(["b"]);
    // ITV1 is not ITV1 +1.
    expect(map.get("ITV1plus1.uk")).toBeUndefined();
  });

  it("with no channel list in the guide, goes by the tvg-id alone", () => {
    expect(matchGuideChannels([{ id: "a", tvgId: "news.uk", names: ["News"] }], []).get("news.uk")).toEqual(["a"]);
  });
});
