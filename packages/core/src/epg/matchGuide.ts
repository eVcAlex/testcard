import { channelDisplayName, sameChannelKey } from "../normalise/displayName.js";

/** One channel the guide describes: XMLTV's `<channel id>` and its `<display-name>`s. */
export interface GuideChannel {
  readonly id: string;
  readonly names: readonly string[];
}

/** The part of a Channel the matcher needs. */
export interface MatchableChannel {
  readonly id: string;
  readonly rawName: string;
  /** Parsed `XX|` country (`UK`, `US`), or null. */
  readonly country: string | null;
  /** The playlist's own `tvg-id`, possibly empty or one the guide does not know. */
  readonly tvgId: string | null;
}

export type GuideMatchMethod = "name" | "alias";

export interface GuideMatch {
  readonly guideId: string;
  readonly method: GuideMatchMethod;
}

export interface GuideMatchResult {
  /** Channels given a guide id they did not have: channel id to match. Never includes a channel whose own `tvg-id` works. */
  readonly matches: ReadonlyMap<string, GuideMatch>;
  readonly stats: GuideMatchStats;
}

export interface GuideMatchStats {
  readonly channels: number;
  /** Already linked by their own `tvg-id`: left alone. */
  readonly exact: number;
  /** Linked by this matcher. */
  readonly matched: number;
  /** More than one guide channel fits and nothing tells them apart: left unlinked rather than guessed. */
  readonly ambiguous: number;
  /** No guide channel fits. */
  readonly unmatched: number;
}

export interface MatchGuideOptions {
  /** Curated corrections: a channel's `guideKey` to a guide id. Used before names, and only when the guide has that id. */
  readonly aliases?: ReadonlyMap<string, string>;
}

/**
 * A name reduced to what two spellings of one channel share: quality words and styling gone (the same cleaning Channel
 * variants and Channel feeds use), then lower case letters and digits only, "&" read as "and", "+1" kept apart from "1".
 */
export function guideKey(name: string): string {
  const base = sameChannelKey(channelDisplayName(name));
  return base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\+\s*(\d)/g, " plus$1 ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Guide ids often end in the market: "BBCOne.uk", "CNN.us". `gb` is read as `uk`. */
function marketOf(guideId: string): string | null {
  const suffix = /[.\-_]([a-z]{2})$/i.exec(guideId)?.[1]?.toLowerCase();
  if (suffix === undefined) return null;
  return suffix === "gb" ? "uk" : suffix;
}

function countryOf(country: string | null): string | null {
  if (country === null) return null;
  const lower = country.toLowerCase();
  return lower === "gb" ? "uk" : lower;
}

/**
 * Finds a guide channel for every playlist channel whose own `tvg-id` does not link to the guide.
 *
 * Conservative on purpose, because a wrong guide is worse than none: a channel with a working `tvg-id` is never
 * touched; otherwise only a curated alias, or a name that matches exactly once the cleaning above is applied. When
 * several guide channels fit, the channel's country picks between them if it can; if not, the channel is counted as
 * ambiguous and left unlinked. Nothing here changes a channel, its stream or its place in any list: the result only
 * says which guide id to read its listings from.
 */
export function matchGuide(
  channels: readonly MatchableChannel[],
  guide: readonly GuideChannel[],
  options: MatchGuideOptions = {},
): GuideMatchResult {
  const guideIds = new Set(guide.map((entry) => entry.id));
  const byKey = new Map<string, Set<string>>();
  for (const entry of guide) {
    for (const name of entry.names) {
      const key = guideKey(name);
      if (key === "") continue;
      const ids = byKey.get(key);
      if (ids === undefined) byKey.set(key, new Set([entry.id]));
      else ids.add(entry.id);
    }
  }

  const matches = new Map<string, GuideMatch>();
  let exact = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const channel of channels) {
    if (channel.tvgId !== null && channel.tvgId !== "" && guideIds.has(channel.tvgId)) {
      exact += 1;
      continue;
    }
    const key = guideKey(channel.rawName);
    if (key === "") {
      unmatched += 1;
      continue;
    }

    const alias = options.aliases?.get(key);
    if (alias !== undefined && guideIds.has(alias)) {
      matches.set(channel.id, { guideId: alias, method: "alias" });
      continue;
    }

    const found = byKey.get(key);
    if (found === undefined) {
      unmatched += 1;
      continue;
    }
    let candidates = [...found];
    if (candidates.length > 1) {
      const country = countryOf(channel.country);
      if (country !== null) {
        const sameMarket = candidates.filter((id) => marketOf(id) === country);
        // A guide id with no market suffix is not ruled out; one for another market is.
        candidates = sameMarket.length > 0 ? sameMarket : candidates.filter((id) => marketOf(id) === null);
      }
    }
    // Every fit was for another market: as good as no fit.
    if (candidates.length === 0) {
      unmatched += 1;
      continue;
    }
    const only = candidates.length === 1 ? candidates[0] : undefined;
    if (only === undefined) {
      ambiguous += 1;
      continue;
    }
    matches.set(channel.id, { guideId: only, method: "name" });
  }

  return { matches, stats: { channels: channels.length, exact, matched: matches.size, ambiguous, unmatched } };
}
