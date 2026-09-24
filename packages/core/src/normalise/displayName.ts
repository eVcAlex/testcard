import { dropVariantMarks } from "./parseName.js";

/**
 * A provider's channel or category name made readable, whatever the provider's house style: its country
 * or language prefix ("UK: ", "[UK] ", "|EN| ", "USA - "), decorative borders and symbols ("★★ ... ★★",
 * "--- ... ---"), its own branding tag in superscript ("TNT Sports ᴳᴬᴺᴶᴬ") and fancy lettering ("𝐁𝐁𝐂",
 * "ʙʙᴄ ᴏɴᴇ") all go, and SHOUTING becomes Title Case with acronyms left alone ("BBC One HD", not "Bbc One Hd").
 *
 * Quality tags are kept as ordinary text ("Movies ⁴ᴷ" → "Movies 4K", "4K| Sky Sports" → "Sky Sports 4K"),
 * since they tell apart channels and categories that are otherwise the same and some viewers can't play 4K.
 *
 * Display only. Channel ids key on `parseName`, never on this, so these rules can change without orphaning
 * anyone's favourites. Bump `DISPLAY_NAME_VERSION` when a rule changes so stored channel names are redone on next open.
 */
export const DISPLAY_NAME_VERSION = 1;

export function displayName(rawName: string): string {
  let text = unstyleOrDropTags(rawName).normalize("NFKC");
  text = trimDecoration(text);
  let qualityPrefix = "";
  for (let i = 0; i < 3; i++) {
    const prefix = leadingPrefix(text);
    if (prefix === undefined) break;
    if (QUALITY.test(prefix.token)) qualityPrefix = prefix.token.toUpperCase();
    text = trimDecoration(text.slice(prefix.length));
  }
  if (qualityPrefix !== "" && !new RegExp(`\\b${qualityPrefix}\\b`, "i").test(text)) text = `${text} ${qualityPrefix}`;
  text = text.replace(/\s+/g, " ").trim();
  if (!/[\p{L}\p{N}]/u.test(text)) text = unstyle(rawName).normalize("NFKC").replace(/\s+/g, " ").trim();
  return calmShouting(text);
}

/** A channel's name, less the quality or "(OFFLINE)" mark that makes it one Variant of the channel rather than another. */
export function channelDisplayName(rawName: string): string {
  return displayName(dropVariantMarks(rawName));
}

// ---------------------------------------------------------------------------------------------
// styled lettering

/** Small capitals, which Unicode (and NFKC) treats as their own letters, as the capitals they look like. */
const SMALL_CAPS = new Map([..."ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡʏᴢ"].map((glyph, at) => [glyph, "ABCDEFGHIJKLMNOPRSTUVWYZ"[at]!]));
/** Small capitals and superscript letters and digits, the way providers write their tags. */
const STYLED = "\\u1D00-\\u1DBF\\u2070-\\u209F\\u2C7D\\u0299\\u0262\\u029C\\u026A\\u029F\\u0274\\u0280\\u028F\\uA730\\uA731\\u02B0-\\u02B8\\u02E1-\\u02E3";
const STYLED_RUN = new RegExp(`[${STYLED}]+(?:\\s+[${STYLED}]+)*`, "gu");

function unstyle(text: string): string {
  let out = "";
  for (const glyph of text) out += SMALL_CAPS.get(glyph) ?? glyph;
  return out.normalize("NFKC");
}

/**
 * A name written entirely in styled letters is the name, so it is read as plain letters. In a name that
 * also has plain letters, a styled run is a tag: kept when it says something about quality, else dropped.
 */
function unstyleOrDropTags(rawName: string): string {
  // What is left in plain letters once any prefix is set aside: "UK| ʙʙᴄ ᴏɴᴇ" has none.
  const plain = rawName.replace(STYLED_RUN, " ").normalize("NFKC").replace(/^[^\p{L}\p{N}(]+/u, "");
  const prefix = PREFIX.exec(plain);
  const body = prefix !== null && (prefix[3] !== "" || prefix[4] !== "") ? plain.slice(prefix[0].length) : plain;
  if (!/[\p{L}\p{N}]/u.test(body)) return unstyle(rawName);
  return rawName.replace(STYLED_RUN, (run) => {
    const text = unstyle(run).trim();
    return QUALITY.test(text) ? ` ${text} ` : " ";
  });
}

// ---------------------------------------------------------------------------------------------
// prefixes and decoration

const QUALITY_WORD = String.raw`(?:\d*K|UHD|FHD|HDR\d*|HD|SD|\d{3,4}P\d{0,3}|\d{2,3}FPS|HEVC|H\.?265)`;
const QUALITY = new RegExp(`^${QUALITY_WORD}(?:[\\s/+]+${QUALITY_WORD})*$`, "i");

/** Three-letter codes taken as a country or language when they lead a name; any two letters are, bar these. */
const THREE_LETTER_CODES = new Set(
  "USA UAE KSA CAN AUS GER DEU ESP SPA FRA ITA POR NED NLD BEL SWE NOR DEN FIN POL TUR IND PAK ARA LAT MEX BRA ARG IRL SCO ENG GBR EUR AFR RUS CHN JPN KOR ALB GRE".split(" "),
);
const NOT_A_CODE = new Set(["TV"]);

/**
 * "UK: ", "[UK] ", "(UK) ", "|UK| ", "UK ● ", "USA - ", "4K| ": a code set off from the rest by a bracket or a
 * separator. A code followed only by a space ("BT Sport", "US ESPN") is left, since it may be the name itself.
 */
const PREFIX = /^([[(|]?)\s*([A-Za-z0-9]{2,4})\s*([\])|]?)\s*([|:\-–—●•·★☆»›>┃│~/]*)\s*/;

function leadingPrefix(text: string): { token: string; length: number } | undefined {
  const match = PREFIX.exec(text);
  if (match === null) return undefined;
  const [whole, open, token = "", close, separator] = match;
  if (close === "" && separator === "") return undefined;
  if (open === "(" && close !== ")") return undefined;
  const code = token.toUpperCase();
  const isCode = /^[A-Z]+$/.test(code) && (code.length === 2 ? !NOT_A_CODE.has(code) : THREE_LETTER_CODES.has(code));
  if (!isCode && !QUALITY.test(token) && code !== "VIP") return undefined;
  // Nothing after it: the "prefix" is the whole name.
  if (!/[\p{L}\p{N}]/u.test(text.slice(whole.length))) return undefined;
  return { token, length: whole.length };
}

/** Borders, bullets, stars and emoji around a name ("★★ UK ★★", "--- SPORTS ---", "⭐ BBC One ⭐"). */
function trimDecoration(text: string): string {
  return text.replace(/^[^\p{L}\p{N}(]+/u, "").replace(/[^\p{L}\p{N})\]!?+'"%]+$/u, "");
}

// ---------------------------------------------------------------------------------------------
// case

/** Short all-capital words that are ordinary words, not acronyms. */
const SHORT_WORDS = new Set(
  "A AN THE AND OR OF IN ON AT TO BY FOR ONE TWO SIX TEN NEW OLD TOP ALL BIG HOT FUN BOX MAX NOW GOD LAW WAR SKY ART CAR PET DOG CAT KID MEN WAY OUT OFF DAY RED ZEE GO MY ME WE HIS HER YES NO".split(" "),
);
/** Longer acronyms that stay in capitals. */
const ACRONYMS = new Set("ESPN UEFA FIFA DAZN CNBC MSNBC HGTV NBCSN HEVC NASA WWE PPV UFC MUTV LFCTV BBC ITV STV RTE CNN".split(" "));

/** A name in all capitals turned into Title Case, keeping acronyms and codes ("BBC", "4K", "TF1", "HD"). */
function calmShouting(text: string): string {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4 || letters !== letters.toUpperCase()) return text;
  return text.replace(/[A-Za-z]+/g, (word, at: number) => {
    const touchesDigit = /\d/.test(text[at - 1] ?? "") || /\d/.test(text[at + word.length] ?? "");
    if (touchesDigit || ACRONYMS.has(word) || (word.length <= 3 && !SHORT_WORDS.has(word))) return word;
    return word[0] + word.slice(1).toLowerCase();
  });
}

// ---------------------------------------------------------------------------------------------
// the same channel in another quality

const TRAILING_QUALITY = new RegExp(`(?:[\\s\\-|/+]*[([]?${QUALITY_WORD}[)\\]]?)+$`, "i");

/**
 * What a channel's display name has in common with its other qualities: "BBC One HD", "BBC One 4K" and "BBC One"
 * all give "bbc one". Used to find another way to watch a channel whose stream won't play.
 */
export function sameChannelKey(displayed: string): string {
  const base = displayed.replace(TRAILING_QUALITY, "").replace(/\s+/g, " ").trim().toLowerCase();
  return base === "" ? displayed.trim().toLowerCase() : base;
}

/**
 * Which of a channel's qualities to try first when another has failed: HD first (the most likely to play and
 * still look good), then an unmarked one, then SD, and 4K last, since it is the one most likely to be what failed.
 */
export function fallbackRank(displayed: string): number {
  const tail = TRAILING_QUALITY.exec(displayed)?.[0].toUpperCase() ?? "";
  if (/\b(?:\d*K|UHD|2160P?\d*)\b/.test(tail)) return 3;
  if (/\bSD\b|\b(?:480|576)P/.test(tail)) return 2;
  if (/\b(?:FHD|HD|1080P?\d*|720P?\d*)\b/.test(tail)) return 0;
  return 1;
}
