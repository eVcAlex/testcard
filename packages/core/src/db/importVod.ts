import { applyInSlices, yieldToEventLoop } from "./applyInSlices.js";
import { categoryClassificationParams } from "./categoryClassification.js";
import type Database from "better-sqlite3";
import { parseName } from "../normalise/parseName.js";
import { remoteKeyFor } from "../sync/remoteKey.js";
import type { CredentialsLookup } from "../source/xtream/client.js";
import { fetchMovies, fetchVodCategories } from "../source/xtream/vod.js";
import type { Category, Movie, Source } from "../source/types.js";

/**
 * Imports (or re-imports) an Xtream source's full movie catalog: `get_vod_categories` +
 * `get_vod_streams` per category — same cost profile as live channel import. Diff-and-merge by
 * stable id (mirrors `importSource.ts`), never destructive — favourites/recents/progress
 * survive a refresh since ids stay stable. Every touched row has `details_fetched_at` reset to
 * NULL: title/poster/category data is refreshed in place, but any previously lazily-fetched
 * plot/duration is now presumed stale and re-fetched next time the title is opened.
 */
export async function importVod(
  db: Database.Database,
  source: Source,
  getCredentials: CredentialsLookup,
): Promise<{ categories: number; movies: number; durationMs: number }> {
  const startedAt = Date.now();
  const now = Date.now();

  const categories = await fetchVodCategories(source, getCredentials);

  const upsertCategory = db.prepare(`
    INSERT INTO movie_categories (id, source_id, provider_id, raw_name, country, genre, language, service, tags)
    VALUES (@id, @sourceId, @providerId, @rawName, @country, @genre, @language, @service, @tags)
    ON CONFLICT(id) DO UPDATE SET raw_name = excluded.raw_name, country = excluded.country,
      genre = excluded.genre, language = excluded.language, service = excluded.service, tags = excluded.tags
  `);
  function categoryParams(category: Category) {
    return { ...category, country: parseName(category.rawName).country ?? null, ...categoryClassificationParams(category.rawName) };
  }

  const upsertMovie = db.prepare(`
    INSERT INTO movies (
      id, source_id, category_id, provider_stream_id, name, poster_url,
      container_extension, rating, first_seen_at, last_seen_at, remote_key
    ) VALUES (
      @id, @sourceId, @categoryId, @providerStreamId, @name, @posterUrl,
      @containerExtension, @rating, @firstSeenAt, @lastSeenAt, @remoteKey
    )
    ON CONFLICT(id) DO UPDATE SET
      category_id          = excluded.category_id,
      provider_stream_id   = excluded.provider_stream_id,
      name                 = excluded.name,
      poster_url           = excluded.poster_url,
      container_extension  = excluded.container_extension,
      rating               = excluded.rating,
      details_fetched_at   = NULL,
      last_seen_at         = excluded.last_seen_at,
      remote_key            = excluded.remote_key
  `);

  // Pages are drained into memory first — better-sqlite3 has no async transaction support,
  // same reasoning as importSource.ts.
  const pages: { category: Category; movies: readonly Movie[] }[] = [];
  for (const category of categories) {
    pages.push({ category, movies: await fetchMovies(source, category, getCredentials) });
  }

  const providerHost = source.kind === "xtream" ? source.baseUrl : "";
  const remoteKeys = new Map<string, string>();
  // A page's digests at once rather than one await per title: tens of thousands in a row held the thread (the UI's,
  // on a TV) for seconds. A macrotask between pages lets the screen draw.
  for (const page of pages) {
    const keys = await Promise.all(page.movies.map((item) => remoteKeyFor(providerHost, item.providerStreamId)));
    page.movies.forEach((item, index) => remoteKeys.set(item.id, keys[index]!));
    await yieldToEventLoop();
  }

  let movieCount = 0;
  await applyInSlices(
    db,
    pages,
    (page) => page.movies.length,
    (page) => {
      upsertCategory.run(categoryParams(page.category));
      for (const movie of page.movies) {
        upsertMovie.run({
          id: movie.id,
          sourceId: movie.sourceId,
          categoryId: movie.categoryId,
          providerStreamId: movie.providerStreamId,
          name: movie.name,
          posterUrl: movie.posterUrl ?? null,
          containerExtension: movie.containerExtension ?? null,
          rating: movie.rating ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
          remoteKey: remoteKeys.get(movie.id),
        });
        movieCount += 1;
      }
    },
  );

  // Not deleting movies absent from this refresh — same rationale as importSource.ts:
  // last_seen_at records presence without ever silently dropping a favourite.

  return { categories: categories.length, movies: movieCount, durationMs: Date.now() - startedAt };
}
