import type { Category, ChannelVariant, Source, SourceAdapter } from "../types.js";
import type { XtreamCredentials } from "./detect.js";
import { groupVariants, type RawChannelEntry } from "../../normalise/groupVariants.js";

/** Looks up a Source's credentials from wherever the caller is storing secrets (the OS keychain in the desktop app). */
export type CredentialsLookup = (sourceId: string) => Promise<XtreamCredentials>;

interface XtreamCategoryDTO {
  readonly category_id: string;
  readonly category_name: string;
}

interface XtreamLiveStreamDTO {
  readonly stream_id: number;
  readonly name: string;
  readonly category_id: string;
  readonly stream_icon?: string;
  readonly num?: number;
  readonly epg_channel_id?: string;
  readonly tv_archive?: number;
  readonly tv_archive_duration?: number;
}

function idFor(...parts: string[]): string {
  return parts.join(":");
}

export function createXtreamAdapter(getCredentials: CredentialsLookup): SourceAdapter {
  async function call<T>(source: Source, action: string, params: Record<string, string> = {}): Promise<T> {
    if (source.kind !== "xtream") throw new Error(`createXtreamAdapter used with a non-xtream source: ${source.kind}`);
    const credentials = await getCredentials(source.id);
    const url = new URL(`${credentials.baseUrl}/player_api.php`);
    url.searchParams.set("username", credentials.username);
    url.searchParams.set("password", credentials.password);
    url.searchParams.set("action", action);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Xtream ${action} failed: HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  return {
    kind: "xtream",

    async fetchCategories(source) {
      const dtos = await call<XtreamCategoryDTO[]>(source, "get_live_categories");
      return dtos.map(
        (dto): Category => ({
          id: idFor(source.id, dto.category_id),
          sourceId: source.id,
          providerId: dto.category_id,
          rawName: dto.category_name,
        }),
      );
    },

    async fetchChannels(source, category) {
      const dtos = await call<XtreamLiveStreamDTO[]>(source, "get_live_streams", {
        category_id: category.providerId,
      });

      const entries: RawChannelEntry[] = dtos.map((dto) => ({
        sourceId: source.id,
        categoryId: category.id,
        providerStreamId: String(dto.stream_id),
        rawName: dto.name,
        ...(dto.epg_channel_id !== undefined && dto.epg_channel_id !== "" ? { tvgId: dto.epg_channel_id } : {}),
        ...(dto.stream_icon !== undefined && dto.stream_icon !== "" ? { logoUrl: dto.stream_icon } : {}),
        ...(dto.num !== undefined ? { channelNumber: dto.num } : {}),
        ...(dto.tv_archive === 1
          ? { catchup: { type: "xtream", days: dto.tv_archive_duration ?? 0 } }
          : {}),
      }));

      return groupVariants(entries, (key) => idFor(source.id, key));
    },

    async buildStreamUrl(source, variant: ChannelVariant) {
      if (source.kind !== "xtream") throw new Error("buildStreamUrl(xtream) used with a non-xtream source");
      const credentials = await getCredentials(source.id);
      // Standard Xtream live stream URL shape; container is usually .ts for live channels.
      return `${credentials.baseUrl}/live/${credentials.username}/${credentials.password}/${variant.providerStreamId}.ts`;
    },

    async probeEpgUrl(source) {
      if (source.kind !== "xtream") return undefined;
      // Full XMLTV for the account. Credential-bearing — the caller fetches it and must not
      // persist or log it (same contract as buildStreamUrl).
      const credentials = await getCredentials(source.id);
      const url = new URL(`${credentials.baseUrl}/xmltv.php`);
      url.searchParams.set("username", credentials.username);
      url.searchParams.set("password", credentials.password);
      return url.toString();
    },

    async *importAll(source) {
      // Each call below is already a cheap, independent player_api.php request — unlike the
      // M3U adapter there's no whole-playlist re-fetch to avoid, so this is a thin wrapper.
      const categories = await this.fetchCategories(source);
      for (const category of categories) {
        const channels = await this.fetchChannels(source, category);
        yield { category, channels };
      }
    },
  };
}

/** Fetches now/next EPG for a single stream. Kept separate from SourceAdapter — it's read on demand per row, not during import. */
export async function fetchShortEpg(
  source: Source,
  streamId: string,
  getCredentials: CredentialsLookup,
): Promise<{ readonly title: string; readonly start: Date; readonly end: Date }[]> {
  if (source.kind !== "xtream") throw new Error("fetchShortEpg used with a non-xtream source");
  const credentials = await getCredentials(source.id);
  const url = new URL(`${credentials.baseUrl}/player_api.php`);
  url.searchParams.set("username", credentials.username);
  url.searchParams.set("password", credentials.password);
  url.searchParams.set("action", "get_short_epg");
  url.searchParams.set("stream_id", streamId);
  url.searchParams.set("limit", "2");

  const response = await fetch(url.toString());
  if (!response.ok) return [];
  const body = (await response.json()) as {
    epg_listings?: readonly { title: string; start_timestamp: string; stop_timestamp: string }[];
  };

  return (body.epg_listings ?? []).map((listing) => ({
    title: base64Decode(listing.title),
    start: new Date(Number(listing.start_timestamp) * 1000),
    end: new Date(Number(listing.stop_timestamp) * 1000),
  }));
}

// Xtream base64-encodes EPG text fields. Uses the web-standard atob (available globally in
// Node 18+ and in the renderer) rather than Buffer, so this file stays portable.
function base64Decode(value: string): string {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return value;
  }
}
