import { splitTitle } from "./splitTitle.js";

/**
 * The same title in another quality, category or source: lower-cased, punctuation, the catalogue tag and a chart
 * rank ("42. Dune") gone, the year kept. "EN - Dune (2021)", "4K-EN - Dune  (2021)" and "TOP - 3. Dune (2021)"
 * share a key.
 */
export function titleKey(name: string): string {
  const { title, year } = splitTitle(name);
  const bare = title.replace(/^\d{1,3}\.\s+/, "");
  return `${bare.toLowerCase().replace(/[^a-z0-9À-￿]+/g, " ").trim()}|${year ?? ""}`;
}

/**
 * Whether two names can safely be treated as one title. Only when they carry a year: without one, a name is often
 * a running show's episode ("WWE SmackDown", eighty times over, each a different night), not a copy of the same thing.
 */
export function isDatedTitle(name: string): boolean {
  return splitTitle(name).year !== null;
}

/**
 * The list with later copies of a dated title dropped. The first one met is kept, so the caller's order decides which
 * copy shows, except that a 4K copy takes the place of one that is not. Undated names are all kept, unless `undated`
 * is set, which is for series: a series' name is the show itself, not one of its episodes. Stops at `limit` when given.
 */
export function dedupeTitles<T extends { readonly name: string }>(rows: readonly T[], limit = Infinity, { undated = false } = {}): T[] {
  const kept = new Map<string, number>(); // key -> where its copy sits in `out`
  const out: T[] = [];
  for (const row of rows) {
    if (undated || isDatedTitle(row.name)) {
      const key = titleKey(row.name);
      const at = kept.get(key);
      if (at !== undefined) {
        if (splitTitle(row.name).is4k && !splitTitle(out[at]!.name).is4k) out[at] = row;
        continue;
      }
      kept.set(key, out.length);
    }
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}
