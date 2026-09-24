import { SyncPushRequestSchema, SyncPushResponseSchema, type SyncPushRequest } from "@testcard/sync-schema";
import { parseJsonBody, type AppContext } from "../validation.js";

type FavouriteOrRecentTable = "movie_favourites" | "movie_recents" | "series_favourites" | "series_recents" | "channel_recents";

function upsertFavouriteOrRecent(
  db: D1Database,
  table: FavouriteOrRecentTable,
  timestampColumn: "added_at" | "played_at",
  userId: string,
  remoteKey: string,
  timestamp: number,
  updatedAt: number,
  deletedAt: number | null,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ${table} (user_id, remote_key, ${timestampColumn}, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, remote_key) DO UPDATE SET
         ${timestampColumn} = excluded.${timestampColumn}, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
       WHERE excluded.updated_at > ${table}.updated_at`,
    )
    .bind(userId, remoteKey, timestamp, updatedAt, deletedAt);
}

/**
 * The cursor a client persists must be derived from the client-authored `updated_at` values it just
 * sent, never from the Worker's wall-clock — see `docs/superpowers/specs/2026-09-16-device-sync-design.md`
 * ("Sync protocol"). A wall-clock cursor would sit *ahead* of rows that landed while this request
 * was in flight, and the next `?since=<cursor>` pull would skip them permanently.
 */
function maxUpdatedAt(body: SyncPushRequest): number {
  const all = [
    ...body.sources,
    ...body.movieFavourites,
    ...body.movieRecents,
    ...body.seriesFavourites,
    ...body.seriesRecents,
    ...body.progress,
    ...body.profiles,
    ...body.channelFavourites,
    ...body.channelRecents,
  ];
  // An empty push moves nothing, so it must not move the cursor either: 0 leaves the client's own
  // stored cursor as the greater value, which is what it keeps using.
  return all.reduce((max, row) => Math.max(max, row.updatedAt), 0);
}

export async function handlePush(c: AppContext): Promise<Response> {
  const userId = c.get("userId");
  const parsed = await parseJsonBody(c, SyncPushRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const db = c.env.DB;

  const statements = [
    ...body.sources.map((s) =>
      db
        .prepare(
          `INSERT INTO sources (id, user_id, remote_key, label, credentials_blob, credentials_iv, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, remote_key) DO UPDATE SET
             label = excluded.label, credentials_blob = excluded.credentials_blob,
             credentials_iv = excluded.credentials_iv, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
           WHERE excluded.updated_at > sources.updated_at`,
        )
        // label/blob/iv are null on a tombstone (see SyncSourceSchema); D1 binds JS null as SQL
        // NULL, and 0001_sync_tables.sql drops NOT NULL on those columns to accept it.
        .bind(`${userId}:${s.remoteKey}`, userId, s.remoteKey, s.label, s.credentialsBlob, s.credentialsIv, s.updatedAt, s.deletedAt),
    ),
    ...body.movieFavourites.map((f) => upsertFavouriteOrRecent(db, "movie_favourites", "added_at", userId, f.remoteKey, f.addedAt, f.updatedAt, f.deletedAt)),
    ...body.movieRecents.map((r) => upsertFavouriteOrRecent(db, "movie_recents", "played_at", userId, r.remoteKey, r.playedAt, r.updatedAt, r.deletedAt)),
    ...body.seriesFavourites.map((f) => upsertFavouriteOrRecent(db, "series_favourites", "added_at", userId, f.remoteKey, f.addedAt, f.updatedAt, f.deletedAt)),
    ...body.seriesRecents.map((r) => upsertFavouriteOrRecent(db, "series_recents", "played_at", userId, r.remoteKey, r.playedAt, r.updatedAt, r.deletedAt)),
    ...body.channelFavourites.map((f) =>
      db
        .prepare(
          `INSERT INTO channel_favourites (user_id, remote_key, added_at, position, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, remote_key) DO UPDATE SET
             added_at = excluded.added_at, position = excluded.position, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
           WHERE excluded.updated_at > channel_favourites.updated_at`,
        )
        .bind(userId, f.remoteKey, f.addedAt, f.position, f.updatedAt, f.deletedAt),
    ),
    ...body.channelRecents.map((r) => upsertFavouriteOrRecent(db, "channel_recents", "played_at", userId, r.remoteKey, r.playedAt, r.updatedAt, r.deletedAt)),
    ...body.progress.map((p) =>
      db
        .prepare(
          `INSERT INTO playback_progress (user_id, remote_key, item_type, position_secs, duration_secs, watched, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, remote_key, item_type) DO UPDATE SET
             position_secs = excluded.position_secs, duration_secs = excluded.duration_secs,
             watched = excluded.watched, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
           WHERE excluded.updated_at > playback_progress.updated_at`,
        )
        .bind(userId, p.remoteKey, p.itemType, p.positionSecs, p.durationSecs, p.watched ? 1 : 0, p.updatedAt, p.deletedAt),
    ),
    ...body.profiles.map((p) =>
      db
        .prepare(
          `INSERT INTO profiles (user_id, remote_key, blob, iv, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, remote_key) DO UPDATE SET
             blob = excluded.blob, iv = excluded.iv, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
           WHERE excluded.updated_at > profiles.updated_at`,
        )
        .bind(userId, p.remoteKey, p.blob, p.iv, p.updatedAt, p.deletedAt),
    ),
  ];

  if (statements.length > 0) await db.batch(statements);

  return c.json(SyncPushResponseSchema.parse({ newCursor: maxUpdatedAt(body) }));
}
