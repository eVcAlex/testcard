import type Database from "better-sqlite3";

export interface ChannelRow {
  readonly id: string;
  readonly source_id: string;
  readonly category_id: string;
  readonly normalised_name: string;
  readonly raw_name: string;
  readonly country: string | null;
  readonly logo_url: string | null;
  readonly channel_number: number | null;
}

/** FTS5 search over the normalised channel name. Instant at 18k rows — see schema.ts. */
export function searchChannels(db: Database.Database, query: string, limit = 100): ChannelRow[] {
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
      `SELECT c.id, c.source_id, c.category_id, c.normalised_name, c.raw_name, c.country, c.logo_url, c.channel_number
       FROM channels_fts
       JOIN channels c ON c.rowid = channels_fts.rowid
       WHERE channels_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(ftsQuery, limit) as ChannelRow[];
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
