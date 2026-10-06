import { describe, expect, it } from "vitest";
import { categoryRail } from "../normalise/categoryRail.js";

const sources = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Empty" }];
const categories = {
  "": [{ id: "a1", label: "Drama", count: 3 }, { id: "b1", label: "Drama", count: 2 }, { id: "b2", label: "Kids", count: 0 }],
  a: [{ id: "a1", label: "Drama", count: 3 }],
  b: [{ id: "b1", label: "Drama", count: 2 }, { id: "b2", label: "Kids", count: 0 }],
  c: [],
};

describe("categoryRail", () => {
  it("sections the categories by source when several have some", () => {
    const rail = categoryRail({ sourceId: null, sources, categories });
    expect(rail.map((l) => [l.id, l.section ?? null])).toEqual([["home", null], ["a1", "Alpha"], ["b1", "Beta"]]);
    expect(rail[0]!.count).toBe(5);
  });

  it("is one flat list when a source is picked", () => {
    const rail = categoryRail({ sourceId: "b", sources, categories });
    expect(rail.map((l) => [l.id, l.section ?? null])).toEqual([["home", null], ["b1", null]]);
  });

  it("is one flat list when only one source has categories", () => {
    const rail = categoryRail({ sourceId: null, sources: sources.slice(0, 1), categories });
    expect(rail.every((l) => l.section === undefined)).toBe(true);
  });
});
