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

describe("railLists with TV Guide lists", () => {
  const base = {
    sourceId: null as string | null,
    sources: [{ id: "s1", name: "One", channels: 10 }],
    categories: { "": [{ id: "s1:a", label: "Sports", count: 4 }], s1: [{ id: "s1:a", label: "Sports", count: 4 }] },
    favourites: 0,
    recents: 0,
  };
  it("adds a TV Guide section ahead of the categories, one list per country", () => {
    const lists = railLists({ ...base, guideCountries: { "": [{ country: "UK", count: 5 }, { country: "US", count: 3 }] } });
    expect(lists.map((l) => [l.id, l.section])).toEqual([
      ["favourites", undefined], ["recent", undefined],
      ["guide:UK", "TV Guide"], ["guide:US", "TV Guide"],
      ["s1:a", "Categories"], ["all", "Categories"],
    ]);
    expect(lists.find((l) => l.id === "guide:UK")?.label).toBe("🇬🇧 TV Guide (UK)");
  });
  it("leaves the rail as it was when there are none", () => {
    const lists = railLists({ ...base, guideCountries: { "": [] } });
    expect(lists.map((l) => [l.id, l.section])).toEqual([["favourites", undefined], ["recent", undefined], ["s1:a", undefined], ["all", undefined]]);
  });
  it("adds a section per country and its events from the tidy lists, then the provider's own groups", () => {
    const tidy = (id: string, label: string, country: string | null, ppv: boolean, count: number) => ({ id, label, country, ppv, count });
    const lists = railLists({
      ...base,
      guideCountries: { "": [{ country: "UK", count: 5 }] },
      tidyCategories: { "": [tidy("tidy:a", "Sport", "UK", false, 9), tidy("tidy:b", "DAZN", "UK", true, 4), tidy("tidy:c", "News", "US", false, 7), tidy("tidy:d", "BEE| X", null, false, 1), tidy("tidy:e", "Empty", "UK", false, 0)] },
    });
    expect(lists.map((l) => [l.id, l.section])).toEqual([
      ["favourites", undefined], ["recent", undefined],
      ["guide:UK", "TV Guide"],
      ["tidy:a", "🇬🇧 UK"], ["tidy:b", "🇬🇧 UK · Events"], ["tidy:c", "🇺🇸 USA"], ["tidy:d", "Other"],
      ["s1:a", "Provider groups"], ["all", "Provider groups"],
    ]);
  });
  it("puts the leagues, then each network's local stations, between the TV Guide and the country sections", () => {
    const lists = railLists({
      ...base,
      guideCountries: { "": [{ country: "UK", count: 5 }] },
      facetLists: { "": [
        { id: "league:nfl", label: "🏈 NFL", kind: "league", count: 30 }, { id: "league:nba", label: "🏀 NBA", kind: "league", count: 20 },
        { id: "local:nbc", label: "📺 NBC local stations", kind: "local", count: 99 },
      ] },
      tidyCategories: { "": [{ id: "tidy:a", label: "Sport", country: "UK", ppv: false, count: 3 }] },
    });
    expect(lists.map((l) => [l.id, l.section])).toEqual([
      ["favourites", undefined], ["recent", undefined],
      ["guide:UK", "TV Guide"],
      ["league:nfl", "Sports"], ["league:nba", "Sports"],
      ["local:nbc", "Local stations"],
      ["tidy:a", "🇬🇧 UK"],
      ["s1:a", "Provider groups"], ["all", "Provider groups"],
    ]);
  });
  it("shows the tidy lists even when no guide has loaded yet", () => {
    const lists = railLists({ ...base, tidyCategories: { "": [{ id: "tidy:a", label: "Sport", country: "UK", ppv: false, count: 3 }] } });
    expect(lists.map((l) => [l.id, l.section])).toEqual([["favourites", undefined], ["recent", undefined], ["tidy:a", "🇬🇧 UK"], ["s1:a", "Provider groups"], ["all", "Provider groups"]]);
  });
  it("puts a source's own TV Guide lists in its section when several sources are shown", () => {
    const lists = railLists({
      ...base,
      sources: [{ id: "s1", name: "One", channels: 10 }, { id: "s2", name: "Two", channels: 5 }],
      categories: { s1: [{ id: "s1:a", label: "Sports", count: 4 }], s2: [{ id: "s2:b", label: "News", count: 2 }] },
      guideCountries: { s1: [{ country: "UK", count: 5 }] },
    });
    expect(lists.map((l) => [l.id, l.section])).toEqual([
      ["favourites", undefined], ["recent", undefined],
      ["guide:UK@s1", "One"], ["all:s1", "One"], ["s1:a", "One"],
      ["all:s2", "Two"], ["s2:b", "Two"],
    ]);
  });
});
