/**
 * Turns a provider's category name into structured, advisory metadata: what it's *about* (genre),
 * which streaming brand it belongs to, its language, and a few tags/flags. Deterministic and pure —
 * the same string always gives the same answer, with no network, so it can run for every category on
 * every import and its results can be stored and queried like any other column.
 *
 * Nothing here is authoritative. The provider's own name is always kept alongside; every field is
 * `null`/empty when the rules don't recognise it, and the UI must behave sensibly without it. The
 * rules were written against 662 real category names and audited against TypeSafe/Jev labels at
 * development time (see docs/adr/0007 and evals/categoryJev.eval.ts); Jev is not a runtime
 * dependency.
 *
 * Bump `CLASSIFIER_VERSION` whenever a rule changes so stored results are recomputed on next open.
 */
export const CLASSIFIER_VERSION = 2;

export const GENRES = [
  "sports",
  "kids",
  "news",
  "documentary",
  "music",
  "reality",
  "comedy",
  "drama",
  "action",
  "horror",
  "scifi",
  "romance",
  "animation",
  "holiday",
  "adult",
] as const;
export type Genre = (typeof GENRES)[number];

/** Things worth knowing about a category that aren't its genre. */
export const CATEGORY_TAGS = ["ppv", "4k", "8k", "vip", "raw", "adult", "separator", "junk"] as const;
export type CategoryTag = (typeof CATEGORY_TAGS)[number];

export interface CategoryClassification {
  /** Canonical genre, or null when no rule matched. */
  readonly genre: Genre | null;
  /** Streaming brand the category belongs to ("netflix", "disney+", ...), or null. */
  readonly service: string | null;
  /** Lowercase ISO 639-1 code ("en", "fr"), "multi" for multi-language groups, or null. */
  readonly language: string | null;
  readonly tags: readonly CategoryTag[];
}

// ---------------------------------------------------------------------------------------------
// text preparation

/** Superscript / small-cap styling glyphs → plain ASCII, so "⁴ᴷ ³⁸⁴⁰ᴾ" is readable as "4k 3840p". */
const STYLED_TO_ASCII: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  ᴀ: "a", ʙ: "b", ᴄ: "c", ᴅ: "d", ᴇ: "e", ꜰ: "f", ɢ: "g", ʜ: "h", ɪ: "i", ᴊ: "j", ᴋ: "k", ʟ: "l", ᴍ: "m",
  ɴ: "n", ᴏ: "o", ᴘ: "p", ʀ: "r", ꜱ: "s", ᴛ: "t", ᴜ: "u", ᴠ: "v", ᴡ: "w", ʏ: "y", ᴢ: "z",
  ᴬ: "a", ᴮ: "b", ᴰ: "d", ᴱ: "e", ᴳ: "g", ᴴ: "h", ᴵ: "i", ᴶ: "j", ᴷ: "k", ᴸ: "l", ᴹ: "m", ᴺ: "n", ᴼ: "o",
  ᴾ: "p", ᴿ: "r", ᵀ: "t", ᵁ: "u", ᵂ: "w", ⱽ: "v", ᵃ: "a", ᵇ: "b", ᶜ: "c", ᵈ: "d", ᵉ: "e", ᶠ: "f", ᵍ: "g",
  ʰ: "h", ⁱ: "i", ʲ: "j", ᵏ: "k", ˡ: "l", ᵐ: "m", ⁿ: "n", ᵒ: "o", ᵖ: "p", ʳ: "r", ˢ: "s", ᵗ: "t", ᵘ: "u",
  ᵛ: "v", ʷ: "w", ˣ: "x", ʸ: "y", ᶻ: "z",
};

function unstyle(text: string): string {
  let out = "";
  for (const ch of text) out += STYLED_TO_ASCII[ch] ?? ch;
  return out;
}

/** Lowercased, unstyled, emoji-free, punctuation-flattened — the string every rule matches against. */
function searchable(raw: string): string {
  return unstyle(raw)
    .toLowerCase()
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();
}

const has = (text: string, pattern: RegExp): boolean => pattern.test(text);

// ---------------------------------------------------------------------------------------------
// language

// "|EN| ...", "EN - ...", "EN: ..." — two letters followed by a separator. A bare "UK|" is a
// *country* (parseName), never a language, so only these explicit language spellings count.
const LANGUAGE_PREFIX = /^\s*\|?\s*([A-Za-z]{2})\s*(?:\||-|:)\s+/;
const LANGUAGE_CODES = new Set(["en", "fr", "de", "es", "it", "pt", "nl", "ar", "tr", "pl", "ru", "hi", "ur", "fa", "el", "sv", "no", "da", "fi"]);

const LANGUAGE_WORDS: readonly [RegExp, string][] = [
  [/\benglish\b/, "en"],
  [/\bfrench\b/, "fr"],
  [/\bgerman\b/, "de"],
  [/\bspanish\b|\blatino\b/, "es"],
  [/\bitalian\b/, "it"],
  [/\bportuguese\b/, "pt"],
  [/\barabic\b/, "ar"],
  [/\bturkish\b/, "tr"],
  [/\bhindi\b/, "hi"],
];

function detectLanguage(raw: string, text: string): string | null {
  const prefix = LANGUAGE_PREFIX.exec(unstyle(raw));
  const code = prefix?.[1]?.toLowerCase();
  if (code !== undefined && LANGUAGE_CODES.has(code)) return code;
  for (const [pattern, lang] of LANGUAGE_WORDS) if (pattern.test(text)) return lang;
  if (has(text, /\bmulti( subs?| language)?\b/)) return "multi";
  return null;
}

// ---------------------------------------------------------------------------------------------
// streaming service

const SERVICES: readonly [RegExp, string][] = [
  [/\bnetflix\b/, "netflix"],
  [/\bdisney\+?/, "disney+"],
  [/\bamazon\b|\bprime\b/, "prime"],
  [/\bapple\b/, "apple"],
  [/\bhbo\b/, "hbo"],
  [/\bparamount\+?/, "paramount+"],
  [/\bpeacock\b/, "peacock"],
  [/\bhulu\b/, "hulu"],
  [/\bdiscovery\+?/, "discovery+"],
  [/\bviaplay\b/, "viaplay"],
  [/\bosn\+?/, "osn+"],
  [/\bshowtime\b/, "showtime"],
  [/\bdazn\b/, "dazn"],
  [/\bespn\+?/, "espn"],
  [/\bnickelodeon\b/, "nickelodeon"],
  [/\bsky\b/, "sky"],
  [/\bbbc\b/, "bbc"],
];

// ---------------------------------------------------------------------------------------------
// genre — the rule whose keyword appears EARLIEST in the name wins (so "DRAMA/ROMANCE" is drama and
// "ACTION/THRILLER" is action); on a tie the rule listed first wins. "adult" is checked separately
// and always wins, because mislabelling adult content is the costly mistake.

/** Whole-word match over any of the `|`-separated alternatives. */
const words = (alternatives: string): RegExp => new RegExp(String.raw`\b(?:${alternatives})(?![a-z0-9])`);

const ADULT = words("xxx|adult(?! swim)|18\\+|erotic|porn");

const GENRE_RULES: readonly [Genre, RegExp][] = [
  ["holiday", words("christmas|xmas|halloween|thanksgiving|easter|holiday")],
  ["kids", words("kids?|children|family|cartoons?|junior|toons?|cbeebies|cbbc|nick jr|nickelodeon|disney (?:channel|junior)|baby")],
  ["animation", words("anime|animi|animation|animated|manga|pixar|crunchyroll|adult swim")],
  ["scifi", words("sci fi|scifi|science fiction|fantasy|fantastic")],
  ["documentary", words("docu|documentar(?:y|ies)|docs|nature|history|science|crime|discovery")],
  ["news", words("news|weather|business|politics")],
  ["music", words("music|musicals?|concerts?|radio|mtv|broadway")],
  ["reality", words("reality|lifestyle|cooking|food|home|hgtv")],
  ["comedy", words("comedy|stand up|sitcoms?")],
  ["action", words("action|adventure|martial arts|war|westerns?|james bond|007|mafia|gangster")],
  ["horror", words("horror|thriller|scary")],
  ["romance", words("romance|romantic|rom com")],
  ["drama", words("drama|dramas|telenovelas?|soaps?")],
  [
    "sports",
    words(
      "sports?|sportsnet|eurosport|fubo|deportes|football|soccer|nfl|nba|nhl|mlb|milb|mls|wnba|ufc|wwe|boxing|golf|tennis|cricket|rugby|" +
        "racing|races?|formula 1|f1|motogp|mxgp|epl|premier league|champions league|uefa|fifa|bundesliga|la liga|serie a|ligue 1|" +
        "olympics|volley ?ball|afl|nrl|ncaa|ncaaf|ncaab|college (?:football|basketball)|league|wrestling|fight|dazn|espn|tnt sports|" +
        "sky sports|bt sport|nascar|hockey|basketball|baseball|cycling|darts|snooker|pool|gaa|gaago|ahl|cfl|whl|ohl|qmjhl|nifl|spfl|" +
        "nfhs|btn|b1g|tsn|setanta|matchroom|pdc|supercross|rally|dirtvision|masters|world cup|cup|championship|fa player|" +
        "flo college|flo rugby|florugby",
    ),
  ],
];

// A leading emoji is a strong hint when the words say nothing ("🏒 FLO", "🧸 Kids Channels").
const EMOJI_GENRE: readonly [RegExp, Genre][] = [
  [/[⚽⚾🏀-🏏🏐-🏓🥊🏟🏆🎾🎱🏒]/u, "sports"],
  [/[🧸🧒]/u, "kids"],
  [/[🤣😂]/u, "comedy"],
  [/[🎵🎤🎧🎸]/u, "music"],
  [/[📰]/u, "news"],
];

function detectGenre(raw: string, text: string): Genre | null {
  if (ADULT.test(text)) return "adult";
  let best: { genre: Genre; at: number } | null = null;
  for (const [genre, pattern] of GENRE_RULES) {
    const at = text.search(pattern);
    if (at !== -1 && (best === null || at < best.at)) best = { genre, at };
  }
  if (best !== null) return best.genre;
  for (const [pattern, genre] of EMOJI_GENRE) if (pattern.test(raw)) return genre;
  return null;
}

// ---------------------------------------------------------------------------------------------

function detectTags(text: string): CategoryTag[] {
  const tags: CategoryTag[] = [];
  if (has(text, /\bppv\b|\bpay per view\b/)) tags.push("ppv");
  if (has(text, /\b8k\b/)) tags.push("8k");
  else if (has(text, /\b4k\b|\b2160p?\b|\b3840p?\b|\buhd\b/)) tags.push("4k");
  if (has(text, /\bvip\b/)) tags.push("vip");
  if (has(text, /\braw\b/)) tags.push("raw");
  return tags;
}

/** "UK| ", "US|" — the leading country code providers prefix. Not a language, and not content. */
const COUNTRY_PREFIX = /^\s*[a-z]{2,3}\s*\|\s*/i;

/** Quality/format badges that say how a category is encoded, never what it contains. */
const BADGE_TOKENS = /\b(4k|8k|uhd|hd|fhd|sd|hdr|raw|vip|3840p?|2160p?|1080p?|720p?|50fps|60fps|hevc|dolby(?: audio| vision| atmos)?)\b/g;

/**
 * A category that carries no information about its content: a divider row ("#####", "====", a lone
 * emoji), or nothing but quality badges ("4K| UHD 3840p"). Flagged, never hidden or deleted.
 */
function structuralFlag(unstyled: string): CategoryTag | null {
  if (!/[a-z0-9]/i.test(unstyled)) {
    return "separator";
  }
  const withoutBadges = searchable(unstyled.replace(COUNTRY_PREFIX, "")).replace(BADGE_TOKENS, "").replace(/[\s+]+/g, "");
  return withoutBadges.length === 0 ? "junk" : null;
}

export function classifyCategory(rawName: string): CategoryClassification {
  const unstyled = unstyle(rawName);
  const text = searchable(unstyled.replace(COUNTRY_PREFIX, ""));
  const tags = detectTags(searchable(unstyled));

  const structural = structuralFlag(unstyled);
  if (structural !== null) return { genre: null, service: null, language: null, tags: [structural, ...tags] };

  const genre = detectGenre(rawName, text);
  if (genre === "adult") tags.push("adult");

  let service: string | null = null;
  for (const [pattern, name] of SERVICES) {
    if (pattern.test(text)) {
      service = name;
      break;
    }
  }

  return { genre, service, language: detectLanguage(rawName, text), tags: [...new Set(tags)] };
}

/** Tags are stored as a single space-separated column; these two keep that encoding in one place. */
export function encodeTags(tags: readonly CategoryTag[]): string {
  return tags.join(" ");
}

export function decodeTags(stored: string | null): readonly CategoryTag[] {
  if (stored === null || stored === "") return [];
  return stored.split(" ").filter((tag): tag is CategoryTag => (CATEGORY_TAGS as readonly string[]).includes(tag));
}
