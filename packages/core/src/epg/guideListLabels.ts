// What a "TV Guide" list is called and how the Live TV rail names it. Pure: the renderer uses this too.
import { categoryDisplayName } from "../normalise/displayName.js";

/** A country that has "TV Guide" channels, and how many (one per station: its qualities and copies are counted once). */
export interface GuideCountry {
  readonly country: string;
  readonly count: number;
}

const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  US: "USA", UK: "UK", GB: "UK", CA: "Canada", AU: "Australia", IE: "Ireland", NZ: "New Zealand", DE: "Germany", FR: "France", ES: "Spain",
  IT: "Italy", NL: "Netherlands", PT: "Portugal", PL: "Poland", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", BE: "Belgium",
  CH: "Switzerland", AT: "Austria", GR: "Greece", TR: "Turkey", BR: "Brazil", MX: "Mexico", IN: "India", ZA: "South Africa",
};

/**
 * A country code the "TV Guide" lists know, in its one spelling ("GB" is "UK"), or null for anything else: a prefix such as
 * "NBA", "PRIME" or "VIP" is a league or a service, not a country, and must not become a list of its own.
 */
export function guideCountryOf(code: string | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const upper = code.trim().toUpperCase();
  const known = upper === "GB" ? "UK" : upper;
  return Object.prototype.hasOwnProperty.call(COUNTRY_NAMES, known) ? known : null;
}

/** "UK: BBC One", "US - NBC" or "CA| CTV": the country a provider put in front of a channel's name, when it is a known one. */
export function guideCountryFromName(rawName: string): string | null {
  const match = /^\s*([A-Za-z]{2,3})\s*[:|-]\s*/.exec(rawName);
  return match?.[1] === undefined ? null : guideCountryOf(match[1]);
}

/**
 * The country a channel's "TV Guide" list is by: its own parsed one, else its category's ("UK| SPORT"), else a prefix of its
 * name. Providers write the country in different places, and the stored `channels.country` only knows the `XX|` form.
 */
export function channelGuideCountry(channelCountry: string | null, categoryCountry: string | null, rawName: string): string | null {
  return guideCountryOf(channelCountry) ?? guideCountryOf(categoryCountry) ?? guideCountryFromName(rawName);
}

/** The flag of a two-letter country code ("UK" is read as GB), or nothing for anything else. */
function flagOf(country: string): string {
  const code = country.toUpperCase() === "UK" ? "GB" : country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/** The name a "TV Guide" list goes by: "🇬🇧 TV Guide (UK)". A country it has no name for shows as its own code. */
export function guideListLabel(country: string): string {
  const flag = flagOf(country);
  return `${flag === "" ? "" : `${flag} `}TV Guide (${COUNTRY_NAMES[country.toUpperCase()] ?? country})`;
}

/** The rail section the "TV Guide" lists sit under. */
export const GUIDE_SECTION = "TV Guide";

const GUIDE_PREFIX = "guide:";

/** The id of a "TV Guide" list in the Live TV rail: `guide:UK`, or `guide:UK@<source>` inside one source's section. */
export const guideListId = (country: string, sourceId?: string): string => `${GUIDE_PREFIX}${country}${sourceId !== undefined ? `@${sourceId}` : ""}`;

/** Reads a rail list id back, or null when it is not a "TV Guide" list. */
export function parseGuideListId(id: string): { country: string; sourceId?: string } | null {
  if (!id.startsWith(GUIDE_PREFIX)) return null;
  const rest = id.slice(GUIDE_PREFIX.length);
  const at = rest.indexOf("@");
  return at < 0 ? { country: rest } : { country: rest.slice(0, at), sourceId: rest.slice(at + 1) };
}

/** The heading of a country's section in the Live TV rail: "🇬🇧 UK", or "Other" for a category with no known country. */
export function guideCountryHeading(country: string | null): string {
  if (country === null) return "Other";
  const flag = flagOf(country);
  return `${flag === "" ? "" : `${flag} `}${COUNTRY_NAMES[country.toUpperCase()] ?? country}`;
}

/** A group of the provider's categories that read as one ("UK| SPORT ᴴᴰ", "UK| SPORT ᴿᴬᵂ", "UK| SPORT ʰᵉᵛᶜ"): a tidy list of the rail. */
export interface TidyCategory {
  /** `tidy:` and its categories' ids (`tidyCategoryId`). */
  readonly id: string;
  readonly label: string;
  /** A known country (`guideCountryOf`), or null. */
  readonly country: string | null;
  /** An events / pay-per-view group. */
  readonly ppv: boolean;
  /** Stations in the list: each is counted once, whatever quality or category it was filed under. */
  readonly count: number;
}

const TIDY_PREFIX = "tidy:";
const TIDY_SEPARATOR = "\u001f";

/** The id of a tidy list: the ids of the provider categories it gathers. */
export const tidyCategoryId = (categoryIds: readonly string[]): string => `${TIDY_PREFIX}${categoryIds.join(TIDY_SEPARATOR)}`;

/** Reads a tidy list's id back to its categories' ids, or null when it is not one. */
export function parseTidyCategoryId(id: string): string[] | null {
  return id.startsWith(TIDY_PREFIX) ? id.slice(TIDY_PREFIX.length).split(TIDY_SEPARATOR) : null;
}

/** Quality, source and styling words a provider hangs on the end of a category's name; they tell its copies apart, not its subject. */
const CATEGORY_TAIL = /(?:[\s/|+-]+(?:HD|SD|FHD|UHD|4K|8K|HEVC|H\.?265|RAW|VIP|\d+\s?FPS|\d{3,4}P))+\s*$/i;
const PPV_TAIL = /[\s/|+-]*\bPPV\b[\s/|+-]*$/i;

/**
 * A provider category's name as its tidy list is called: the country prefix and styling go (the rail's section says the
 * country), and so do trailing quality words, so a category's HD, RAW and HEVC copies share one name. In a PPV list a trailing "PPV"
 * goes too (the section says so). Never empty: a name that is only such words stays as `categoryDisplayName` has it.
 */
export function tidyCategoryLabel(rawName: string, ppv: boolean): string {
  const base = categoryDisplayName(rawName).trim();
  let label = base;
  for (;;) {
    const next = label.replace(CATEGORY_TAIL, "").trim();
    if (next === label || next === "") break;
    label = next;
  }
  if (ppv) label = label.replace(PPV_TAIL, "").trim() || label;
  return label === "" ? base : label;
}
