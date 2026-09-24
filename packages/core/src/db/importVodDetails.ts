import type Database from "better-sqlite3";
import { remoteKeyFor } from "../sync/remoteKey.js";
import type { CredentialsLookup } from "../source/xtream/client.js";
import { fetchSeriesDetails, fetchVodDetails } from "../source/xtream/vod.js";
import type { Movie, Series, Source } from "../source/types.js";

/**
 * Lazily fetches (and caches) a movie's plot/duration via `get_vod_info` — a no-op if already
 * fetched (`details_fetched_at` non-null; a refresh resets it to NULL for a film that changed, see `importVod.ts`).
 * Also backfills `container_extension` when the cheap bulk `get_vod_streams` import didn't
 * supply one (some Xtream panels omit it there) — see the design spec's "Import strategy".
 */
export async function ensureMovieDetails(
  db: Database.Database,
  source: Source,
  movieId: string,
  getCredentials: CredentialsLookup,
): Promise<void> {
  const row = db
    .prepare(
      `SELECT provider_stream_id AS providerStreamId, details_fetched_at AS detailsFetchedAt
       FROM movies WHERE id = ?`,
    )
    .get(movieId) as { providerStreamId: string; detailsFetchedAt: number | null } | undefined;
  if (!row || row.detailsFetchedAt !== null) return;

  const movie: Pick<Movie, "providerStreamId"> = { providerStreamId: row.providerStreamId };
  const details = await fetchVodDetails(source, movie, getCredentials);

  db.prepare(
    `UPDATE movies SET
       plot                = COALESCE(?, plot),
       duration_secs       = COALESCE(?, duration_secs),
       container_extension = COALESCE(?, container_extension),
       details_fetched_at  = ?
     WHERE id = ?`,
  ).run(details.plot ?? null, details.durationSecs ?? null, details.containerExtension ?? null, Date.now(), movieId);
}

/**
 * Lazily fetches (and caches) a series' seasons/episodes via `get_series_info` — a no-op if
 * already fetched. Replaces the series' seasons/episodes wholesale (delete-then-insert) rather
 * than diffing — same reasoning as EPG import: cheap to fully replace a leaf list. A list older than a day is
 * fetched again on the next open, so a running series' new episodes turn up (a refresh leaves an unchanged series'
 * list alone, see `importSeries.ts`); a series the refresh saw change is reset to NULL and fetched at once.
 */
const EPISODES_FRESH_MS = 24 * 60 * 60 * 1000;

export async function ensureSeriesEpisodes(
  db: Database.Database,
  source: Source,
  seriesId: string,
  getCredentials: CredentialsLookup,
): Promise<void> {
  const row = db
    .prepare(
      `SELECT id, source_id AS sourceId, category_id AS categoryId, provider_series_id AS providerSeriesId,
              name, poster_url AS posterUrl, rating, plot, episodes_fetched_at AS episodesFetchedAt
       FROM series WHERE id = ?`,
    )
    .get(seriesId) as
    | {
        id: string;
        sourceId: string;
        categoryId: string;
        providerSeriesId: string;
        name: string;
        posterUrl: string | null;
        rating: string | null;
        plot: string | null;
        episodesFetchedAt: number | null;
      }
    | undefined;
  if (!row || (row.episodesFetchedAt !== null && Date.now() - row.episodesFetchedAt < EPISODES_FRESH_MS)) return;

  const series: Series = {
    id: row.id,
    sourceId: row.sourceId,
    categoryId: row.categoryId,
    providerSeriesId: row.providerSeriesId,
    name: row.name,
    ...(row.posterUrl !== null ? { posterUrl: row.posterUrl } : {}),
    ...(row.rating !== null ? { rating: row.rating } : {}),
    ...(row.plot !== null ? { plot: row.plot } : {}),
  };
  const { seasons, episodes } = await fetchSeriesDetails(source, series, getCredentials);

  const providerHost = source.kind === "xtream" ? source.baseUrl : "";
  const episodeRemoteKeys = new Map<string, string>();
  for (const episode of episodes) {
    episodeRemoteKeys.set(episode.id, await remoteKeyFor(providerHost, episode.providerEpisodeId));
  }

  const deleteEpisodes = db.prepare(`DELETE FROM episodes WHERE series_id = ?`);
  const deleteSeasons = db.prepare(`DELETE FROM seasons WHERE series_id = ?`);
  const insertSeason = db.prepare(`INSERT INTO seasons (id, series_id, season_number, name, poster_url) VALUES (?, ?, ?, ?, ?)`);
  const insertEpisode = db.prepare(`
    INSERT INTO episodes (id, season_id, series_id, provider_episode_id, episode_number, name, container_extension, duration_secs, plot, image_url, remote_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const stamp = db.prepare(`UPDATE series SET episodes_fetched_at = ? WHERE id = ?`);

  const applyAll = db.transaction(() => {
    deleteEpisodes.run(seriesId);
    deleteSeasons.run(seriesId);
    for (const season of seasons) {
      insertSeason.run(season.id, season.seriesId, season.seasonNumber, season.name ?? null, season.posterUrl ?? null);
    }
    for (const episode of episodes) {
      insertEpisode.run(
        episode.id,
        episode.seasonId,
        episode.seriesId,
        episode.providerEpisodeId,
        episode.episodeNumber,
        episode.name,
        episode.containerExtension ?? null,
        episode.durationSecs ?? null,
        episode.plot ?? null,
        episode.imageUrl ?? null,
        episodeRemoteKeys.get(episode.id) ?? null,
      );
    }
    stamp.run(Date.now(), seriesId);
  });
  applyAll();
}
