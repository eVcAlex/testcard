import { splitTitle } from "@testcard/core/src/normalise/splitTitle.js";

/** "4K-OSN+ - Show (2021) (US) - S01E02 - Little Black Dress" -> "Little Black Dress". Names without the pattern are left alone. */
export function episodeTitle(name: string): string {
  const match = /\bS\d{1,3}E\d{1,3}\s*-\s*(.+)$/i.exec(name);
  return match?.[1] !== undefined && match[1].trim() !== "" ? match[1].trim() : name;
}

/** A series' name without the provider's catalogue tag or year. */
export function seriesTitle(name: string): string {
  // "Show (2021) (US)": the year and a country code trail the name.
  return splitTitle(name).title.replace(/(\s*\((?:\d{4}|[A-Z]{2,3})\))+$/, "").trim();
}

/** What the player shows for a film or episode: "Show · Episode title" for an episode, the plain title for a film. */
export function playerTitle(name: string): string {
  const match = /^(.*?)\s*-\s*S\d{1,3}E\d{1,3}\s*-\s*(.+)$/i.exec(name);
  if (match?.[1] !== undefined && match[2] !== undefined) return `${seriesTitle(match[1])} · ${match[2].trim()}`;
  return splitTitle(name).title;
}
