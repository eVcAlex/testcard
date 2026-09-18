import type Database from "better-sqlite3";
import { decryptCredentials, encryptCredentials } from "./credentialCrypto.js";
import type { SyncFavourite, SyncPullResponse, SyncPushRequest, SyncRecent, SyncSource } from "@testcard/sync-schema";

export interface SyncState {
  readonly lastPulledAt: number;
  readonly lastPushedAt: number;
}

export function getSyncState(db: Database.Database): SyncState {
  const row = db.prepare(`SELECT last_pulled_at AS lastPulledAt, last_pushed_at AS lastPushedAt FROM sync_state WHERE id = 1`).get() as
    | SyncState
    | undefined;
  if (row) return row;
  db.prepare(`INSERT INTO sync_state (id, last_pulled_at, last_pushed_at) VALUES (1, 0, 0)`).run();
  return { lastPulledAt: 0, lastPushedAt: 0 };
}

export function setSyncState(db: Database.Database, patch: Partial<SyncState>): void {
  getSyncState(db); // ensures the singleton row exists
  if (patch.lastPulledAt !== undefined) db.prepare(`UPDATE sync_state SET last_pulled_at = ? WHERE id = 1`).run(patch.lastPulledAt);
  if (patch.lastPushedAt !== undefined) db.prepare(`UPDATE sync_state SET last_pushed_at = ? WHERE id = 1`).run(patch.lastPushedAt);
}

interface FavouriteOrRecentRow {
  readonly remote_key: string | null;
  readonly added_at?: number;
  readonly played_at?: number;
  readonly updated_at: number | null;
}

function collectFavouritesOrRecents(
  db: Database.Database,
  table: string,
  timestampColumn: "added_at" | "played_at",
  sinceMs: number,
): readonly (SyncFavourite | SyncRecent)[] {
  const rows = db
    .prepare(`SELECT remote_key, ${timestampColumn}, updated_at FROM ${table} WHERE updated_at > ? AND remote_key IS NOT NULL`)
    .all(sinceMs) as FavouriteOrRecentRow[];
  return rows.map((row) => ({
    remoteKey: row.remote_key as string,
    ...(timestampColumn === "added_at" ? { addedAt: row.added_at as number } : { playedAt: row.played_at as number }),
    updatedAt: row.updated_at as number,
    deletedAt: null,
  })) as readonly (SyncFavourite | SyncRecent)[];
}

/** Same shape as `packages/core/src/source/xtream/client.ts`'s existing `CredentialsLookup`. */
export type SyncCredentialsLookup = (sourceId: string) => Promise<{ baseUrl: string; username: string; password: string }>;

/**
 * Builds this device's `SyncPushRequest`: every row changed since `sinceMs`, plus every tombstone
 * recorded since the last push (a local delete, e.g. an unfavourite — see Task 6). Xtream source
 * credentials are fetched via `getCredentials` (the actual username/password live in Electron's
 * `safeStorage`-backed store, outside this framework-free module's reach — see `main/credentials.ts`)
 * and encrypted here, right before they leave the device.
 */
export async function collectLocalChanges(
  db: Database.Database,
  sinceMs: number,
  accountPassword: string,
  salt: string,
  getCredentials: SyncCredentialsLookup,
): Promise<SyncPushRequest> {
  const sourceRows = db
    .prepare(
      `SELECT id, remote_key, name, sync_updated_at FROM sources
       WHERE kind = 'xtream' AND remote_key IS NOT NULL AND sync_updated_at > ?`,
    )
    .all(sinceMs) as { id: string; remote_key: string; name: string; sync_updated_at: number }[];

  const sources: SyncSource[] = [];
  for (const row of sourceRows) {
    const credentials = await getCredentials(row.id);
    const encrypted = await encryptCredentials(
      { host: credentials.baseUrl, username: credentials.username, password: credentials.password },
      accountPassword,
      salt,
    );
    sources.push({ remoteKey: row.remote_key, label: row.name, credentialsBlob: encrypted.blob, credentialsIv: encrypted.iv, updatedAt: row.sync_updated_at, deletedAt: null });
  }

  const tombstoneRows = db.prepare(`SELECT table_name, remote_key, deleted_at FROM sync_tombstones`).all() as {
    table_name: string;
    remote_key: string;
    deleted_at: number;
  }[];
  const tombstonesByTable = new Map<string, { remoteKey: string; deletedAt: number }[]>();
  for (const row of tombstoneRows) {
    const list = tombstonesByTable.get(row.table_name) ?? [];
    list.push({ remoteKey: row.remote_key, deletedAt: row.deleted_at });
    tombstonesByTable.set(row.table_name, list);
  }
  /**
   * Appends tombstone rows for `table` to `rows`. Built explicitly (not spread from `rows[0]`,
   * which is `undefined` whenever the only change since last sync was a delete) so the required
   * `addedAt`/`playedAt` field is always present — `SyncFavouriteSchema`/`SyncRecentSchema` require
   * it as a non-negative int. There's no meaningful historical value for a delete, so `t.deletedAt`
   * is reused for it, mirroring the existing choice to use `t.deletedAt` for `updatedAt`.
   */
  function withTombstones<T extends { remoteKey: string; updatedAt: number; deletedAt: number | null }>(
    table: string,
    rows: readonly T[],
    timestampField: "addedAt" | "playedAt",
  ): T[] {
    const tombstones = (tombstonesByTable.get(table) ?? []).map(
      (t) => ({ remoteKey: t.remoteKey, updatedAt: t.deletedAt, deletedAt: t.deletedAt, [timestampField]: t.deletedAt }) as unknown as T,
    );
    return [...rows, ...tombstones];
  }

  const progressRows = db
    .prepare(
      `SELECT remote_key, item_type, position_secs, duration_secs, watched, updated_at, deleted_at
       FROM playback_progress WHERE updated_at > ? AND remote_key IS NOT NULL`,
    )
    .all(sinceMs) as { remote_key: string; item_type: "movie" | "episode"; position_secs: number; duration_secs: number | null; watched: 0 | 1; updated_at: number; deleted_at: number | null }[];

  return {
    sources,
    movieFavourites: withTombstones("movie_favourites", collectFavouritesOrRecents(db, "movie_favourites", "added_at", sinceMs) as SyncFavourite[], "addedAt"),
    movieRecents: withTombstones("movie_recents", collectFavouritesOrRecents(db, "movie_recents", "played_at", sinceMs) as SyncRecent[], "playedAt"),
    seriesFavourites: withTombstones("series_favourites", collectFavouritesOrRecents(db, "series_favourites", "added_at", sinceMs) as SyncFavourite[], "addedAt"),
    seriesRecents: withTombstones("series_recents", collectFavouritesOrRecents(db, "series_recents", "played_at", sinceMs) as SyncRecent[], "playedAt"),
    progress: progressRows.map((row) => ({
      remoteKey: row.remote_key,
      itemType: row.item_type,
      positionSecs: row.position_secs,
      durationSecs: row.duration_secs,
      watched: Boolean(row.watched),
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    })),
  };
}

/** Clears tombstones once the push that reported them has succeeded. */
export function clearTombstones(db: Database.Database): void {
  db.prepare(`DELETE FROM sync_tombstones`).run();
}

/**
 * Applies a `SyncPullResponse` into local tables, matching each remote row to its local row by
 * `remote_key` (never by local id, which differs per device — see the design spec's "Portable
 * content identity"). A row with no local match yet (this device hasn't imported that title) is
 * skipped for favourites/recents/progress — there's nothing local to attach it to until a
 * catalog refresh imports it, at which point `remote_key` will already be populated (Task 4) and
 * the next pull will match. Xtream source credentials are decrypted here, immediately before
 * being written to `credentials.enc.json` by the caller (Task 14) — this function never touches
 * that file directly, keeping `packages/core` free of Electron's `safeStorage`.
 */
export async function applyRemoteChanges(
  db: Database.Database,
  response: SyncPullResponse,
  accountPassword: string,
  salt: string,
  onDecryptedSource: (remoteKey: string, label: string, credentials: { host: string; username: string; password: string }) => Promise<void>,
): Promise<void> {
  for (const source of response.sources) {
    // Removing a source on one device and having that propagate to others (a tombstone on
    // `sources`, mirroring Task 6's favourite tombstones) is out of scope for this plan — see
    // Task 16 Step 8's regression note. A deleted-remotely source is simply never pulled again;
    // it isn't retroactively removed from a device that already has it.
    if (source.deletedAt !== null) continue;
    if (source.label === null || source.credentialsBlob === null || source.credentialsIv === null) continue; // live row always has all three per SyncSourceSchema's refine; defensive skip if ever violated
    const decrypted = await decryptCredentials({ blob: source.credentialsBlob, iv: source.credentialsIv }, accountPassword, salt);
    await onDecryptedSource(source.remoteKey, source.label, decrypted);
  }

  const applyAll = db.transaction(() => {
    for (const row of response.movieFavourites) {
      if (row.deletedAt !== null) {
        db.prepare(`DELETE FROM movie_favourites WHERE remote_key = ?`).run(row.remoteKey);
        continue;
      }
      const movie = db.prepare(`SELECT id FROM movies WHERE remote_key = ?`).get(row.remoteKey) as { id: string } | undefined;
      if (!movie) continue;
      db.prepare(
        `INSERT INTO movie_favourites (movie_id, added_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(movie_id) DO UPDATE SET added_at = excluded.added_at, updated_at = excluded.updated_at
         WHERE excluded.updated_at > movie_favourites.updated_at`,
      ).run(movie.id, row.addedAt, row.remoteKey, row.updatedAt);
    }

    for (const row of response.movieRecents) {
      if (row.deletedAt !== null) {
        db.prepare(`DELETE FROM movie_recents WHERE remote_key = ?`).run(row.remoteKey);
        continue;
      }
      const movie = db.prepare(`SELECT id FROM movies WHERE remote_key = ?`).get(row.remoteKey) as { id: string } | undefined;
      if (!movie) continue;
      db.prepare(
        `INSERT INTO movie_recents (movie_id, played_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(movie_id) DO UPDATE SET played_at = excluded.played_at, updated_at = excluded.updated_at
         WHERE excluded.updated_at > movie_recents.updated_at`,
      ).run(movie.id, row.playedAt, row.remoteKey, row.updatedAt);
    }

    for (const row of response.seriesFavourites) {
      if (row.deletedAt !== null) {
        db.prepare(`DELETE FROM series_favourites WHERE remote_key = ?`).run(row.remoteKey);
        continue;
      }
      const series = db.prepare(`SELECT id FROM series WHERE remote_key = ?`).get(row.remoteKey) as { id: string } | undefined;
      if (!series) continue;
      db.prepare(
        `INSERT INTO series_favourites (series_id, added_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(series_id) DO UPDATE SET added_at = excluded.added_at, updated_at = excluded.updated_at
         WHERE excluded.updated_at > series_favourites.updated_at`,
      ).run(series.id, row.addedAt, row.remoteKey, row.updatedAt);
    }

    for (const row of response.seriesRecents) {
      if (row.deletedAt !== null) {
        db.prepare(`DELETE FROM series_recents WHERE remote_key = ?`).run(row.remoteKey);
        continue;
      }
      const series = db.prepare(`SELECT id FROM series WHERE remote_key = ?`).get(row.remoteKey) as { id: string } | undefined;
      if (!series) continue;
      db.prepare(
        `INSERT INTO series_recents (series_id, played_at, remote_key, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(series_id) DO UPDATE SET played_at = excluded.played_at, updated_at = excluded.updated_at
         WHERE excluded.updated_at > series_recents.updated_at`,
      ).run(series.id, row.playedAt, row.remoteKey, row.updatedAt);
    }

    for (const row of response.progress) {
      const table = row.itemType === "movie" ? "movies" : "episodes";
      const item = db.prepare(`SELECT id FROM ${table} WHERE remote_key = ?`).get(row.remoteKey) as { id: string } | undefined;
      if (!item) continue;
      db.prepare(
        `INSERT INTO playback_progress (item_type, item_id, position_secs, duration_secs, watched, updated_at, remote_key, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_type, item_id) DO UPDATE SET
           position_secs = excluded.position_secs, duration_secs = excluded.duration_secs,
           watched = excluded.watched, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
         WHERE excluded.updated_at > playback_progress.updated_at`,
      ).run(row.itemType, item.id, row.positionSecs, row.durationSecs, row.watched ? 1 : 0, row.updatedAt, row.remoteKey, row.deletedAt);
    }
  });
  applyAll();
}
