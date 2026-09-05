/**
 * The shared parser behind three features at once: FTS5 search indexing, quality-variant
 * grouping, and the country sidebar tree. One pass over a raw channel/category name, feeding
 * all three — see CONTEXT.md "Normalised name".
 *
 * Built directly against real names pulled from the target provider, e.g.:
 *   "UK| TNT Sports ᴳᴬᴺᴶᴬ"
 *   "Sky Sports Main Event ᵁᴴᴰ ᴴᴰᴿ"
 *   "TNT Sports 1 (1080p50)"
 *   "TNT Sports Ultimate (OFFLINE)"
 *   "##### PPV HD/4K #####"
 */

export interface ParsedName {
  /** Cleaned display/search name: no country prefix, no quality suffix, no styling glyphs. */
  readonly normalised: string;
  /** Leading "XX|" country code, if present, uppercased. */
  readonly country?: string;
  /** Parsed resolution/framerate label, e.g. "1080p50", if a "(...)" quality suffix was found. */
  readonly quality?: string;
  readonly isOffline: boolean;
}

// Unicode "styled" letter blocks providers use for eye-catching category/channel names
// (mathematical alphanumeric symbols: bold, sans-serif, superscript-style small caps, etc).
// Matches ᵁᴴᴰ, ᴳᴬᴺᴶᴬ, ᴴᴰᴿ and similar — anything outside normal ASCII/Latin-1 letters,
// digits, punctuation and whitespace that isn't otherwise meaningful.
const STYLED_GLYPH = /[ᴀ-ᵿᶀ-ᶿ⁰-₟Ⱡ-Ɀ꜀-ꟿ]/gu;

// Decorative border characters some providers wrap PPV/event names in, e.g. "##### ... #####".
const DECORATIVE_BORDER = /^[#*~=\-\s]+|[#*~=\-\s]+$/g;

const COUNTRY_PREFIX = /^([A-Za-z]{2,3})\s*\|\s*/;

const OFFLINE_SUFFIX = /\(\s*offline\s*\)/gi;

// Quality suffix: "(1080p50)", "(720p25)", "(4K)", "(UHD)", "(FHD)", "(HD)", "(SD)".
const QUALITY_SUFFIX =
  /\(\s*((?:\d{3,4}p\d{0,3})|4k|uhd|fhd|hd|sd)\s*\)/gi;

const EMOJI_AND_SYMBOLS =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;

export function parseName(raw: string): ParsedName {
  let working = raw.trim();

  let country: string | undefined;
  const countryMatch = COUNTRY_PREFIX.exec(working);
  if (countryMatch?.[1] !== undefined) {
    country = countryMatch[1].toUpperCase();
    working = working.slice(countryMatch[0].length);
  }

  const isOffline = OFFLINE_SUFFIX.test(working);
  OFFLINE_SUFFIX.lastIndex = 0;
  working = working.replace(OFFLINE_SUFFIX, "");

  let quality: string | undefined;
  const qualityMatch = QUALITY_SUFFIX.exec(working);
  QUALITY_SUFFIX.lastIndex = 0;
  if (qualityMatch?.[1] !== undefined) {
    quality = qualityMatch[1].toLowerCase();
    working = working.replace(QUALITY_SUFFIX, "");
  }

  working = working
    .replace(STYLED_GLYPH, "")
    .replace(EMOJI_AND_SYMBOLS, "")
    .replace(DECORATIVE_BORDER, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    normalised: working,
    ...(country !== undefined ? { country } : {}),
    ...(quality !== undefined ? { quality } : {}),
    isOffline,
  };
}
