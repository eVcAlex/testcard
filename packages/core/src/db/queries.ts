import type Database from "better-sqlite3";
import { recordChannelTombstone } from "../sync/channelHistory.js";
import { categoryShown, channelShown } from "../sync/hidden.js";
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

export const CHANNEL_COLUMNS = `c.id, c.source_id, c.category_id, c.normalised_name, c.raw_name,
  c.country, c.logo_url, c.channel_number,
  (SELECT 1 FROM favourites f WHERE f.channel_id = c.id) IS NOT NULL AS is_favourite`;

/** FTS5 search over the normalised channel name. Instant at 18k rows — see schema.ts. */
export function searchChannels(db: Database.Database, query: string, limit = 200, sourceId?: string): ChannelRow[] {
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
       WHERE channels_fts MATCH ? AND ${channelShown(db, "c")}${sourceId !== undefined ? " AND c.source_id = ?" : ""}
       ORDER BY rank
       LIMIT ?`,
    )
    .all(...(sourceId !== undefined ? [ftsQuery, sourceId] : [ftsQuery]), limit) as ChannelRow[];
}

/**
 * The default channel grid: every channel, optionally narrowed to one category (the sidebar
 * list) or one country (the filter chips). Ordered exactly as the provider's playlist lists
 * them — `channels.rowid` is insertion order and `importSource` inserts in playlist order (and
 * diff-merges on refresh without touching rowid). No re-sort by number or name: the provider's
 * order is what the user expects to see. Capped — the renderer narrows rather than rendering
 * all ~18k at once. `categoryId` wins over `country` when both are given.
 *
 * Caveat (same as `listCategories`): a channel first seen on a later refresh sorts to the end
 * of its group rather than its true playlist slot until an explicit sort_order column exists.
 */
export function browseChannels(
  db: Database.Database,
  opts: { categoryId?: string; country?: string; sourceId?: string; genre?: string; limit?: number; offset?: number } = {},
): ChannelRow[] {
  const limit = opts.limit ?? 300;
  const offset = opts.offset ?? 0;

  const where: string[] = [channelShown(db, "c")];
  const filters: unknown[] = [];
  if (opts.categoryId !== undefined) {
    where.push("c.category_id = ?");
    filters.push(opts.categoryId);
  } else if (opts.country !== undefined) {
    where.push("c.country IS ?");
    filters.push(opts.country);
  }
  if (opts.sourceId !== undefined) {
    where.push("c.source_id = ?");
    filters.push(opts.sourceId);
  }
  if (opts.genre !== undefined) {
    where.push("c.category_id IN (SELECT id FROM categories WHERE genre = ?)");
    filters.push(opts.genre);
  }

  return db
    .prepare(
      `SELECT ${CHANNEL_COLUMNS}
       FROM channels c
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY c.rowid
       LIMIT ? OFFSET ?`,
    )
    .all(...filters, limit, offset) as ChannelRow[];
}

export interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly country: string | null;
  /** Advisory classification (see normalise/classifyCategory.ts): null/'' when unrecognised. */
  readonly genre: string | null;
  readonly language: string | null;
  readonly service: string | null;
  readonly tags: string;
  readonly channel_count: number;
}

/**
 * Every category (provider group-title) that still has channels, for the sidebar list.
 *
 * Ordered the way the provider's playlist lists them — that's the order a user expects, and it
 * groups related categories the way the provider intended. `categories.rowid` is insertion
 * order, and `importSource` inserts in playlist order (and diff-merges on refresh without
 * touching rowid), so `ORDER BY cat.rowid` is the provider's order. A category that first
 * appears on a later refresh sorts to the end rather than its true playlist position — a
 * proper fix needs an explicit sort_order column.
 */
export function listCategories(db: Database.Database, sourceId?: string): CategoryRow[] {
  return db
    .prepare(
      `SELECT cat.id, cat.raw_name AS name, cat.country, cat.genre, cat.language, cat.service, cat.tags, COUNT(ch.id) AS channel_count
       FROM categories cat
       JOIN channels ch ON ch.category_id = cat.id
       WHERE ${categoryShown(db, "cat", "live")}${sourceId !== undefined ? " AND cat.source_id = ?" : ""}
       GROUP BY cat.id
       ORDER BY cat.rowid`,
    )
    .all(...(sourceId !== undefined ? [sourceId] : [])) as CategoryRow[];
}

/** Recently played channels, most recent first — backs the "Recently watched" strip and view. */
export function listRecentChannels(db: Database.Database, limit = 24): ChannelRow[] {
  return db
    .prepare(
      `SELECT ${CHANNEL_COLUMNS}
       FROM recents r
       JOIN channels c ON c.id = r.channel_id
       WHERE ${channelShown(db, "c")}
       ORDER BY r.played_at DESC
       LIMIT ?`,
    )
    .all(limit) as ChannelRow[];
}

/** Favourited channels in the viewer's order: newest favourite first until they move one (see moveFavourite). */
export function listFavouriteChannels(db: Database.Database): ChannelRow[] {
  return db
    .prepare(
      `SELECT ${CHANNEL_COLUMNS}
       FROM favourites f
       JOIN channels c ON c.id = f.channel_id
       WHERE ${channelShown(db, "c")}
       ORDER BY f.position IS NOT NULL, f.position, f.added_at DESC`,
    )
    .all() as ChannelRow[];
}

export interface ChannelCountry {
  readonly country: string;
  readonly count: number;
}

/** Distinct channel countries with a count, for the filter chip row. "No country" is dropped. */
export function listChannelCountries(db: Database.Database, sourceId?: string): ChannelCountry[] {
  return db
    .prepare(
      `SELECT country, COUNT(*) AS count
       FROM channels
       WHERE country IS NOT NULL AND country <> ''${sourceId !== undefined ? " AND source_id = ?" : ""}
       GROUP BY country
       ORDER BY count DESC, country ASC`,
    )
    .all(...(sourceId !== undefined ? [sourceId] : [])) as ChannelCountry[];
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

/** Adds or removes a favourite channel. Synced (see sync/channelHistory.ts). */
export function toggleFavourite(db: Database.Database, channelId: string): boolean {
  const existing = db.prepare(`SELECT 1 FROM favourites WHERE channel_id = ?`).get(channelId);
  if (existing) {
    db.prepare(`DELETE FROM favourites WHERE channel_id = ?`).run(channelId);
    recordChannelTombstone(db, "channel_favourites", channelId);
    return false;
  }
  db.prepare(`INSERT INTO favourites (channel_id, added_at, updated_at) VALUES (?, ?, ?)`).run(channelId, Date.now(), Date.now());
  return true;
}

export function recordRecent(db: Database.Database, channelId: string): void {
  db.prepare(
    `INSERT INTO recents (channel_id, played_at, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(channel_id) DO UPDATE SET played_at = excluded.played_at, updated_at = excluded.updated_at`,
  ).run(channelId, Date.now(), Date.now());
}

/** Takes a channel out of Recently watched. Synced. */
export function removeChannelFromRecents(db: Database.Database, channelId: string): void {
  if (db.prepare(`DELETE FROM recents WHERE channel_id = ?`).run(channelId).changes > 0) recordChannelTombstone(db, "channel_recents", channelId);
}

export interface ProgrammeRow {
  readonly channel_id: string;
  readonly title: string;
  readonly description: string | null;
  /** unix ms */
  readonly start_at: number;
  /** unix ms */
  readonly end_at: number;
}

/** SQLite caps a statement at 999 bound variables; chunk any `IN (...)` list below that. */
const SQL_VARS_MAX = 900;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The now-airing and next programme for each of `channelIds`, batched for a visible grid.
 * `at` is unix ms (defaults to now). Channels with no matching EPG are simply absent from the
 * returned map. Same rule as `resolveNowNext` but straight off rows, so no Date round-trip.
 */
export function nowNextForChannels(
  db: Database.Database,
  channelIds: readonly string[],
  at: number = Date.now(),
): Map<string, { now?: ProgrammeRow; next?: ProgrammeRow }> {
  const result = new Map<string, { now?: ProgrammeRow; next?: ProgrammeRow }>();
  if (channelIds.length === 0) return result;

  const horizon = at + 24 * 60 * 60 * 1000;
  for (const ids of chunk(channelIds, SQL_VARS_MAX)) {
    const rows = db
      .prepare(
        `SELECT channel_id, title, description, start_at, end_at
         FROM programmes
         WHERE channel_id IN (${ids.map(() => "?").join(",")})
           AND end_at > ? AND start_at < ?
         ORDER BY channel_id, start_at`,
      )
      .all(...ids, at, horizon) as ProgrammeRow[];

    for (const row of rows) {
      const entry = result.get(row.channel_id) ?? {};
      if (row.start_at <= at && at < row.end_at) {
        entry.now = row;
      } else if (row.start_at > at && (entry.next === undefined || row.start_at < entry.next.start_at)) {
        entry.next = row;
      }
      result.set(row.channel_id, entry);
    }
  }
  return result;
}

/** Every programme overlapping `[fromMs, toMs]` for the given channels — backs the guide grid. */
export function programmesInWindow(
  db: Database.Database,
  channelIds: readonly string[],
  fromMs: number,
  toMs: number,
): ProgrammeRow[] {
  if (channelIds.length === 0) return [];
  const out: ProgrammeRow[] = [];
  for (const ids of chunk(channelIds, SQL_VARS_MAX)) {
    const rows = db
      .prepare(
        `SELECT channel_id, title, description, start_at, end_at
         FROM programmes
         WHERE channel_id IN (${ids.map(() => "?").join(",")})
           AND start_at < ? AND end_at > ?
         ORDER BY channel_id, start_at`,
      )
      .all(...ids, toMs, fromMs) as ProgrammeRow[];
    out.push(...rows);
  }
  return out;
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

/** Moves a favourite channel one place earlier (-1) or later (1) in the viewer's order. Synced. False at either end. */
export function moveFavourite(db: Database.Database, channelId: string, delta: -1 | 1): boolean {
  const ids = listFavouriteChannels(db).map((row) => row.id);
  const from = ids.indexOf(channelId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return false;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  // Every favourite takes its place (and is synced), so the order is the same on the viewer's other devices.
  const write = db.prepare(`UPDATE favourites SET position = ?, updated_at = ? WHERE channel_id = ?`);
  const now = Date.now();
  db.transaction(() => ids.forEach((id, index) => write.run(index, now, id)))();
  return true;
}
