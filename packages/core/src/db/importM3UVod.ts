import type Database from "better-sqlite3";
import { movieKey, seriesKey } from "../source/m3u/classifyEntry.js";
import type { M3UVodCatalog } from "../source/m3u/adapter.js";
import { remoteKeyForPlaylistItem } from "../sync/remoteKey.js";
import type { Source } from "../source/types.js";
import { categoryClassificationParams } from "./categoryClassification.js";
import { parseName } from "../normalise/parseName.js";

/**
 * Imports the films and episodes found in an M3U playlist into the same tables Xtream VOD uses,
 * so Movies and Series browse, search, favourite and resume identically for both source kinds.
 *
 * Unlike Xtream there is no catalogue API and no lazy detail call: the playlist already holds every
 * title and a direct stream URL, so seasons and episodes are written here (with
 * `episodes_fetched_at` set, which keeps `ensureSeriesEpisodes` out of it) and `providerStreamId` /
 * `provider_episode_id` are the URL itself. Ids come from the title, not the URL, so favourites and
 * progress survive a provider rotating tokens. Diff-and-merge like every other import: rows absent
 * from this refresh are never deleted.
 */
export async function importM3UVod(
  db: Database.Database,
  source: Source,
  catalog: M3UVodCatalog,
  include: { movies: boolean; series: boolean },
): Promise<{ movies: number; series: number; episodes: number }> {
  if (source.kind !== "m3u") throw new Error(`importM3UVod used with a non-m3u source: ${source.kind}`);
  const now = Date.now();
  const playlistUrl = source.playlistUrl;

  type Prepared = {
    movieCategories: Map<string, { id: string; rawName: string }>;
    movies: Map<string, { id: string; categoryId: string; title: string; url: string; poster: string | null; extension: string | null; key: string }>;
    seriesCategories: Map<string, { id: string; rawName: string }>;
    series: Map<string, { id: string; categoryId: string; title: string; poster: string | null; key: string }>;
    seasons: Map<string, { id: string; seriesId: string; number: number }>;
    episodes: Map<string, { id: string; seasonId: string; seriesId: string; url: string; number: number; name: string; extension: string | null; key: string }>;
  };
  const prepared: Prepared = {
    movieCategories: new Map(),
    movies: new Map(),
    seriesCategories: new Map(),
    series: new Map(),
    seasons: new Map(),
    episodes: new Map(),
  };

  if (include.movies) {
    for (const item of catalog.movies) {
      const key = movieKey(item.title);
      if (key === "") continue;
      const id = `${source.id}:m:${key}`;
      if (prepared.movies.has(id)) continue; // the same film listed twice: the first wins
      const categoryId = `${source.id}:mcat:${item.group}`;
      prepared.movieCategories.set(categoryId, { id: categoryId, rawName: item.group });
      prepared.movies.set(id, { id, categoryId, title: item.title, url: item.url, poster: item.posterUrl ?? null, extension: item.extension, key });
    }
  }

  if (include.series) {
    for (const item of catalog.episodes) {
      const showKey = seriesKey(item.series);
      if (showKey === "") continue;
      const seriesId = `${source.id}:s:${showKey}`;
      if (!prepared.series.has(seriesId)) {
        const categoryId = `${source.id}:scat:${item.group}`;
        prepared.seriesCategories.set(categoryId, { id: categoryId, rawName: item.group });
        prepared.series.set(seriesId, { id: seriesId, categoryId, title: item.series, poster: item.posterUrl ?? null, key: showKey });
      }
      const seasonId = `${seriesId}:${item.season}`;
      prepared.seasons.set(seasonId, { id: seasonId, seriesId, number: item.season });
      const episodeId = `${seasonId}:e${item.episode}`;
      if (prepared.episodes.has(episodeId)) continue; // duplicate S01E01 (another quality): the first wins
      prepared.episodes.set(episodeId, {
        id: episodeId,
        seasonId,
        seriesId,
        url: item.url,
        number: item.episode,
        name: item.title !== "" ? item.title : `Episode ${item.episode}`,
        extension: item.extension,
        key: `${showKey}|s${item.season}e${item.episode}`,
      });
    }
  }

  // Hashing is async, so every remote key is computed before the (synchronous) transaction.
  const movieKeys = new Map<string, string>();
  for (const movie of prepared.movies.values()) movieKeys.set(movie.id, await remoteKeyForPlaylistItem(playlistUrl, `movie|${movie.key}`));
  const seriesKeys = new Map<string, string>();
  for (const show of prepared.series.values()) seriesKeys.set(show.id, await remoteKeyForPlaylistItem(playlistUrl, `series|${show.key}`));
  const episodeKeys = new Map<string, string>();
  for (const episode of prepared.episodes.values()) episodeKeys.set(episode.id, await remoteKeyForPlaylistItem(playlistUrl, `episode|${episode.key}`));

  const categoryParams = (id: string, rawName: string) => ({
    id,
    sourceId: source.id,
    providerId: rawName,
    rawName,
    country: parseName(rawName).country ?? null,
    ...categoryClassificationParams(rawName),
  });

  const upsertMovieCategory = db.prepare(`
    INSERT INTO movie_categories (id, source_id, provider_id, raw_name, country, genre, language, service, tags)
    VALUES (@id, @sourceId, @providerId, @rawName, @country, @genre, @language, @service, @tags)
    ON CONFLICT(id) DO UPDATE SET raw_name = excluded.raw_name, country = excluded.country,
      genre = excluded.genre, language = excluded.language, service = excluded.service, tags = excluded.tags
  `);
  const upsertSeriesCategory = db.prepare(`
    INSERT INTO series_categories (id, source_id, provider_id, raw_name, country, genre, language, service, tags)
    VALUES (@id, @sourceId, @providerId, @rawName, @country, @genre, @language, @service, @tags)
    ON CONFLICT(id) DO UPDATE SET raw_name = excluded.raw_name, country = excluded.country,
      genre = excluded.genre, language = excluded.language, service = excluded.service, tags = excluded.tags
  `);
  const upsertMovie = db.prepare(`
    INSERT INTO movies (id, source_id, category_id, provider_stream_id, name, poster_url, container_extension,
                        details_fetched_at, first_seen_at, last_seen_at, remote_key)
    VALUES (@id, @sourceId, @categoryId, @url, @name, @poster, @extension, @now, @now, @now, @remoteKey)
    ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, provider_stream_id = excluded.provider_stream_id,
      name = excluded.name, poster_url = excluded.poster_url, container_extension = excluded.container_extension,
      last_seen_at = excluded.last_seen_at, remote_key = excluded.remote_key
  `);
  const upsertSeries = db.prepare(`
    INSERT INTO series (id, source_id, category_id, provider_series_id, name, poster_url, episodes_fetched_at,
                        first_seen_at, last_seen_at, remote_key)
    VALUES (@id, @sourceId, @categoryId, @providerSeriesId, @name, @poster, @now, @now, @now, @remoteKey)
    ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, name = excluded.name,
      poster_url = COALESCE(excluded.poster_url, poster_url), episodes_fetched_at = excluded.episodes_fetched_at,
      last_seen_at = excluded.last_seen_at, remote_key = excluded.remote_key
  `);
  const upsertSeason = db.prepare(`
    INSERT INTO seasons (id, series_id, season_number) VALUES (?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const upsertEpisode = db.prepare(`
    INSERT INTO episodes (id, season_id, series_id, provider_episode_id, episode_number, name, container_extension, remote_key)
    VALUES (@id, @seasonId, @seriesId, @url, @number, @name, @extension, @remoteKey)
    ON CONFLICT(id) DO UPDATE SET provider_episode_id = excluded.provider_episode_id, episode_number = excluded.episode_number,
      name = excluded.name, container_extension = excluded.container_extension, remote_key = excluded.remote_key
  `);

  db.transaction(() => {
    for (const category of prepared.movieCategories.values()) upsertMovieCategory.run(categoryParams(category.id, category.rawName));
    for (const movie of prepared.movies.values()) {
      upsertMovie.run({ id: movie.id, sourceId: source.id, categoryId: movie.categoryId, url: movie.url, name: movie.title, poster: movie.poster, extension: movie.extension, now, remoteKey: movieKeys.get(movie.id) });
    }
    for (const category of prepared.seriesCategories.values()) upsertSeriesCategory.run(categoryParams(category.id, category.rawName));
    for (const show of prepared.series.values()) {
      upsertSeries.run({ id: show.id, sourceId: source.id, categoryId: show.categoryId, providerSeriesId: show.key, name: show.title, poster: show.poster, now, remoteKey: seriesKeys.get(show.id) });
    }
    for (const season of prepared.seasons.values()) upsertSeason.run(season.id, season.seriesId, season.number);
    for (const episode of prepared.episodes.values()) {
      upsertEpisode.run({ id: episode.id, seasonId: episode.seasonId, seriesId: episode.seriesId, url: episode.url, number: episode.number, name: episode.name, extension: episode.extension, remoteKey: episodeKeys.get(episode.id) });
    }
  })();

  return { movies: prepared.movies.size, series: prepared.series.size, episodes: prepared.episodes.size };
}

/**
 * Before playlists were split, every entry (films included) was imported as a live channel, and
 * imports never delete. This removes those leftover channels, and any live category they emptied,
 * for entries now recognised as films or episodes. Idempotent: a no-op once they are gone.
 */
export function removeVodFromLive(db: Database.Database, sourceId: string, catalog: M3UVodCatalog): number {
  const urls = [...catalog.movies.map((movie) => movie.url), ...catalog.episodes.map((episode) => episode.url)];
  if (urls.length === 0) return 0;

  let removed = 0;
  db.transaction(() => {
    // Chunked to stay under SQLite's bound-parameter limit.
    for (let start = 0; start < urls.length; start += 500) {
      const chunk = urls.slice(start, start + 500);
      const marks = chunk.map(() => "?").join(",");
      removed += db
        .prepare(
          `DELETE FROM channels WHERE source_id = ? AND id IN
             (SELECT channel_id FROM channel_variants WHERE provider_stream_id IN (${marks}))`,
        )
        .run(sourceId, ...chunk).changes;
    }
    if (removed > 0) {
      db.prepare(`DELETE FROM categories WHERE source_id = ? AND id NOT IN (SELECT category_id FROM channels WHERE source_id = ?)`).run(
        sourceId,
        sourceId,
      );
    }
  })();
  return removed;
}
