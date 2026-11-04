// What a "TV Guide" list is called and how the Live TV rail names it. Pure: the renderer uses this too.

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
  const match = /^\s*([A-Za-z]{2,3})\s*[:|\-]\s*/.exec(rawName);
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
