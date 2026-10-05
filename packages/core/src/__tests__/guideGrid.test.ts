import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { railLists, segmentsFor, startList, type RailList } from "../epg/guideGrid.js";

const vectors = JSON.parse(readFileSync(new URL("../../test-vectors/guideGrid.json", import.meta.url), "utf8")) as { fn: string; in: unknown[]; out: unknown }[];
const fns = { segmentsFor, railLists } as unknown as Record<string, (...args: unknown[]) => unknown>;

describe("guideGrid vectors", () => {
  vectors.forEach((v, i) => it(`${v.fn} #${i}`, () => expect(fns[v.fn]!(...v.in)).toEqual(v.out)));
});

describe("startList", () => {
  const lists: RailList[] = [
    { id: "favourites", label: "Favourites", count: 0 },
    { id: "recent", label: "Recently watched", count: 3 },
    { id: "all", label: "All channels", count: 9 },
  ];
  it("prefers a still-present pick, then favourites, recents, all", () => {
    expect(startList(lists, "all")).toBe("all");
    expect(startList(lists, "gone")).toBe("recent");
    expect(startList([lists[0]!, lists[2]!], null)).toBe("all");
  });
});
