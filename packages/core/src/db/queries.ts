import type Database from "better-sqlite3";
import type { ChannelVariant, Source } from "../source/types.js";

export interface ChannelRow {
  readonly id: string;
  readonly source_id: string;
  readonly category_id: string;
  readonly normalised_name: string;
  readonly raw_name: string;
  readonly country: string | null;
  readonly logo_url: string | null;
  readonly channel_number: number | null;
  /** 1 when the channel is in `favourites`. Present on every row this module returns. */
  readonly is_favourite: 0 | 1;
}

const CHANNEL_COLUMNS = `c.id, c.source_id, c.category_id, c.normalised_name, c.raw_name,
  c.country, c.logo_url, c.channel_number,
  (SELECT 1 FROM favourites f WHERE f.channel_id = c.id) IS NOT NULL AS is_favourite`;

/** FTS5 search over the normalised channel name. Instant at 18k rows — see schema.ts. */
export function searchChannels(db: Database.Database, query: string, limit = 200): ChannelRow[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  // Wrap each token as a prefix match (tnt* sport*) so "tnt spo" matches "TNT Sports" while
  // the user is still typing, rather than requiring the full word.
  const ftsQuery = trimmed
    .split(/\s+/)
    .map((token) => `${token.replace(/["*]/g, "")}*`)
    .join(" ");

  return db
    .prepare(
      `SELECT ${CHANNEL_COLUMNS}
       FROM channels_fts
       JOIN channels c ON c.rowid = channels_fts.rowid
       WHERE channels_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(ftsQuery, limit) as ChannelRow[];
}

/**
 * The default channel grid: every channel, optionally narrowed to one category (the sidebar
 * list) or one country (the filter chips), ordered the way a channel list is normally read (by
 * number, then name). Capped — the renderer narrows rather than rendering all ~18k at once.
 * `categoryId` wins over `country` when both are given.
 */
export function browseChannels(
  db: Database.Database,
  opts: { categoryId?: string; country?: string; limit?: number; offset?: number } = {},
): ChannelRow[] {
  const limit = opts.limit ?? 300;
  const offset = opts.offset ?? 0;

  const where: string[] = [];
  const filters: unknown[] = [];
  if (opts.categoryId !== undefined) {
    where.push("c.category_id = ?");
    filters.push(opts.categoryId);
  } else if (opts.country !== undefined) {
    where.push("c.country IS ?");
    filters.push(opts.country);
  }

  return db
    .prepare(
      `SELECT ${CHANNEL_COLUMNS}
       FROM channels c
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY c.channel_number IS NULL, c.channel_number, c.normalised_name
       LIMIT ? OFFSET ?`,
    )
    .all(...filters, limit, offset) as ChannelRow[];
}

export interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly country: string | null;
  readonly channel_count: number;
}

/**
 * Every category (provider group-title) that still has channels, for the sidebar list.
 * Ordered by name, case-insensitively — the list is browsed alphabetically, not by size.
 */
export function listCategories(db: Database.Database): CategoryRow[] {
  return db
    .prepare(
      `SELECT cat.id, cat.raw_name AS name, cat.country, COUNT(ch.id) AS channel_count
       FROM categories cat
       JOIN channels ch ON ch.category_id = cat.id
       GROUP BY cat.id
       ORDER BY cat.raw_name COLLATE NOCASE`,
    )
    .all() as CategoryRow[];
}

/** Recently played channels, most recent first — backs the "Recently watched" strip and view. */
export function listRecentChannels(db: Database.Database, limit = 24): ChannelRow[] {
  return db
    .prepare(
      `SELECT ${CHANNEL_COLUMNS}
       FROM recents r
       JOIN channels c ON c.id = r.channel_id
       ORDER BY r.played_at DESC
       LIMIT ?`,
    )
    .all(limit) as ChannelRow[];
}

/** Favourited channels, newest favourite first. */
export function listFavouriteChannels(db: Database.Database): ChannelRow[] {
  return db
    .prepare(
      `SELECT ${CHANNEL_COLUMNS}
       FROM favourites f
       JOIN channels c ON c.id = f.channel_id
       ORDER BY f.added_at DESC`,
    )
    .all() as ChannelRow[];
}

export interface ChannelCountry {
  readonly country: string;
  readonly count: number;
}

/** Distinct channel countries with a count, for the filter chip row. "No country" is dropped. */
export function listChannelCountries(db: Database.Database): ChannelCountry[] {
  return db
    .prepare(
      `SELECT country, COUNT(*) AS count
       FROM channels
       WHERE country IS NOT NULL AND country <> ''
       GROUP BY country
       ORDER BY count DESC, country ASC`,
    )
    .all() as ChannelCountry[];
}

export interface CountryNode {
  readonly country: string | null;
  readonly categoryCount: number;
}

/** Powers the sidebar tree: distinct countries with a category count, "no country" last. */
export function listCountries(db: Database.Database, sourceId: string): CountryNode[] {
  return db
    .prepare(
      `SELECT country, COUNT(*) as categoryCount
       FROM categories
       WHERE source_id = ?
       GROUP BY country
       ORDER BY country IS NULL, country ASC`,
    )
    .all(sourceId) as CountryNode[];
}

export function toggleFavourite(db: Database.Database, channelId: string): boolean {
  const existing = db.prepare(`SELECT 1 FROM favourites WHERE channel_id = ?`).get(channelId);
  if (existing) {
    db.prepare(`DELETE FROM favourites WHERE channel_id = ?`).run(channelId);
    return false;
  }
  db.prepare(`INSERT INTO favourites (channel_id, added_at) VALUES (?, ?)`).run(channelId, Date.now());
  return true;
}

export function recordRecent(db: Database.Database, channelId: string): void {
  db.prepare(
    `INSERT INTO recents (channel_id, played_at) VALUES (?, ?)
     ON CONFLICT(channel_id) DO UPDATE SET played_at = excluded.played_at`,
  ).run(channelId, Date.now());
}

/** Everything the main process needs to turn a channel id into a playable stream URL. */
export interface PlaybackTarget {
  readonly channelId: string;
  readonly channelName: string;
  readonly variant: ChannelVariant;
  readonly source: Source;
}

/**
 * Resolves a channel (and optional explicit variant) to its source and the variant to play.
 * With no `variantId`, picks the best variant — `sort_order` 0, which `groupVariants` sets to
 * the highest resolution/framerate. Returns undefined if the channel or variant is unknown.
 *
 * The main process passes the result's `source` + `variant` to the source adapter's
 * `buildStreamUrl` — the resolved URL and the provider credentials never reach the renderer.
 */
export function getPlaybackTarget(
  db: Database.Database,
  channelId: string,
  variantId?: string,
): PlaybackTarget | undefined {
  const channel = db
    .prepare(`SELECT id, normalised_name AS name FROM channels WHERE id = ?`)
    .get(channelId) as { id: string; name: string } | undefined;
  if (!channel) return undefined;

  const variantRow = db
    .prepare(
      `SELECT id, channel_id AS channelId, provider_stream_id AS providerStreamId, quality, is_offline AS isOffline
       FROM channel_variants
       WHERE channel_id = ? ${variantId !== undefined ? "AND id = ?" : ""}
       ORDER BY sort_order
       LIMIT 1`,
    )
    .get(...(variantId !== undefined ? [channelId, variantId] : [channelId])) as
    | { id: string; channelId: string; providerStreamId: string; quality: string | null; isOffline: 0 | 1 }
    | undefined;
  if (!variantRow) return undefined;

  const sourceRow = db
    .prepare(
      `SELECT s.id, s.kind, s.name, s.base_url AS baseUrl, s.playlist_url AS playlistUrl, s.epg_url AS epgUrl
       FROM sources s
       JOIN channels c ON c.source_id = s.id
       WHERE c.id = ?`,
    )
    .get(channelId) as
    | { id: string; kind: "xtream" | "m3u"; name: string; baseUrl: string | null; playlistUrl: string | null; epgUrl: string | null }
    | undefined;
  if (!sourceRow) return undefined;

  const source: Source =
    sourceRow.kind === "xtream"
      ? { id: sourceRow.id, kind: "xtream", name: sourceRow.name, baseUrl: sourceRow.baseUrl ?? "" }
      : {
          id: sourceRow.id,
          kind: "m3u",
          name: sourceRow.name,
          playlistUrl: sourceRow.playlistUrl ?? "",
          ...(sourceRow.epgUrl !== null ? { epgUrl: sourceRow.epgUrl } : {}),
        };

  return {
    channelId: channel.id,
    channelName: channel.name,
    variant: {
      id: variantRow.id,
      sourceId: sourceRow.id,
      providerStreamId: variantRow.providerStreamId,
      ...(variantRow.quality !== null ? { quality: variantRow.quality } : {}),
      isOffline: variantRow.isOffline === 1,
    },
    source,
  };
}
