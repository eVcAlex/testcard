import type { Category, ChannelPage, Source, SourceAdapter } from "../types.js";
import { groupVariants, type RawChannelEntry } from "../../normalise/groupVariants.js";
import { classifyEntry } from "./classifyEntry.js";
import { parseM3U } from "./parseM3U.js";

/** A film found in a playlist. `url` is the direct stream URL (M3U has nothing else to identify it by). */
export interface M3UMovieItem {
  readonly url: string;
  readonly title: string;
  readonly group: string;
  readonly extension: string | null;
  readonly posterUrl?: string;
}

/** One episode found in a playlist, already split into show / season / episode. */
export interface M3UEpisodeItem {
  readonly url: string;
  readonly series: string;
  readonly season: number;
  readonly episode: number;
  readonly title: string;
  readonly group: string;
  readonly extension: string | null;
  readonly posterUrl?: string;
}

/** Everything in a playlist that is not a live channel. */
export interface M3UVodCatalog {
  readonly movies: readonly M3UMovieItem[];
  readonly episodes: readonly M3UEpisodeItem[];
}

/** One fetch and one parse of a playlist, split by what each entry is. */
export interface M3UPlaylist {
  readonly livePages: readonly ChannelPage[];
  readonly vod: M3UVodCatalog;
}

export type M3UAdapter = SourceAdapter & { loadPlaylist(source: Source): Promise<M3UPlaylist> };

/**
 * The M3U path is a fallback for providers `xtream/detect.ts` can't extract credentials for.
 * Unlike the Xtream adapter it must fetch and parse the *whole* playlist to get categories
 * (M3U has no "list categories" call), but streams it rather than buffering — see `parseM3U`.
 */
export function createM3UAdapter(): M3UAdapter {
  async function loadEntries(source: Source): Promise<{
    categories: Map<string, Category>;
    entriesByCategory: Map<string, RawChannelEntry[]>;
    vod: M3UVodCatalog;
  }> {
    if (source.kind !== "m3u") throw new Error(`createM3UAdapter used with a non-m3u source: ${source.kind}`);

    const response = await fetch(source.playlistUrl);
    if (!response.ok || response.body === null) {
      throw new Error(`Failed to fetch playlist: HTTP ${response.status}`);
    }

    const categories = new Map<string, Category>();
    const entriesByCategory = new Map<string, RawChannelEntry[]>();
    const movies: M3UMovieItem[] = [];
    const episodes: M3UEpisodeItem[] = [];

    for await (const item of parseM3U(response.body)) {
      if (item.kind === "header") continue;

      // Films and episodes (recognised from the URL and title) go to the VOD catalogue; only
      // what is left is a live channel.
      const classified = classifyEntry(item.entry);
      if (classified.kind !== "live") {
        const logo = item.entry.attributes["tvg-logo"];
        const common = {
          url: item.entry.url,
          group: item.entry.groupTitle ?? "Uncategorised",
          extension: classified.extension,
          ...(logo !== undefined && logo !== "" ? { posterUrl: logo } : {}),
        };
        if (classified.kind === "movie") {
          movies.push({ ...common, title: classified.title });
        } else {
          episodes.push({ ...common, series: classified.series, season: classified.season, episode: classified.episode, title: classified.title });
        }
        continue;
      }

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
        ...(attrs["tvg-id"] !== undefined && attrs["tvg-id"] !== "" ? { tvgId: attrs["tvg-id"] } : {}),
        ...(attrs["tvg-logo"] !== undefined ? { logoUrl: attrs["tvg-logo"] } : {}),
        ...(attrs["tvg-chno"] !== undefined && !Number.isNaN(Number(attrs["tvg-chno"]))
          ? { channelNumber: Number(attrs["tvg-chno"]) }
          : {}),
        ...(catchupType !== undefined
          ? { catchup: { type: catchupType, days: catchupDays !== undefined ? Number(catchupDays) : 0 } }
          : {}),
      });
    }

    return { categories, entriesByCategory, vod: { movies, episodes } };
  }

  function livePages(
    source: Source,
    categories: Map<string, Category>,
    entriesByCategory: Map<string, RawChannelEntry[]>,
  ): ChannelPage[] {
    return [...categories.values()].map((category) => ({
      category,
      channels: groupVariants(entriesByCategory.get(category.id) ?? [], (key) => `${source.id}:${key}`),
    }));
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

    async probeEpgUrl(source) {
      if (source.kind !== "m3u") return undefined;
      // Only the `#EXTM3U` line is needed — `parseM3U` yields the header first, so read one
      // item and let breaking out of the loop cancel the rest of the download.
      const response = await fetch(source.playlistUrl);
      if (!response.ok || response.body === null) return undefined;
      for await (const item of parseM3U(response.body)) {
        return item.kind === "header" ? item.header.urlTvg : undefined;
      }
      return undefined;
    },

    async loadPlaylist(source) {
      const { categories, entriesByCategory, vod } = await loadEntries(source);
      return { livePages: livePages(source, categories, entriesByCategory), vod };
    },

    async *importAll(source) {
      // Single fetch + single streaming parse pass — the whole reason this method exists
      // instead of composing fetchCategories/fetchChannels, see the interface doc comment.
      const { categories, entriesByCategory } = await loadEntries(source);
      yield* livePages(source, categories, entriesByCategory);
    },
  };
}
