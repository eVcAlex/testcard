import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { browseGuideChannels, browseTidyCategory, listGuideCountries, listTidyCategories } from "../db/tidyLists.js";
import { classifyCategory, encodeTags } from "../normalise/classifyCategory.js";
import { parseName } from "../normalise/parseName.js";
import { channelGuideCountry, guideCountryFromName, guideCountryHeading, guideCountryOf, guideListId, guideListLabel, parseGuideListId, parseTidyCategoryId, tidyCategoryId, tidyCategoryLabel } from "../epg/guideListLabels.js";

function setup() {
  const db = migrateDatabase(new Database(":memory:"));
  for (const [id, tidy] of [["s", 1], ["t", 0], ["u", 1]] as const) {
    db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at, epg_optimise) VALUES (?, 'xtream', ?, 'http://x', 1, ?)").run(id, id, tidy);
    db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name, tags) VALUES (?, ?, '1', 'X', '')").run(`${id}:c`, id);
  }
  const channel = db.prepare(
    "INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, country, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)",
  );
  const programme = db.prepare("INSERT INTO programmes (channel_id, title, start_at, end_at) VALUES (?, 'Show', 1, 2)");
  const add = (id: string, source: string, name: string, country: string | null, listed = true) => {
    channel.run(id, source, `${source}:c`, name, name, country);
    if (listed) programme.run(id);
  };
  return { db, add };
}

describe("TV Guide lists", () => {
  it("counts each station once per country, whatever quality or group it was listed under", () => {
    const { db, add } = setup();
    add("bbc4k", "s", "BBC One 4K", "UK");
    add("bbchd", "s", "BBC One HD", "UK");
    add("bbc2", "s", "BBC One", "UK");
    add("itv", "s", "ITV1", "UK");
    add("nbc", "s", "NBC Chicago", "US");
    expect(listGuideCountries(db)).toEqual([{ country: "UK", count: 2 }, { country: "US", count: 1 }]);
  });

  it("shows the best quality of a station first and orders by name", () => {
    const { db, add } = setup();
    add("bbc4k", "s", "BBC One 4K", "UK");
    add("bbchd", "s", "BBC One HD", "UK");
    add("itv", "s", "ITV1", "UK");
    expect(browseGuideChannels(db, { country: "UK" }).map((c) => c.id)).toEqual(["bbchd", "itv"]);
  });

  it("leaves out channels with no listings, no country, another country, or a source that is not tidied", () => {
    const { db, add } = setup();
    add("a", "s", "Alpha", "UK");
    add("nolist", "s", "Nolist", "UK", false);
    add("nocountry", "s", "Nocountry", null);
    add("us", "s", "Ustation", "US");
    add("off", "t", "Offsource", "UK");
    expect(browseGuideChannels(db, { country: "UK" }).map((c) => c.id)).toEqual(["a"]);
    expect(listGuideCountries(db).map((c) => c.country)).toEqual(["UK", "US"]);
  });

  it("keeps a station of one source apart from the same station of another, and can be read for one source", () => {
    const { db, add } = setup();
    add("s1", "s", "Dave", "UK");
    add("u1", "u", "Dave", "UK");
    expect(listGuideCountries(db)).toEqual([{ country: "UK", count: 2 }]);
    expect(browseGuideChannels(db, { country: "UK", sourceId: "u" }).map((c) => c.id)).toEqual(["u1"]);
    expect(listGuideCountries(db, "s")).toEqual([{ country: "UK", count: 1 }]);
  });

  it("does not offer a channel the viewer has hidden", () => {
    const { db, add } = setup();
    add("s:a", "s", "Alpha", "UK");
    add("s:b", "s", "Beta", "UK");
    db.prepare("INSERT INTO hidden_channels (source_id, channel_key, label, hidden_at) VALUES ('s', 'b', 'Beta', 1)").run();
    expect(browseGuideChannels(db, { country: "UK" }).map((c) => c.id)).toEqual(["s:a"]);
    expect(listGuideCountries(db)).toEqual([{ country: "UK", count: 1 }]);
  });

  it("gives nothing when no source is tidied", () => {
    const { db, add } = setup();
    add("off", "t", "Offsource", "UK");
    expect(listGuideCountries(db)).toEqual([]);
  });
});

describe("TV Guide countries", () => {
  it("reads the country from the channel's category when the channel has none", () => {
    const { db, add } = setup();
    db.prepare("UPDATE categories SET country = 'UK' WHERE id = 's:c'").run();
    add("a", "s", "Alpha", null);
    expect(listGuideCountries(db)).toEqual([{ country: "UK", count: 1 }]);
  });

  it("reads a 'UK:' prefix of the name, which the stored country does not know", () => {
    const { db, add } = setup();
    add("a", "s", "UK: Alpha", null);
    add("b", "s", "US - Beta", null);
    add("c", "s", "CA| Gamma", null);
    expect(listGuideCountries(db).map((c) => c.country).sort()).toEqual(["CA", "UK", "US"]);
  });

  it("does not make a list of a league or service prefix, and reads GB as UK", () => {
    const { db, add } = setup();
    add("a", "s", "NBA: Lakers", null);
    add("b", "s", "PRIME: Movie Channel", "PRIME");
    add("c", "s", "Gamma", "GB");
    add("d", "s", "Delta", "UK");
    expect(listGuideCountries(db)).toEqual([{ country: "UK", count: 2 }]);
  });

  it("knows what a country code is, and takes the channel's own before its category's before its name", () => {
    expect(guideCountryOf("gb")).toBe("UK");
    expect(guideCountryOf("NHL")).toBeNull();
    expect(guideCountryOf(null)).toBeNull();
    expect(guideCountryFromName("US: NBC 5")).toBe("US");
    expect(guideCountryFromName("4K: Sky Primafila")).toBeNull();
    expect(guideCountryFromName("TV: Funniest Videos")).toBeNull();
    expect(channelGuideCountry("CA", "UK", "US: X")).toBe("CA");
    expect(channelGuideCountry(null, "UK", "US: X")).toBe("UK");
    expect(channelGuideCountry("NHL", null, "US: X")).toBe("US");
  });
});

describe("TV Guide list names and ids", () => {
  it("names a list by flag and country", () => {
    expect(guideListLabel("UK")).toBe("🇬🇧 TV Guide (UK)");
    expect(guideListLabel("US")).toBe("🇺🇸 TV Guide (USA)");
    expect(guideListLabel("CA")).toBe("🇨🇦 TV Guide (Canada)");
    expect(guideListLabel("XX")).toBe("🇽🇽 TV Guide (XX)");
    expect(guideListLabel("INT")).toBe("TV Guide (INT)");
  });
  it("round-trips a list id, with or without a source", () => {
    expect(parseGuideListId(guideListId("UK"))).toEqual({ country: "UK" });
    expect(parseGuideListId(guideListId("UK", "src-1"))).toEqual({ country: "UK", sourceId: "src-1" });
    expect(parseGuideListId("all")).toBeNull();
    expect(parseGuideListId("s:cat:UK")).toBeNull();
  });
});

describe("tidy categories", () => {
  function world() {
    const db = migrateDatabase(new Database(":memory:"));
    db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at, epg_optimise) VALUES ('s', 'xtream', 's', 'http://x', 1, 1)").run();
    db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at, epg_optimise) VALUES ('t', 'xtream', 't', 'http://x', 1, 0)").run();
    const category = db.prepare("INSERT INTO categories (id, source_id, provider_id, raw_name, country, tags) VALUES (?, ?, ?, ?, ?, ?)");
    const channel = db.prepare("INSERT INTO channels (id, source_id, category_id, normalised_name, raw_name, country, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, NULL, 1, 1)");
    let n = 0;
    const addCategory = (source: string, raw: string, names: string[]) => {
      const id = `${source}:cat${++n}`;
      category.run(id, source, String(n), raw, (parseName(raw) as { country?: string }).country ?? null, encodeTags(classifyCategory(raw).tags));
      names.forEach((name, at) => channel.run(`${id}:c${at}`, source, id, name, name));
      return id;
    };
    return { db, addCategory };
  }

  it("gathers the quality and source copies of a category into one list, counting a station once", () => {
    const { db, addCategory } = world();
    const hd = addCategory("s", "UK| SPORT ᴴᴰ", ["Sky Sports Main Event HD", "TNT Sports 1 HD"]);
    const raw = addCategory("s", "UK| SPORT ᴿᴬᵂ ⁶⁰ᶠᵖˢ", ["Sky Sports Main Event", "Eurosport 1"]);
    const hevc = addCategory("s", "UK| SPORT ʰᵉᵛᶜ", ["Sky Sports Main Event 4K"]);
    const lists = listTidyCategories(db);
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ label: "Sport", country: "UK", ppv: false, count: 3 });
    expect(parseTidyCategoryId(lists[0]!.id)?.sort()).toEqual([hd, raw, hevc].sort());
  });

  it("keeps events apart, drops the PPV word from their name, and leaves out junk, separators and tidying-off sources", () => {
    const { db, addCategory } = world();
    addCategory("s", "UK| DAZN PPV", ["DAZN 1"]);
    addCategory("s", "UK| GENERAL ᴴᴰ/ᴿᴬᵂ", ["BBC One HD"]);
    addCategory("s", "4K| ᵁᴴᴰ ³⁸⁴⁰ᴾ", ["Junk row"]);
    addCategory("t", "UK| NEWS", ["Not tidied"]);
    const lists = listTidyCategories(db);
    expect(lists.map((l) => [l.label, l.country, l.ppv])).toEqual([["General", "UK", false], ["DAZN", "UK", true]]);
  });

  it("orders by country (UK, USA, Canada first, then the rest, then none), then events last, then name", () => {
    const { db, addCategory } = world();
    addCategory("s", "BEE| DAZN PPV", ["X"]);
    addCategory("s", "DE| NEWS", ["X"]);
    addCategory("s", "US| NEWS", ["X"]);
    addCategory("s", "UK| NEWS", ["X"]);
    addCategory("s", "UK| KIDS", ["X"]);
    addCategory("s", "UK| ESPN PPV", ["X"]);
    expect(listTidyCategories(db).map((l) => `${l.country ?? "-"} ${l.label}${l.ppv ? " (ppv)" : ""}`)).toEqual([
      "UK Kids", "UK News", "UK ESPN (ppv)", "US News", "DE News", "- BEE| DAZN (ppv)", // an unknown prefix stays: the "Other" section mixes places
    ]);
  });

  it("reads a list's channels once each per station, the best quality first, by name", () => {
    const { db, addCategory } = world();
    addCategory("s", "UK| NEWS ᴴᴰ", ["BBC News 4K", "Sky News HD"]);
    addCategory("s", "UK| NEWS ᴿᴬᵂ", ["BBC News HD", "GB News"]);
    const [list] = listTidyCategories(db);
    const names = browseTidyCategory(db, { id: list!.id }).map((c) => c.normalised_name);
    expect(names).toEqual(["BBC News HD", "GB News", "Sky News HD"]);
    expect(list!.count).toBe(3);
  });

  it("reads nothing from an id that is not a tidy list", () => {
    const { db } = world();
    expect(browseTidyCategory(db, { id: "all" })).toEqual([]);
  });

  it("does not offer a hidden category or channel", () => {
    const { db, addCategory } = world();
    const news = addCategory("s", "UK| NEWS", ["A", "B"]);
    addCategory("s", "UK| KIDS", ["C"]);
    db.prepare("INSERT INTO hidden_channels (source_id, channel_key, label, hidden_at) VALUES ('s', ?, 'A', 1)").run(`${news.slice(2)}:c0`);
    expect(listTidyCategories(db).map((l) => [l.label, l.count])).toEqual([["Kids", 1], ["News", 1]]);
    db.prepare("INSERT INTO hidden_categories (source_id, kind, category_key, label, hidden_at) VALUES ('s', 'live', '2', 'Kids', 1)").run();
    expect(listTidyCategories(db).map((l) => l.label)).toEqual(["News"]);
  });
});

describe("tidy category names and ids", () => {
  it("drops the quality and source words a provider hangs on a category, and the PPV word in an events list", () => {
    expect(tidyCategoryLabel("UK| SPORT ᴴᴰ", false)).toBe("Sport");
    expect(tidyCategoryLabel("UK| SPORT ᴿᴬᵂ ⁶⁰ᶠᵖˢ", false)).toBe("Sport");
    expect(tidyCategoryLabel("UK| SPORT ʰᵉᵛᶜ", false).toLowerCase()).toBe("sport");
    expect(tidyCategoryLabel("UK| EPL PREMIER LEAGUE PPV ⱽᴵᴾ", true)).toBe("EPL Premier League");
    expect(tidyCategoryLabel("UK| DAZN PPV", false)).toBe("DAZN PPV");
    expect(tidyCategoryLabel("UK| 4K", false)).not.toBe("");
  });
  it("names a country's section, and round-trips a tidy list's id", () => {
    expect(guideCountryHeading("UK")).toBe("🇬🇧 UK");
    expect(guideCountryHeading("US")).toBe("🇺🇸 USA");
    expect(guideCountryHeading(null)).toBe("Other");
    expect(parseTidyCategoryId(tidyCategoryId(["s:1", "s:2"]))).toEqual(["s:1", "s:2"]);
    expect(parseTidyCategoryId("guide:UK")).toBeNull();
  });
});
