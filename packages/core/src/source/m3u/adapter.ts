import type { Category, Source, SourceAdapter } from "../types.js";
import { groupVariants, type RawChannelEntry } from "../../normalise/groupVariants.js";
import { parseM3U } from "./parseM3U.js";

/**
 * The M3U path is a fallback for providers `xtream/detect.ts` can't extract credentials for.
 * Unlike the Xtream adapter it must fetch and parse the *whole* playlist to get categories
 * (M3U has no "list categories" call), but streams it rather than buffering — see `parseM3U`.
 */
export function createM3UAdapter(): SourceAdapter {
  async function loadEntries(source: Source): Promise<{
    categories: Map<string, Category>;
    entriesByCategory: Map<string, RawChannelEntry[]>;
  }> {
    if (source.kind !== "m3u") throw new Error(`createM3UAdapter used with a non-m3u source: ${source.kind}`);

    const response = await fetch(source.playlistUrl);
    if (!response.ok || response.body === null) {
      throw new Error(`Failed to fetch playlist: HTTP ${response.status}`);
    }

    const categories = new Map<string, Category>();
    const entriesByCategory = new Map<string, RawChannelEntry[]>();

    for await (const item of parseM3U(response.body)) {
      if (item.kind === "header") continue;

      const rawCategoryName = item.entry.groupTitle ?? "Uncategorised";
      let category = categories.get(rawCategoryName);
      if (!category) {
        category = {
          id: `${source.id}:cat:${rawCategoryName}`,
          sourceId: source.id,
          providerId: rawCategoryName,
          rawName: rawCategoryName,
        };
        categories.set(rawCategoryName, category);
        entriesByCategory.set(category.id, []);
      }

      const attrs = item.entry.attributes;
      const catchupType = attrs["catchup-type"];
      const catchupDays = attrs["catchup-days"];

      entriesByCategory.get(category.id)?.push({
        sourceId: source.id,
        categoryId: category.id,
        // M3U has no numeric stream id — the URL itself is the stable provider handle.
        providerStreamId: item.entry.url,
        rawName: item.entry.rawName,
        ...(attrs["tvg-logo"] !== undefined ? { logoUrl: attrs["tvg-logo"] } : {}),
        ...(attrs["tvg-chno"] !== undefined && !Number.isNaN(Number(attrs["tvg-chno"]))
          ? { channelNumber: Number(attrs["tvg-chno"]) }
          : {}),
        ...(catchupType !== undefined
          ? { catchup: { type: catchupType, days: catchupDays !== undefined ? Number(catchupDays) : 0 } }
          : {}),
      });
    }

    return { categories, entriesByCategory };
  }

  return {
    kind: "m3u",

    async fetchCategories(source) {
      const { categories } = await loadEntries(source);
      return [...categories.values()];
    },

    async fetchChannels(source, category) {
      const { entriesByCategory } = await loadEntries(source);
      const entries = entriesByCategory.get(category.id) ?? [];
      return groupVariants(entries, (key) => `${source.id}:${key}`);
    },

    async buildStreamUrl(_source, variant) {
      // For M3U, providerStreamId *is* the direct stream URL captured at parse time.
      return variant.providerStreamId;
    },

    async *importAll(source) {
      // Single fetch + single streaming parse pass — the whole reason this method exists
      // instead of composing fetchCategories/fetchChannels, see the interface doc comment.
      const { categories, entriesByCategory } = await loadEntries(source);
      for (const category of categories.values()) {
        const entries = entriesByCategory.get(category.id) ?? [];
        yield { category, channels: groupVariants(entries, (key) => `${source.id}:${key}`) };
      }
    },
  };
}
