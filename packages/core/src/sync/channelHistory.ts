import type Database from "better-sqlite3";
import type { SyncChannelFavourite, SyncRecent } from "@testcard/sync-schema";

/**
 * Favourite and recently watched live channels, synced like films' and series'. A channel's local id is its source's
 * per-device id and the provider's key for it ("<source id>:<key>"), so its key on the account is built from the
 * source's key on the account and that provider key: the same on every device that has the source.
 *
 * A row can arrive before this device has the channel (a source still importing, a channel the provider has not
 * listed today). It waits in `pending_channel_sync` and is applied once the channel is here, rather than holding the
 * pull cursor back on it for good.
 */

/** Two FNV-1a passes with different seeds: 64 bits, so thousands of channels on a source do not collide. */
function hash64(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * A channel's key on the account, from its source's key and its own local id. The Android database stores the NUL in
 * a channel's key as U+0001 (see the app's sqlite adapter), so both are read as one.
 */
export function channelKeyFor(sourceRemoteKey: string, sourceId: string, channelId: string): string | null {
  if (!channelId.startsWith(`${sourceId}:`)) return null;
  const key = channelId.slice(sourceId.length + 1).replaceAll("\u0001", "\0");
  return `ch.${hash64(`${sourceRemoteKey}|${key}`)}`;
}

/** The key of one channel on this device, or null for a channel (or source) that has none. */
export function channelRemoteKey(db: Database.Database, channelId: string): string | null {
  const row = db.prepare(`SELECT s.id AS sourceId, s.remote_key AS remoteKey FROM channels c JOIN sources s ON s.id = c.source_id WHERE c.id = ?`).get(channelId) as
    | { sourceId: string; remoteKey: string | null }
    | undefined;
  return row === undefined || row.remoteKey === null ? null : channelKeyFor(row.remoteKey, row.sourceId, channelId);
}

/** Records that a favourite or recent channel went, for the next push. */
export function recordChannelTombstone(db: Database.Database, table: "channel_favourites" | "channel_recents", channelId: string): void {
  const key = channelRemoteKey(db, channelId);
  if (key !== null) db.prepare(`INSERT INTO sync_tombstones (table_name, remote_key, deleted_at) VALUES (?, ?, ?)`).run(table, key, Date.now());
}

/** The channel favourites and recents changed since `sinceMs`, keyed for the account, with this device's removals. */
export function collectChannelHistory(db: Database.Database, sinceMs: number): { channelFavourites: SyncChannelFavourite[]; channelRecents: SyncRecent[] } {
  const keys = new Map<string, { remoteKey: string | null; id: string }>(
    (db.prepare(`SELECT id, remote_key AS remoteKey FROM sources`).all() as { id: string; remoteKey: string | null }[]).map((row) => [row.id, row]),
  );
  const keyOf = (sourceId: string, channelId: string) => {
    const source = keys.get(sourceId);
    return source?.remoteKey == null ? null : channelKeyFor(source.remoteKey, sourceId, channelId);
  };
  const channelFavourites: SyncChannelFavourite[] = [];
  for (const row of db
    .prepare(`SELECT f.channel_id AS id, c.source_id AS sourceId, f.added_at AS addedAt, f.position, f.updated_at AS updatedAt FROM favourites f JOIN channels c ON c.id = f.channel_id WHERE f.updated_at > ?`)
    .all(sinceMs) as { id: string; sourceId: string; addedAt: number; position: number | null; updatedAt: number }[]) {
    const remoteKey = keyOf(row.sourceId, row.id);
    if (remoteKey !== null) channelFavourites.push({ remoteKey, addedAt: row.addedAt, position: row.position, updatedAt: row.updatedAt, deletedAt: null });
  }
  const channelRecents: SyncRecent[] = [];
  for (const row of db
    .prepare(`SELECT r.channel_id AS id, c.source_id AS sourceId, r.played_at AS playedAt, r.updated_at AS updatedAt FROM recents r JOIN channels c ON c.id = r.channel_id WHERE r.updated_at > ?`)
    .all(sinceMs) as { id: string; sourceId: string; playedAt: number; updatedAt: number }[]) {
    const remoteKey = keyOf(row.sourceId, row.id);
    if (remoteKey !== null) channelRecents.push({ remoteKey, playedAt: row.playedAt, updatedAt: row.updatedAt, deletedAt: null });
  }
  const tombstones = db.prepare(`SELECT table_name AS tableName, remote_key AS remoteKey, deleted_at AS deletedAt FROM sync_tombstones WHERE table_name IN ('channel_favourites', 'channel_recents')`).all() as {
    tableName: string;
    remoteKey: string;
    deletedAt: number;
  }[];
  for (const gone of tombstones) {
    if (gone.tableName === "channel_favourites") channelFavourites.push({ remoteKey: gone.remoteKey, addedAt: gone.deletedAt, position: null, updatedAt: gone.deletedAt, deletedAt: gone.deletedAt });
    else channelRecents.push({ remoteKey: gone.remoteKey, playedAt: gone.deletedAt, updatedAt: gone.deletedAt, deletedAt: gone.deletedAt });
  }
  return { channelFavourites, channelRecents };
}

/** How long a row for a channel this device does not have waits before it is let go. */
const PENDING_FOR_MS = 30 * 24 * 60 * 60 * 1000;

type Pending = { kind: "favourite"; row: SyncChannelFavourite } | { kind: "recent"; row: SyncRecent };

/**
 * Applies pulled channel favourites and recents (already this profile's, prefix off), last write wins, together with
 * any that were waiting for their channel. Returns whether anything changed here.
 */
export function applyChannelHistory(db: Database.Database, favourites: readonly SyncChannelFavourite[], recents: readonly SyncRecent[]): boolean {
  const now = Date.now();
  db.prepare(`DELETE FROM pending_channel_sync WHERE received_at < ?`).run(now - PENDING_FOR_MS);
  const waiting = (db.prepare(`SELECT kind, row FROM pending_channel_sync`).all() as { kind: "favourite" | "recent"; row: string }[]).map(
    (entry) => ({ kind: entry.kind, row: JSON.parse(entry.row) }) as Pending,
  );
  const incoming: Pending[] = [...favourites.map((row) => ({ kind: "favourite" as const, row })), ...recents.map((row) => ({ kind: "recent" as const, row }))];
  if (incoming.length === 0 && waiting.length === 0) return false;

  // Every channel's key, worked out once: there is no column for it, and a source holds thousands.
  const byKey = new Map<string, string>();
  for (const source of db.prepare(`SELECT id, remote_key AS remoteKey FROM sources WHERE remote_key IS NOT NULL`).all() as { id: string; remoteKey: string }[]) {
    for (const channel of db.prepare(`SELECT id FROM channels WHERE source_id = ?`).all(source.id) as { id: string }[]) {
      const key = channelKeyFor(source.remoteKey, source.id, channel.id);
      if (key !== null) byKey.set(key, channel.id);
    }
  }

  let changed = false;
  const apply = db.transaction((entries: readonly Pending[], fromWaiting: boolean) => {
    for (const entry of entries) {
      const channelId = byKey.get(entry.row.remoteKey);
      if (channelId === undefined) {
        // Not here: a removal has nothing to remove; anything else waits for the channel.
        if (entry.row.deletedAt !== null) db.prepare(`DELETE FROM pending_channel_sync WHERE kind = ? AND remote_key = ?`).run(entry.kind, entry.row.remoteKey);
        else if (!fromWaiting) db.prepare(`INSERT OR REPLACE INTO pending_channel_sync (kind, remote_key, row, received_at) VALUES (?, ?, ?, ?)`).run(entry.kind, entry.row.remoteKey, JSON.stringify(entry.row), now);
        continue;
      }
      if (fromWaiting) db.prepare(`DELETE FROM pending_channel_sync WHERE kind = ? AND remote_key = ?`).run(entry.kind, entry.row.remoteKey);
      const table = entry.kind === "favourite" ? "favourites" : "recents";
      const local = db.prepare(`SELECT updated_at AS updatedAt FROM ${table} WHERE channel_id = ?`).get(channelId) as { updatedAt: number | null } | undefined;
      if (local !== undefined && (local.updatedAt ?? 0) >= entry.row.updatedAt) continue;
      changed = true;
      if (entry.row.deletedAt !== null) {
        if (local !== undefined) db.prepare(`DELETE FROM ${table} WHERE channel_id = ?`).run(channelId);
        continue;
      }
      if (entry.kind === "favourite") {
        db.prepare(
          `INSERT INTO favourites (channel_id, added_at, position, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(channel_id) DO UPDATE SET added_at = excluded.added_at, position = excluded.position, updated_at = excluded.updated_at`,
        ).run(channelId, entry.row.addedAt, entry.row.position, entry.row.updatedAt);
      } else {
        db.prepare(
          `INSERT INTO recents (channel_id, played_at, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(channel_id) DO UPDATE SET played_at = excluded.played_at, updated_at = excluded.updated_at`,
        ).run(channelId, entry.row.playedAt, entry.row.updatedAt);
      }
    }
  });
  apply(waiting, true);
  apply(incoming, false);
  return changed;
}
