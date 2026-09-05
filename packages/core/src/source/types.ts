/**
 * The normalised domain model. Every source adapter (Xtream, M3U, and eventually Stalker)
 * must produce these shapes — nothing downstream of `source/*` should know or care which
 * kind of provider a Channel came from.
 *
 * Zero Electron, zero React, zero Node-only APIs in this file or anywhere in `packages/core`:
 * this is the one part of the codebase a future Android/Firestick app would reuse.
 */

/** One configured provider account. */
export type Source =
  | {
      readonly id: string;
      readonly kind: "xtream";
      readonly name: string;
      readonly baseUrl: string;
      /** Credentials are looked up from the OS keychain by `id` — never stored here. */
    }
  | {
      readonly id: string;
      readonly kind: "m3u";
      readonly name: string;
      readonly playlistUrl: string;
      readonly epgUrl?: string;
    };

export type SourceKind = Source["kind"];

/** A provider's raw group-title, before any country/tree parsing. */
export interface Category {
  readonly id: string;
  readonly sourceId: string;
  /** Provider-assigned category id (Xtream `category_id`), for re-fetching. */
  readonly providerId: string;
  readonly rawName: string;
}

/**
 * One concrete stream a provider offers — a specific resolution/framerate a Channel is
 * available at. Providers routinely ship the same channel as many playlist entries
 * differing only by variant (e.g. "TNT Sports 1 (1080p50)", "... (720p25)", ...);
 * grouping those into one Channel is a normalisation step, see `normalise/`.
 */
export interface ChannelVariant {
  readonly id: string;
  readonly sourceId: string;
  /** Provider-assigned stream id, used to rebuild the playback URL and for re-matching on refresh. */
  readonly providerStreamId: string;
  /** Raw label as parsed from the entry, e.g. "1080p50". Undefined when no variant info was present. */
  readonly quality?: string;
  readonly isOffline: boolean;
}

/**
 * One logical live-TV channel as a human thinks of it. Has a stable internal id that
 * survives playlist refreshes (see `normalise/matchChannel`), independent of any id a
 * provider assigns.
 */
export interface Channel {
  readonly id: string;
  readonly sourceId: string;
  readonly categoryId: string;
  /** Display name with unicode styling and quality suffixes stripped. Feeds search + grouping. */
  readonly normalisedName: string;
  /** Name exactly as the provider sent it, for display when normalisation looks wrong. */
  readonly rawName: string;
  /** Parsed leading country prefix ("UK", "CA"), when the raw category/name had one. */
  readonly country?: string;
  readonly logoUrl?: string;
  readonly channelNumber?: number;
  readonly variants: readonly ChannelVariant[];
  readonly catchup?: {
    readonly type: string;
    readonly days: number;
  };
}

/** One EPG entry for a Channel. */
export interface Programme {
  readonly channelId: string;
  readonly title: string;
  readonly start: Date;
  readonly end: Date;
  readonly description?: string;
}

/** The current and following Programme for a channel, resolved at read time — never stored. */
export interface NowNext {
  readonly now?: Programme;
  readonly next?: Programme;
}

/** A page of channels within a category, as returned by a source adapter. */
export interface ChannelPage {
  readonly category: Category;
  readonly channels: readonly Channel[];
}

/** Everything a source adapter must implement, regardless of provider protocol. */
export interface SourceAdapter {
  readonly kind: SourceKind;
  fetchCategories(source: Source): Promise<readonly Category[]>;
  fetchChannels(source: Source, category: Category): Promise<readonly Channel[]>;
  /** Resolves a variant to a playable stream URL. Never logged, never persisted verbatim. */
  buildStreamUrl(source: Source, variant: ChannelVariant): Promise<string>;
  /**
   * Bulk import path used by the DB import routine (see `packages/core/src/db`), yielding
   * every category with its channels from a single underlying fetch. Prefer this over calling
   * `fetchCategories` + `fetchChannels` in a loop: for the M3U adapter that loop would
   * re-fetch and re-parse the entire playlist once per category (171 times, for the
   * reference provider) instead of once. Xtream's implementation is a thin wrapper over the
   * two methods above, since each of its calls is already a cheap, independent request.
   */
  importAll(source: Source): AsyncGenerator<ChannelPage>;
}
