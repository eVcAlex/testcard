/**
 * IPTV providers prefix every title with a catalogue tag ("4K-TOP - Corina (2025)") and suffix the
 * year. Neither belongs in the title a person reads: the year is metadata, and a 4K tag is the
 * only prefix worth surfacing.
 */
export interface TitleParts {
  readonly title: string;
  readonly year: string | null;
  readonly is4k: boolean;
}

const PREFIX = /^([A-Z0-9][A-Z0-9+&]*(?:-[A-Z0-9+&]+)*)\s+-\s+/;
const YEAR = /\s*\((\d{4})\)\s*$/;

export function splitTitle(name: string): TitleParts {
  let rest = name.trim();
  let is4k = false;

  const prefix = PREFIX.exec(rest);
  if (prefix && prefix[1] !== undefined && prefix[1].length <= 12) {
    is4k = prefix[1].includes("4K");
    rest = rest.slice(prefix[0].length);
  }

  let year: string | null = null;
  const yearMatch = YEAR.exec(rest);
  if (yearMatch && yearMatch[1] !== undefined) {
    year = yearMatch[1];
    rest = rest.slice(0, yearMatch.index);
  }

  return { title: rest.trim() || name.trim(), year, is4k };
}
