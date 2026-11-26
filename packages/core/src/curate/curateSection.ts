/**
 * Curated sections: an EPGenius-style grouping ("UK Sports", "NFL", "beIN SPORTS", "US Networks (Local)")
 * worked out from a channel's provider category and its own name.
 *
 * Presentation only (ADR 0021). Nothing here is stored or written back: channel ids, names, categories, `tvg_id`
 * and stream URLs stay as the provider listed them, so Favourites and Recents are untouched. A channel no rule
 * recognises goes to "Other" rather than being dropped.
 *
 * Pure and deterministic, so the Fire TV app can reproduce it from `test-vectors/curateSection.json`.
 * Bump `CURATE_VERSION` whenever a rule or the section order changes.
 */
export const CURATE_VERSION = 1;

export const OTHER_SECTION = "Other";

/** Sections in the order the Curated rail lists them. A section a source has no channels in is simply not shown. */
export const SECTION_ORDER: readonly string[] = [
  "UK Sports",
  "UK Football",
  "UK Racing",
  "NFL",
  "NBA",
  "MLB",
  "NHL",
  "College Sports",
  "US Sports",
  "PPV Events",
  "UK Entertainment",
  "UK Movies",
  "UK News",
  "UK Documentary",
  "UK Kids",
  "UK Music",
  "UK Regional",
  "UK Other",
  "US Networks (Local)",
  "US Entertainment",
  "US Movies",
  "US News",
  "US Kids",
  "US Other",
  "Ireland",
  "Canada",
  "Australia",
  "New Zealand",
  "beIN SPORTS",
  "DAZN",
  "Arabic Sports",
  "Arabic",
  "Sports (International)",
  "Music",
  "Kids",
  "News",
  "Movies",
  OTHER_SECTION,
];

export interface CurateInput {
  /** The provider's category name, e.g. "BEE| STARZPLAY SPORTS" or "UK| Sky Sports". */
  readonly categoryName: string;
  /** The channel's own raw name. */
  readonly channelName: string;
}

type Market = "uk" | "us" | "ca" | "ie" | "au" | "nz" | "ar";

const MARKET_PREFIXES: Readonly<Record<string, Market>> = {
  uk: "uk", gb: "uk",
  us: "us", usa: "us",
  ca: "ca", can: "ca",
  ie: "ie", ire: "ie",
  au: "au", aus: "au",
  nz: "nz",
  ar: "ar", bee: "ar", ara: "ar",
};

/** Provider styling to plain lower-case text: "ʙᴇɪɴ ꜱᴘᴏʀᴛꜱ ᴴᴰ" reads as "bein sports hd". */
function plain(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ʙᴇɪɴꜱᴘᴏʀᴛᴀᴅᴄᴍʜᴜᴋʟᴡᴠʏᴢꜰɢᴊ]/g, (ch) => SMALL_CAPS[ch] ?? ch)
    .toLowerCase();
}

const SMALL_CAPS: Readonly<Record<string, string>> = {
  ʙ: "b", ᴇ: "e", ɪ: "i", ɴ: "n", ꜱ: "s", ᴘ: "p", ᴏ: "o", ʀ: "r", ᴛ: "t", ᴀ: "a", ᴅ: "d", ᴄ: "c", ᴍ: "m",
  ʜ: "h", ᴜ: "u", ᴋ: "k", ʟ: "l", ᴡ: "w", ᴠ: "v", ʏ: "y", ᴢ: "z", ꜰ: "f", ɢ: "g", ᴊ: "j",
};

/** The market a "XX|" prefix names, or null. Looks at the category first, then the channel's own name. */
function marketOf(category: string, channel: string): Market | null {
  for (const text of [category, channel]) {
    const prefix = /^\s*([a-z]{2,3})\s*[|:]/.exec(text)?.[1];
    if (prefix !== undefined && MARKET_PREFIXES[prefix] !== undefined) return MARKET_PREFIXES[prefix];
  }
  return null;
}

const NFL = /\bnfl\b|red\s?zone|sunday ticket/;
const NBA = /\bnba\b|\bwnba\b/;
const MLB = /\bmlb\b|\bmilb\b/;
const NHL = /\bnhl\b|center ice/;
const COLLEGE = /\bncaa\b|college|\bbtn\b|big ten|\bsec network\b|\bacc network\b/;
const PPV = /\bppv\b|pay[- ]per[- ]view|\bufc\b|\bboxing\b|\bwwe\b|\baew\b/;
const BEIN = /\bbein\b/;
const DAZN = /\bdazn\b/;
const SPORT = /sport|espn|\bfs1\b|\bfs2\b|golf|tennis|cricket|rugby|racing|motorsport|\bf1\b|formula/;
/** Arabic sports channels whose names do not say "sport". */
const ARABIC_SPORT = /al ?kass|\bssc\b|thmanyah|dubai sports|abu dhabi sports|\bad sports\b|\bnx\b/;
const FOOTBALL = /football|soccer|premier league|champions league|europa|league (one|two|cup)|\bepl\b|\befl\b|spfl|laliga|serie a|bundesliga|ligue 1/;
const RACING = /racing|at the races|horse/;
const MOVIES = /movie|cinema|film|\bhbo\b|showtime|starz(?!play sports)|cinemax/;
const NEWS = /news|\bcnn\b|msnbc|bloomberg|cnbc/;
const KIDS = /kids|children|cbeebies|cbbc|nick(elodeon)?\b|cartoon|disney (junior|channel|xd)|boomerang|junior/;
const DOCUMENTARY = /documentar|history|nat(ional)? geo|discovery|animal planet|crime \+ investigation/;
const MUSIC = /music|\bmtv\b|vh1|vevo|\bclubbing\b|\bkerrang\b|\bkiss\b/;
const REGIONAL = /regional|scotland|wales|northern ireland|yorkshire|midlands|\blondon\b|\bstv\b|\bs4c\b|\butv\b/;
const ENTERTAINMENT = /entertainment|drama|comedy|reality|lifestyle|food|travel|channel 4|\bitv\b|bbc (one|two|three|four|1|2)|sky (atlantic|showcase|witness|max)|dave|\be4\b/;
const US_NETWORK = /\b(nbc|abc|cbs|fox|cw|pbs)\b|network|local/;

/** Section for a channel. Never null: unrecognised channels land in {@link OTHER_SECTION}. */
export function curateSection(input: CurateInput): string {
  const category = plain(input.categoryName);
  const channel = plain(input.channelName);
  const text = `${category} ${channel}`;
  const market = marketOf(category, channel);

  // Services that cross every market come first: a PPV card is a PPV card whatever the prefix.
  if (PPV.test(category) && !/news/.test(category)) return "PPV Events";
  if (BEIN.test(text)) return "beIN SPORTS";
  if (DAZN.test(text)) return "DAZN";

  if (NFL.test(text)) return "NFL";
  if (NBA.test(text)) return "NBA";
  if (MLB.test(text)) return "MLB";
  if (NHL.test(text)) return "NHL";
  if (COLLEGE.test(text) && SPORT.test(text) || /college/.test(category)) return "College Sports";

  switch (market) {
    case "uk":
      if (RACING.test(text)) return "UK Racing";
      if (FOOTBALL.test(text)) return "UK Football";
      if (SPORT.test(text)) return "UK Sports";
      if (MOVIES.test(text)) return "UK Movies";
      if (NEWS.test(text)) return "UK News";
      if (DOCUMENTARY.test(text)) return "UK Documentary";
      if (KIDS.test(text)) return "UK Kids";
      if (MUSIC.test(text)) return "UK Music";
      if (REGIONAL.test(text)) return "UK Regional";
      if (ENTERTAINMENT.test(text)) return "UK Entertainment";
      return "UK Other";
    case "us":
      if (SPORT.test(text)) return "US Sports";
      if (MOVIES.test(text)) return "US Movies";
      if (NEWS.test(text)) return "US News";
      if (KIDS.test(text)) return "US Kids";
      if (US_NETWORK.test(text)) return "US Networks (Local)";
      if (ENTERTAINMENT.test(text)) return "US Entertainment";
      return "US Other";
    case "ie":
      return "Ireland";
    case "ca":
      return "Canada";
    case "au":
      return "Australia";
    case "nz":
      return "New Zealand";
    case "ar":
      return SPORT.test(text) || ARABIC_SPORT.test(text) ? "Arabic Sports" : "Arabic";
    case null:
      break;
  }

  if (SPORT.test(text) || FOOTBALL.test(text)) return "Sports (International)";
  if (MUSIC.test(text)) return "Music";
  if (KIDS.test(text)) return "Kids";
  if (NEWS.test(text)) return "News";
  if (MOVIES.test(text)) return "Movies";
  return OTHER_SECTION;
}

/** Position of a section in the Curated rail; sections this version doesn't know sort just before "Other". */
export function sectionRank(section: string): number {
  const index = SECTION_ORDER.indexOf(section);
  return index === -1 ? SECTION_ORDER.length - 1 : index;
}
