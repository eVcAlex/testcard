import { describe, expect, it } from "vitest";
import { CLASSIFIER_VERSION, GENRES, classifyCategory, decodeTags, encodeTags } from "../normalise/classifyCategory.js";
import golden from "./fixtures/categoryGolden.json" with { type: "json" };

/**
 * `categoryGolden.json` holds real provider category names where the rules AND an independent
 * TypeSafe/Jev labelling agreed with >= 0.9 confidence (see evals/categoryJev.eval.ts and
 * docs/adr/0007). This test runs fully offline; it exists so a rule change can't silently
 * regress a case two independent judges already agreed on.
 */
describe("classifyCategory — golden set", () => {
  it("has a useful spread of genres", () => {
    const genres = new Set(golden.map((row) => row.genre));
    expect(golden.length).toBeGreaterThanOrEqual(100);
    expect(genres.size).toBeGreaterThanOrEqual(10);
  });

  it.each(golden)("$name ($kind) -> $genre", ({ name, genre }) => {
    expect(classifyCategory(name).genre).toBe(genre);
  });
});

describe("classifyCategory — genre", () => {
  it("only ever returns a known genre or null", () => {
    for (const row of golden) {
      const { genre } = classifyCategory(row.name);
      expect(genre === null || (GENRES as readonly string[]).includes(genre)).toBe(true);
    }
  });

  it("uses the first-mentioned genre in a compound name", () => {
    expect(classifyCategory("|EN| DRAMA/ROMANCE").genre).toBe("drama");
    expect(classifyCategory("|EN| ACTION/THRILLER").genre).toBe("action");
    expect(classifyCategory("|EN| HORROR/THRILLER").genre).toBe("horror");
  });

  it("treats science fiction as scifi, not documentary", () => {
    expect(classifyCategory("EN - SCIENCE FICTION").genre).toBe("scifi");
  });

  it("recognises sports leagues and events by name", () => {
    for (const name of ["US| MILB PPV", "IE| ULSTER GAA PPV", "UK| TT RACE PPV", "CA| AHL TEAM"]) {
      expect(classifyCategory(name).genre).toBe("sports");
    }
  });

  it("does not guess a genre for a streaming brand or a PPV group with no subject", () => {
    expect(classifyCategory("UK| NETFLIX PPV").genre).toBeNull();
    expect(classifyCategory("US| PPV EVENT").genre).toBeNull();
    expect(classifyCategory("NETFLIX MOVIES").genre).toBeNull();
  });

  it("falls back to a leading emoji when the words say nothing", () => {
    expect(classifyCategory("🏒 FLO").genre).toBe("sports");
    expect(classifyCategory("🧸 Kids Channels").genre).toBe("kids");
  });

  it("always labels explicit adult categories adult, and tags them", () => {
    const result = classifyCategory("XXX Adult Movies");
    expect(result.genre).toBe("adult");
    expect(result.tags).toContain("adult");
  });

  it("does not mistake the Adult Swim cartoon block for adult content", () => {
    for (const name of ["NETFLIX ADULT-SWIM", "HBO MAX (ADULT SWIM)"]) {
      const result = classifyCategory(name);
      expect(result.genre).toBe("animation");
      expect(result.tags).not.toContain("adult");
    }
  });

  it("does not treat the Discovery+ streaming service as the documentary genre", () => {
    for (const name of ["DISCOVERY+ MOVIES", "DISCOVERY+ SERIES MENA"]) {
      const result = classifyCategory(name);
      expect(result.genre).toBeNull();
      expect(result.service).toBe("discovery+");
    }
    expect(classifyCategory("Discovery Channel").genre).toBe("documentary");
  });

  it("is null, not an error, for names it cannot read", () => {
    expect(classifyCategory("Zzyzx Qwerty").genre).toBeNull();
    expect(classifyCategory("").genre).toBeNull();
  });
});

describe("classifyCategory — language and service", () => {
  it("reads explicit language prefixes but never a country prefix", () => {
    expect(classifyCategory("|EN| HORROR").language).toBe("en");
    expect(classifyCategory("EN - ADVENTURE").language).toBe("en");
    expect(classifyCategory("UK| SPORT").language).toBeNull();
    expect(classifyCategory("US| ESPN PLAY").language).toBeNull();
  });

  it("reads language words and multi-language groups", () => {
    expect(classifyCategory("ENGLISH SERIES").language).toBe("en");
    expect(classifyCategory("MARVEL MOVIES (MULTI)").language).toBe("multi");
  });

  it("identifies streaming brands", () => {
    expect(classifyCategory("NETFLIX SERIES").service).toBe("netflix");
    expect(classifyCategory("DISNEY+ KIDS MOVIES").service).toBe("disney+");
    expect(classifyCategory("AMAZON KIDS").service).toBe("prime");
    expect(classifyCategory("TOP MOVIES").service).toBeNull();
  });
});

describe("classifyCategory — tags and flags", () => {
  it("reads quality badges through unicode styling", () => {
    expect(classifyCategory("TOP MOVIES ⁴ᴷ ³⁸⁴⁰ᴾ ᴰᴼᴸᴮʸ ᴬᵁᴰᴵᴼ").tags).toContain("4k");
    expect(classifyCategory("US| MLB PPV ᴿᴬᵂ").tags).toEqual(expect.arrayContaining(["ppv", "raw"]));
    expect(classifyCategory("UK| SKY SPORTS ⱽᴵᴾ").tags).toContain("vip");
  });

  it("flags divider rows as separators without discarding them", () => {
    expect(classifyCategory("##### PPV HD/4K #####").genre).toBeNull();
    expect(classifyCategory("=======").tags).toContain("separator");
    expect(classifyCategory("🔴").tags).toContain("separator");
  });

  it("flags categories that are nothing but quality badges as junk", () => {
    expect(classifyCategory("4K| ᵁᴴᴰ ³⁸⁴⁰ᴾ").tags).toContain("junk");
  });

  it("does not flag real names that merely contain a badge word", () => {
    for (const name of ["UK| VISION+", "US| CW ᴴᴰ/ᴿᴬᵂ ⁶⁰ᶠᵖˢ", "APPLE+ KIDS ⁴ᴷ ³⁸⁴⁰ᴾ ᴰᵒˡᵇʸ ⱽᶦˢᶦᵒⁿ"]) {
      const tags = classifyCategory(name).tags;
      expect(tags).not.toContain("junk");
      expect(tags).not.toContain("separator");
    }
  });
});

describe("classifyCategory — properties", () => {
  it("is deterministic", () => {
    for (const row of golden) expect(classifyCategory(row.name)).toEqual(classifyCategory(row.name));
  });

  it("round-trips its tag encoding", () => {
    for (const row of golden) {
      const { tags } = classifyCategory(row.name);
      expect(decodeTags(encodeTags(tags))).toEqual(tags);
    }
    expect(decodeTags(null)).toEqual([]);
    expect(decodeTags("")).toEqual([]);
    expect(decodeTags("ppv bogus 4k")).toEqual(["ppv", "4k"]);
  });

  it("exposes a version so stored results can be recomputed when rules change", () => {
    expect(Number.isInteger(CLASSIFIER_VERSION)).toBe(true);
    expect(CLASSIFIER_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("stays fast enough to run for every category on every import", () => {
    const names = golden.map((row) => row.name);
    const started = performance.now();
    for (let i = 0; i < 50; i += 1) for (const name of names) classifyCategory(name);
    expect(performance.now() - started).toBeLessThan(1500); // ~6k classifications
  });
});
