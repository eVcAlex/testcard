import { describe, expect, it } from "vitest";
import { OTHER_SECTION, SECTION_ORDER, curateSection, sectionRank } from "../curate/curateSection.js";

const section = (categoryName: string, channelName = "Channel") => curateSection({ categoryName, channelName });

describe("curateSection", () => {
  it.each([
    ["UK| Sky Sports", "Sky Sports Main Event", "UK Sports"],
    ["UK| Football", "Sky Sports Premier League", "UK Football"],
    ["UK| Racing", "Racing TV", "UK Racing"],
    ["UK| Entertainment", "ITV1 HD", "UK Entertainment"],
    ["UK| News", "BBC News", "UK News"],
    ["UK| Kids", "CBeebies", "UK Kids"],
    ["US| NFL Sunday Ticket", "NFL Sunday Ticket 1", "NFL"],
    ["US| NBA League Pass", "NBA 03", "NBA"],
    ["US| NBC Network (Local Afternoon)", "NBC WNBC", "US Networks (Local)"],
    ["US| PPV Event", "UFC 300", "PPV Events"],
    ["BEE| DAZN PPV", "DAZN 1", "PPV Events"],
    ["AR| BEIN SPORTS HD", "beIN SPORTS 1 HD", "beIN SPORTS"],
    ["BEE| STARZPLAY SPORTS", "Starzplay Sports 1", "Arabic Sports"],
    ["AR| MBC/ROTANA", "MBC 1", "Arabic"],
    ["AR| MOROCCO", "2M", "Arabic"],
    ["BEE| AL KASS", "Al Kass One", "Arabic Sports"],
    ["IE| RTE", "RTÉ One", "Ireland"],
  ])("%s / %s -> %s", (category, channel, expected) => {
    expect(section(category, channel)).toBe(expected);
  });

  it("reads provider styling", () => {
    expect(section("AR| ʙᴇɪɴ ꜱᴘᴏʀᴛꜱ ᴴᴰ")).toBe("beIN SPORTS");
  });

  it("keeps channels it cannot place rather than dropping them", () => {
    expect(section("ZZ| Whatever", "Mystery")).toBe(OTHER_SECTION);
  });

  it("only returns sections that have a place in the order", () => {
    for (const [c, n] of [["UK| Sky Sports", "x"], ["US| NFL", "x"], ["", ""], ["AR| OSN", "x"]]) {
      expect(SECTION_ORDER).toContain(section(c!, n!));
    }
  });

  it("ranks UK sports before NFL before Other, and unknown sections just before Other", () => {
    expect(sectionRank("UK Sports")).toBeLessThan(sectionRank("NFL"));
    expect(sectionRank("NFL")).toBeLessThan(sectionRank(OTHER_SECTION));
    expect(sectionRank("Brand New Section")).toBe(sectionRank(OTHER_SECTION));
  });
});
