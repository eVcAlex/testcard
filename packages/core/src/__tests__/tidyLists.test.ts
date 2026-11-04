import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { browseGuideChannels, listGuideCountries } from "../db/tidyLists.js";
import { channelGuideCountry, guideCountryFromName, guideCountryOf, guideListId, guideListLabel, parseGuideListId } from "../epg/guideListLabels.js";

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
