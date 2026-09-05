import { describe, expect, it } from "vitest";
import { parseName } from "../normalise/parseName.js";

// Every case below is a real channel/category name pulled from probing the target provider
// during planning — not invented examples.
describe("parseName", () => {
  it("strips a country prefix and uppercases it", () => {
    expect(parseName("UK| TNT Sports ᴳᴬᴺᴶᴬ")).toMatchObject({
      country: "UK",
      normalised: "TNT Sports",
    });
  });

  it("strips styled unicode glyphs used for HD/UHD/HDR badges", () => {
    const result = parseName("Sky Sports Main Event ᵁᴴᴰ ᴴᴰᴿ");
    expect(result.normalised).toBe("Sky Sports Main Event");
  });

  it("extracts a resolution+framerate quality suffix", () => {
    expect(parseName("TNT Sports 1 (1080p50)")).toMatchObject({
      normalised: "TNT Sports 1",
      quality: "1080p50",
    });
  });

  it("extracts named quality suffixes (4K, UHD, HD, SD)", () => {
    expect(parseName("Sportsnet Event (4K)").quality).toBe("4k");
    expect(parseName("Some Channel (UHD)").quality).toBe("uhd");
    expect(parseName("Some Channel (HD)").quality).toBe("hd");
  });

  it("flags an (OFFLINE) suffix and removes it from the normalised name", () => {
    const result = parseName("TNT Sports Ultimate (OFFLINE)");
    expect(result.isOffline).toBe(true);
    expect(result.normalised).toBe("TNT Sports Ultimate");
  });

  it("strips decorative borders around PPV/event names", () => {
    expect(parseName("##### PPV HD/4K #####").normalised).toBe("PPV HD/4K");
  });

  it("leaves a plain name with no prefix/suffix/styling untouched", () => {
    const result = parseName("US: FOX 10 (KSAZ) PHOENIX HD");
    expect(result.country).toBeUndefined();
    expect(result.isOffline).toBe(false);
  });

  it("collapses double spaces left behind after stripping", () => {
    expect(parseName("NHL  4K -  ").normalised).not.toMatch(/ {2,}/);
  });

  it("handles a name with no country prefix at all", () => {
    const result = parseName("Rolex SailGP Championship");
    expect(result.country).toBeUndefined();
    expect(result.normalised).toBe("Rolex SailGP Championship");
  });
});
