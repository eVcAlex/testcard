import type { RailList } from "../epg/guideGrid.js";

export interface CatalogueRailInput {
  /** The source picked in the source chooser, or null for all. */
  readonly sourceId: string | null;
  readonly sources: readonly { id: string; name: string }[];
  /** Categories per source id in provider order; the key "" holds the categories across every source. */
  readonly categories: Readonly<Record<string, readonly { id: string; label: string; count: number }[]>>;
}

/**
 * The lists a Movies or Series page offers, as the Live TV rail does: Home, then the categories. With several sources and
 * none picked, each source gets a section of its own categories; otherwise one flat list. Empty categories are left out.
 */
export function categoryRail(input: CatalogueRailInput): RailList[] {
  const shown = (key: string) => (input.categories[key] ?? []).filter((c) => c.count > 0);
  const all = shown(input.sourceId ?? "");
  const out: RailList[] = [{ id: "home", label: "Home", count: all.reduce((n, c) => n + c.count, 0) }];
  const sections = input.sourceId === null ? input.sources.filter((s) => shown(s.id).length > 0) : [];
  if (sections.length > 1) {
    for (const source of sections) for (const c of shown(source.id)) out.push({ id: c.id, label: c.label, count: c.count, section: source.name });
  } else {
    for (const c of all) out.push({ id: c.id, label: c.label, count: c.count });
  }
  return out;
}
