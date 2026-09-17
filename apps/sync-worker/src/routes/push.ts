import type { Context } from "hono";
import { SyncPushRequestSchema, SyncPushResponseSchema } from "@testcard/sync-schema";
import type { Env } from "../index.js";

type FavouriteOrRecentTable = "movie_favourites" | "movie_recents" | "series_favourites" | "series_recents";

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

export async function handlePush(c: Context<{ Bindings: Env; Variables: { userId: string } }>): Promise<Response> {
  const userId = c.get("userId");
  const body = SyncPushRequestSchema.parse(await c.req.json());
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
        .bind(`${userId}:${s.remoteKey}`, userId, s.remoteKey, s.label, s.credentialsBlob, s.credentialsIv, s.updatedAt, s.deletedAt),
    ),
    ...body.movieFavourites.map((f) => upsertFavouriteOrRecent(db, "movie_favourites", "added_at", userId, f.remoteKey, f.addedAt, f.updatedAt, f.deletedAt)),
    ...body.movieRecents.map((r) => upsertFavouriteOrRecent(db, "movie_recents", "played_at", userId, r.remoteKey, r.playedAt, r.updatedAt, r.deletedAt)),
    ...body.seriesFavourites.map((f) => upsertFavouriteOrRecent(db, "series_favourites", "added_at", userId, f.remoteKey, f.addedAt, f.updatedAt, f.deletedAt)),
    ...body.seriesRecents.map((r) => upsertFavouriteOrRecent(db, "series_recents", "played_at", userId, r.remoteKey, r.playedAt, r.updatedAt, r.deletedAt)),
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
  ];

  if (statements.length > 0) await db.batch(statements);

  return c.json(SyncPushResponseSchema.parse({ newCursor: Date.now() }));
}
