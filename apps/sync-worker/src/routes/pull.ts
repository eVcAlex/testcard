import type { Context } from "hono";
import { SyncPullResponseSchema } from "@testcard/sync-schema";
import type { Env } from "../index.js";

interface Row {
  readonly [key: string]: unknown;
}

export async function handlePull(c: Context<{ Bindings: Env; Variables: { userId: string } }>): Promise<Response> {
  const userId = c.get("userId");
  const since = Number(c.req.query("since") ?? "0");
  const db = c.env.DB;

  const [sources, movieFavourites, movieRecents, seriesFavourites, seriesRecents, progress] = await Promise.all([
    db
      .prepare(
        `SELECT remote_key AS remoteKey, label, credentials_blob AS credentialsBlob, credentials_iv AS credentialsIv,
                updated_at AS updatedAt, deleted_at AS deletedAt
         FROM sources WHERE user_id = ? AND updated_at > ?`,
      )
      .bind(userId, since)
      .all<Row>(),
    db
      .prepare(`SELECT remote_key AS remoteKey, added_at AS addedAt, updated_at AS updatedAt, deleted_at AS deletedAt
                FROM movie_favourites WHERE user_id = ? AND updated_at > ?`)
      .bind(userId, since)
      .all<Row>(),
    db
      .prepare(`SELECT remote_key AS remoteKey, played_at AS playedAt, updated_at AS updatedAt, deleted_at AS deletedAt
                FROM movie_recents WHERE user_id = ? AND updated_at > ?`)
      .bind(userId, since)
      .all<Row>(),
    db
      .prepare(`SELECT remote_key AS remoteKey, added_at AS addedAt, updated_at AS updatedAt, deleted_at AS deletedAt
                FROM series_favourites WHERE user_id = ? AND updated_at > ?`)
      .bind(userId, since)
      .all<Row>(),
    db
      .prepare(`SELECT remote_key AS remoteKey, played_at AS playedAt, updated_at AS updatedAt, deleted_at AS deletedAt
                FROM series_recents WHERE user_id = ? AND updated_at > ?`)
      .bind(userId, since)
      .all<Row>(),
    db
      .prepare(
        `SELECT remote_key AS remoteKey, item_type AS itemType, position_secs AS positionSecs, duration_secs AS durationSecs,
                watched, updated_at AS updatedAt, deleted_at AS deletedAt
         FROM playback_progress WHERE user_id = ? AND updated_at > ?`,
      )
      .bind(userId, since)
      .all<Row>(),
  ]);

  const response = SyncPullResponseSchema.parse({
    sources: sources.results,
    movieFavourites: movieFavourites.results,
    movieRecents: movieRecents.results,
    seriesFavourites: seriesFavourites.results,
    seriesRecents: seriesRecents.results,
    progress: progress.results.map((row) => ({ ...row, watched: Boolean(row.watched) })),
    serverCursor: Date.now(),
  });

  return c.json(response);
}
