import { describe, expect, it } from "vitest";
import { categoryLabel } from "../normalise/categoryLabel.js";

describe("categoryLabel", () => {
  it("drops a provider's superscript branding tag", () => {
    expect(categoryLabel("UK| TNT Sports ᴳᴬᴺᴶᴬ")).toBe("TNT Sports");
    expect(categoryLabel("Football ᴳᴬᴺᴶᴬ")).toBe("Football");
  });

  it("keeps superscript quality tags, as ordinary letters", () => {
    expect(categoryLabel("Movies ⁴ᴷ")).toBe("Movies 4K");
    expect(categoryLabel("Sky Sports ᵁᴴᴰ ᴴᴰᴿ")).toBe("Sky Sports UHD HDR");
  });

  it("still drops the country prefix and title-cases shouting", () => {
    expect(categoryLabel("EN - ACTION MOVIES")).toBe("Action Movies");
  });

  it("falls back to the name when stripping leaves nothing", () => {
    expect(categoryLabel("ᴳᴬᴺᴶᴬ")).toBe("Ganja");
  });
});
