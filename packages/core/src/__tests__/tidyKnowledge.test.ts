import { describe, expect, it } from "vitest";
import { LEAGUES, NETWORKS, isPlaceholderChannelName, leaguesOf, localNetworkOf } from "../epg/tidyKnowledge.js";
import { facetListId, parseFacetListId } from "../epg/guideListLabels.js";

describe("leaguesOf", () => {
  it("reads a league from a channel's name, whatever the provider's prefix and styling", () => {
    expect(leaguesOf("AT&T: NFL NETWORK ᴿᴬᵂ")).toEqual(["nfl"]);
    expect(leaguesOf("Sunday Night Football [NBC]")).toEqual(["nfl"]);
    expect(leaguesOf("US: NBA TV HD")).toEqual(["nba"]);
    expect(leaguesOf("UK: SKY SPORTS F1 UHD 50fps")).toEqual(["skysports", "f1"]);
    expect(leaguesOf("IT: DAZN MATCHROOM BOXING ᴿᴬᵂ")).toEqual(["dazn", "boxing"]);
    expect(leaguesOf("Sky Sports Action HD")).toEqual(["skysports"]);
    expect(leaguesOf("UK| TNT SPORTS 1 FHD")).toEqual(["tnt"]);
    expect(leaguesOf("SPFL: Celtic v Rangers")).toEqual(["spfl"]);
    expect(leaguesOf("TNT")).toEqual([]);
    expect(leaguesOf("UEFA Champions League 03")).toEqual(["uefa"]);
  });
  it("keeps the WNBA apart from the NBA, and college from the pros", () => {
    expect(leaguesOf("US: WNBA MINNESOTA LYNX")).toEqual(["wnba"]);
    expect(leaguesOf("NCAAF 01: NC State at Wake Forest")).toEqual(["ncaaf"]);
    expect(leaguesOf("MILB 12: Reno Aces")).toEqual(["milb"]);
  });
  it("says nothing for an ordinary channel", () => {
    for (const name of ["BBC One", "US: CNN", "Dave", ""]) expect(leaguesOf(name)).toEqual([]);
    expect(leaguesOf("SKY CINEMA")).toEqual(["skychannels"]);
    expect(leaguesOf("Sky Sports Main Event")).toEqual(["skysports"]);
  });
  it("has every league once, with a label and an emoji", () => {
    expect(new Set(LEAGUES.map((l) => l.key)).size).toBe(LEAGUES.length);
    for (const league of LEAGUES) { expect(league.label).not.toBe(""); expect(league.emoji).not.toBe(""); expect(() => new RegExp(league.pattern, "i")).not.toThrow(); }
  });
});

describe("localNetworkOf", () => {
  it("recognises a network's local stations by call letters, a city in brackets, or a channel number", () => {
    expect(localNetworkOf("NBC [Chicago] 1080p")).toBe("nbc");
    expect(localNetworkOf("NBC 5 (WMAQ) CHICAGO (A) ᴿᴬᵂ")).toBe("nbc");
    expect(localNetworkOf("ABC (KGO) SAN Francisco California")).toBe("abc");
    expect(localNetworkOf("US: CBS (WSBK) BOSTON HD")).toBe("cbs");
    expect(localNetworkOf("US: CW 21 BIRMINGHAM AL (WTTO) HD")).toBe("cw");
    expect(localNetworkOf("AT&T: FOX 10 LOCAL PHOENIX ᴿᴬᵂ")).toBe("fox");
    expect(localNetworkOf("US: TELEMUNDO 51 MIAMI (WSCV)")).toBe("telemundo");
    expect(localNetworkOf("WILKES BARRE, PA WBRE NBC 28 (A)")).toBe("nbc");
    expect(localNetworkOf("TV: BOSTON, MA WGBH PBS 2 A3 HD BOSTON ᶜᶦᵗʸ ᴿᴬᵂ")).toBe("pbs");
    expect(localNetworkOf("ABC 13 Asheville")).toBe("abc");
  });
  it("does not take a network's national services, its bare name, or a three-letter tag in brackets for a local station", () => {
    for (const name of ["US: FOX NEWS CHANNEL", "US: FOX BUSINESS", "US: NBC SPORTS NETWORK", "US: ABC NEWS LIVE", "US: CBS SPORTS NETWORK", "NBC", "US: NBC UNIVERSO", "Sunday Night Football [NBC]", "BBC One", "US: ESPN"]) {
      expect(localNetworkOf(name), name).toBeNull();
    }
  });
  it("has every network once", () => {
    expect(new Set(NETWORKS.map((n) => n.key)).size).toBe(NETWORKS.length);
  });
});

describe("isPlaceholderChannelName", () => {
  it("knows an empty event slot and a divider row from a station", () => {
    expect(isPlaceholderChannelName("NHL 01: No Game Today")).toBe(true);
    expect(isPlaceholderChannelName("- NO EVENT STREAMING - | 8K EXCLUSIVE | US: ESPN+ PPV 323")).toBe(true);
    expect(isPlaceholderChannelName("##### NCAAF #####")).toBe(true);
    expect(isPlaceholderChannelName("####### UEFA PPV #######")).toBe(true);
    for (const name of ["BBC One", "US: ESPN", "NCAAF 01: NC State at Wake Forest 7:30pm", "Dave", ""]) expect(isPlaceholderChannelName(name), name).toBe(false);
  });
});

describe("facet list ids", () => {
  it("round-trips, with or without a source", () => {
    expect(parseFacetListId(facetListId("league", "nfl"))).toEqual({ kind: "league", key: "nfl" });
    expect(parseFacetListId(facetListId("local", "nbc", "src-1"))).toEqual({ kind: "local", key: "nbc", sourceId: "src-1" });
    expect(parseFacetListId("guide:UK")).toBeNull();
    expect(parseFacetListId("tidy:a")).toBeNull();
  });
});
