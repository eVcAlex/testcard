import type Database from "better-sqlite3";
import { fallbackRank, sameChannelKey } from "../normalise/displayName.js";

/** One way to play a channel: a Variant of it, or of the same channel listed elsewhere. */
export interface ChannelFeed {
  readonly channelId: string;
  readonly variantId: string;
  /** The display name of the channel this feed belongs to. */
  readonly name: string;
  /** The Variant's quality label ("720p25"), when it has one. */
  readonly quality: string | null;
}

/** Enough to get past a dead stream without trying every copy a large list carries. */
const MOST_FEEDS = 8;

/**
 * Every way to play a channel, in the order to try them: its own Variants first (best first, as grouped), then
 * the same channel listed in another category or quality ("BBC One 4K" failing over to "BBC One HD"), from the
 * same source before another. The same country only, so "Fox" in the UK list never falls back to "Fox" in the US one.
 */
export function listChannelFeeds(db: Database.Database, channelId: string): ChannelFeed[] {
  const channel = db
    .prepare(`SELECT id, source_id AS sourceId, normalised_name AS name, country FROM channels WHERE id = ?`)
    .get(channelId) as { id: string; sourceId: string; name: string; country: string | null } | undefined;
  if (channel === undefined) return [];
  const variants = db.prepare(
    `SELECT v.id, v.quality, c.source_id || ' ' || v.provider_stream_id AS stream FROM channel_variants v JOIN channels c ON c.id = v.channel_id WHERE v.channel_id = ? ORDER BY v.sort_order`,
  );
  // Playlists list one stream under several categories: the same stream is not worth trying twice.
  const tried = new Set<string>();
  const feeds: ChannelFeed[] = [];
  const addFeedsOf = (id: string, name: string) => {
    for (const variant of variants.all(id) as { id: string; quality: string | null; stream: string }[]) {
      if (tried.has(variant.stream)) continue;
      tried.add(variant.stream);
      feeds.push({ channelId: id, variantId: variant.id, name, quality: variant.quality });
    }
  };

  addFeedsOf(channel.id, channel.name);
  const key = sameChannelKey(channel.name);
  const like = `${key.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const others = (
    db
      .prepare(
        `SELECT id, source_id AS sourceId, normalised_name AS name FROM channels
         WHERE normalised_name LIKE ? ESCAPE '\\' AND id <> ? AND country IS ?`,
      )
      .all(like, channel.id, channel.country) as { id: string; sourceId: string; name: string }[]
  )
    .filter((other) => sameChannelKey(other.name) === key)
    .sort((a, b) => Number(a.sourceId !== channel.sourceId) - Number(b.sourceId !== channel.sourceId) || fallbackRank(a.name) - fallbackRank(b.name) || a.name.localeCompare(b.name));
  for (const other of others) {
    if (feeds.length >= MOST_FEEDS) break;
    addFeedsOf(other.id, other.name);
  }
  return feeds.slice(0, MOST_FEEDS);
}
