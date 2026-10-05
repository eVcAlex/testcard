/** One programme in a guide row, times in epoch ms. */
export interface Airing {
  readonly title: string;
  readonly start: number;
  readonly end: number;
}

/** One stretch of a guide row: a programme, or time the listings do not cover. `loading`: the row has no listings yet. */
export interface GuideSegment {
  readonly start: number;
  readonly end: number;
  readonly airing: Airing | null;
  readonly loading: boolean;
}

/**
 * A row's programmes cut to [from, to), gaps filled so every part of the row can be reached. Null airings (not loaded) give
 * one loading segment. Airings must be in start order; overlaps are trimmed to start where the last ended. Same as the Fire TV
 * app's segmentsFor (apps/tv-native core GuideGrid.kt); test-vectors/guideGrid.json pins both.
 */
export function segmentsFor(airings: readonly Airing[] | null, from: number, to: number): GuideSegment[] {
  if (airings === null) return [{ start: from, end: to, airing: null, loading: true }];
  const out: GuideSegment[] = [];
  let cursor = from;
  for (const airing of airings) {
    if (airing.end <= cursor || airing.start >= to) continue;
    if (airing.start > cursor) out.push({ start: cursor, end: airing.start, airing: null, loading: false });
    const start = Math.max(airing.start, cursor);
    const end = Math.min(airing.end, to);
    out.push({ start, end, airing, loading: false });
    cursor = end;
  }
  if (cursor < to) out.push({ start: cursor, end: to, airing: null, loading: false });
  return out;
}

export interface RailList {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  /** The source this list belongs to, when the rail is sectioned by source. */
  readonly section?: string;
}

export interface RailInput {
  /** The source picked in the source chooser, or null for all. */
  readonly sourceId: string | null;
  readonly sources: readonly { id: string; name: string; channels: number }[];
  /** Categories per source id in provider order; the key "" holds the categories across every source. */
  readonly categories: Readonly<Record<string, readonly { id: string; label: string; count: number }[]>>;
  readonly favourites: number;
  readonly recents: number;
}

/**
 * The lists a Live TV guide offers: Favourites and Recently watched (combined across sources), then, with several sources and
 * none picked, one section per source (its own "All channels" then its categories), else the categories then "All channels".
 * Empty categories are left out. Mirrors the Fire TV rail (Guide.kt).
 */
export function railLists(input: RailInput): RailList[] {
  const out: RailList[] = [
    { id: "favourites", label: "Favourites", count: input.favourites },
    { id: "recent", label: "Recently watched", count: input.recents },
  ];
  const withChannels = input.sources.filter((s) => s.channels > 0);
  if (input.sourceId === null && withChannels.length > 1) {
    for (const source of withChannels) {
      const own = (input.categories[source.id] ?? []).filter((c) => c.count > 0);
      if (own.length === 0) continue;
      out.push({ id: `all:${source.id}`, label: "All channels", count: own.reduce((n, c) => n + c.count, 0), section: source.name });
      for (const c of own) out.push({ id: c.id, label: c.label, count: c.count, section: source.name });
    }
    return out;
  }
  const all = input.categories[input.sourceId ?? ""] ?? [];
  for (const c of all) if (c.count > 0) out.push({ id: c.id, label: c.label, count: c.count });
  out.push({ id: "all", label: "All channels", count: all.reduce((n, c) => n + c.count, 0) });
  return out;
}

/** The list the guide opens on: an earlier pick while it still exists, else Favourites, Recently watched, then everything. */
export function startList(lists: readonly RailList[], picked: string | null): string {
  return (
    lists.find((l) => l.id === picked)?.id ??
    lists.find((l) => l.id === "favourites" && l.count > 0)?.id ??
    lists.find((l) => l.id === "recent" && l.count > 0)?.id ??
    lists.find((l) => l.id === "all" || l.id.startsWith("all:"))?.id ??
    "all"
  );
}
