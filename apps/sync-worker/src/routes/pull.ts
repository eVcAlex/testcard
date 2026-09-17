import { SyncPullResponseSchema } from "@testcard/sync-schema";
import type { AppContext } from "../validation.js";

interface Row {
  readonly [key: string]: unknown;
}

export async function handlePull(c: AppContext): Promise<Response> {
  const userId = c.get("userId");
  // A malformed `since` would otherwise become NaN, and `updated_at > NaN` silently matches nothing
  // — a client would see an empty, apparently-successful pull instead of an error.
  const since = Number(c.req.query("since") ?? "0");
  if (!Number.isFinite(since) || since < 0) {
    return c.json({ error: "invalid request", issues: [{ message: "`since` must be a finite, non-negative number" }] }, 400);
  }
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

  /**
   * The cursor must be the high-water mark of the client-authored `updated_at` values actually
   * returned, never the Worker's wall-clock — see
   * `docs/superpowers/specs/2026-09-16-device-sync-design.md` ("Sync protocol"). `Date.now()` is
   * computed *after* the SELECTs above return, so any push landing in that window would sit below
   * the cursor and be skipped forever on the next `?since=<cursor>` pull.
   *
   * An empty pull returns `since` unchanged, so the client's cursor never drifts or regresses.
   */
  const serverCursor = [
    sources.results,
    movieFavourites.results,
    movieRecents.results,
    seriesFavourites.results,
    seriesRecents.results,
    progress.results,
  ]
    .flat()
    .reduce((max, row) => Math.max(max, Number(row.updatedAt)), since);

  const response = SyncPullResponseSchema.parse({
    sources: sources.results,
    movieFavourites: movieFavourites.results,
    movieRecents: movieRecents.results,
    seriesFavourites: seriesFavourites.results,
    seriesRecents: seriesRecents.results,
    progress: progress.results.map((row) => ({ ...row, watched: Boolean(row.watched) })),
    serverCursor,
  });

  return c.json(response);
}
