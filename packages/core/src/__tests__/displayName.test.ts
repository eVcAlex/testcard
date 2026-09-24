import { describe, expect, it } from "vitest";
import { channelDisplayName, displayName } from "../normalise/displayName.js";

// Each provider has its own house style, so these cover the common ones, not just the one we started with.
describe("displayName", () => {
  it.each([
    ["UK| TNT Sports", "TNT Sports"],
    ["UK: BBC One HD", "BBC One HD"],
    ["UK | BBC One FHD", "BBC One FHD"],
    ["[UK] BBC One", "BBC One"],
    ["(UK) BBC One", "BBC One"],
    ["|UK| BBC One", "BBC One"],
    ["UK - BBC One", "BBC One"],
    ["UK ● BBC One", "BBC One"],
    ["UK★ BBC One", "BBC One"],
    ["UK ┃ BBC One", "BBC One"],
    ["GB: BBC One", "BBC One"],
    ["USA: ESPN", "ESPN"],
    ["EN - Netflix Movies", "Netflix Movies"],
    ["VIP | UK | Sports", "Sports"],
    ["DE: Das Erste", "Das Erste"],
  ])("drops the country or language prefix: %s", (raw, shown) => {
    expect(displayName(raw)).toBe(shown);
  });

  it.each([
    ["BT Sport 1", "BT Sport 1"],
    ["US ESPN HD", "US ESPN HD"],
    ["TV: Top Picks", "TV: Top Picks"],
    ["EPL 01: Arsenal vs Chelsea 15:00", "EPL 01: Arsenal vs Chelsea 15:00"],
    ["Disney+", "Disney+"],
    ["E4 +1", "E4 +1"],
    ["UK", "UK"],
  ])("leaves a name that only looks like it has a prefix: %s", (raw, shown) => {
    expect(displayName(raw)).toBe(shown);
  });

  it.each([
    ["★★ UK ENTERTAINMENT ★★", "UK Entertainment"],
    ["--- UK SPORTS ---", "UK Sports"],
    ["##### PPV HD/4K #####", "PPV HD/4K"],
    ["UK: ⭐ BBC One ⭐", "BBC One"],
    ["BBC One ◉", "BBC One"],
  ])("drops borders and symbols: %s", (raw, shown) => {
    expect(displayName(raw)).toBe(shown);
  });

  it("drops a provider's superscript branding tag and keeps quality tags", () => {
    expect(displayName("UK| TNT Sports ᴳᴬᴺᴶᴬ")).toBe("TNT Sports");
    expect(displayName("Football ᴳᴬᴺᴶᴬ")).toBe("Football");
    expect(displayName("Movies ⁴ᴷ")).toBe("Movies 4K");
    expect(displayName("Sky Sports ᵁᴴᴰ ᴴᴰᴿ")).toBe("Sky Sports UHD HDR");
    expect(displayName("|UK| BBC ONE ᴴᴰ")).toBe("BBC One HD");
  });

  it("moves a leading quality tag to the end rather than losing it", () => {
    expect(displayName("4K| Sky Sports")).toBe("Sky Sports 4K");
    expect(displayName("UHD | Sky Sports UHD")).toBe("Sky Sports UHD");
  });

  it("reads names written entirely in fancy letters", () => {
    expect(displayName("ʙʙᴄ ᴏɴᴇ")).toBe("BBC One");
    expect(displayName("UK| ʙʙᴄ ᴏɴᴇ ʜᴅ")).toBe("BBC One HD");
    expect(displayName("𝐁𝐁𝐂 𝐎𝐍𝐄")).toBe("BBC One");
    expect(displayName("ᴳᴬᴺᴶᴬ")).toBe("Ganja");
  });

  it("calms shouting but keeps acronyms and codes", () => {
    expect(displayName("EN - ACTION MOVIES")).toBe("Action Movies");
    expect(displayName("UK: SKY CINEMA ACTION HD")).toBe("Sky Cinema Action HD");
    expect(displayName("FR - TF1 FHD")).toBe("TF1 FHD");
    expect(displayName("ESPN")).toBe("ESPN");
    expect(displayName("CNN INTERNATIONAL")).toBe("CNN International");
    expect(displayName("Sky News")).toBe("Sky News");
  });
});

describe("channelDisplayName", () => {
  it("drops the marks that tell one variant from another", () => {
    expect(channelDisplayName("TNT Sports 1 (1080p50)")).toBe("TNT Sports 1");
    expect(channelDisplayName("UK| TNT Sports Ultimate (OFFLINE)")).toBe("TNT Sports Ultimate");
  });

  it("keeps quality written into the name, since those are separate channels", () => {
    expect(channelDisplayName("UK: BBC One FHD")).toBe("BBC One FHD");
  });
});
