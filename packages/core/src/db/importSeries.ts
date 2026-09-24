import { categoryClassificationParams } from "./categoryClassification.js";
import { applyInSlices, yieldToEventLoop } from "./applyInSlices.js";
import type Database from "better-sqlite3";
import { parseName } from "../normalise/parseName.js";
import { remoteKeyFor } from "../sync/remoteKey.js";
import type { CredentialsLookup } from "../source/xtream/client.js";
import { fetchSeriesCategories, fetchSeriesList } from "../source/xtream/vod.js";
import type { Category, Series, Source } from "../source/types.js";

/**
 * Imports (or re-imports) an Xtream source's full series catalog: `get_series_categories` +
 * `get_series` per category. Same diff-and-merge shape as `importVod.ts`. Every touched row has
 * `episodes_fetched_at` reset to NULL — a previously-fetched season/episode list is now presumed
 * stale and re-fetched lazily next time the series is opened (see `importVodDetails.ts`).
 */
export async function importSeries(
  db: Database.Database,
  source: Source,
  getCredentials: CredentialsLookup,
): Promise<{ categories: number; series: number; durationMs: number }> {
  const startedAt = Date.now();
  const now = Date.now();

  const categories = await fetchSeriesCategories(source, getCredentials);

  const upsertCategory = db.prepare(`
    INSERT INTO series_categories (id, source_id, provider_id, raw_name, country, genre, language, service, tags)
    VALUES (@id, @sourceId, @providerId, @rawName, @country, @genre, @language, @service, @tags)
    ON CONFLICT(id) DO UPDATE SET raw_name = excluded.raw_name, country = excluded.country,
      genre = excluded.genre, language = excluded.language, service = excluded.service, tags = excluded.tags
  `);
  function categoryParams(category: Category) {
    return { ...category, country: parseName(category.rawName).country ?? null, ...categoryClassificationParams(category.rawName) };
  }

  const upsertSeries = db.prepare(`
    INSERT INTO series (
      id, source_id, category_id, provider_series_id, name, poster_url,
      rating, plot, first_seen_at, last_seen_at, remote_key
    ) VALUES (
      @id, @sourceId, @categoryId, @providerSeriesId, @name, @posterUrl,
      @rating, @plot, @firstSeenAt, @lastSeenAt, @remoteKey
    )
    ON CONFLICT(id) DO UPDATE SET
      category_id         = excluded.category_id,
      provider_series_id  = excluded.provider_series_id,
      name                = excluded.name,
      poster_url          = excluded.poster_url,
      rating              = excluded.rating,
      plot                = excluded.plot,
      episodes_fetched_at = NULL,
      last_seen_at        = excluded.last_seen_at,
      remote_key           = excluded.remote_key
  `);

  const pages: { category: Category; series: readonly Series[] }[] = [];
  for (const category of categories) {
    pages.push({ category, series: await fetchSeriesList(source, category, getCredentials) });
  }

  const providerHost = source.kind === "xtream" ? source.baseUrl : "";
  const remoteKeys = new Map<string, string>();
  // A page's digests at once rather than one await per title: tens of thousands in a row held the thread (the UI's,
  // on a TV) for seconds. A macrotask between pages lets the screen draw.
  for (const page of pages) {
    const keys = await Promise.all(page.series.map((item) => remoteKeyFor(providerHost, item.providerSeriesId)));
    page.series.forEach((item, index) => remoteKeys.set(item.id, keys[index]!));
    await yieldToEventLoop();
  }

  let seriesCount = 0;
  await applyInSlices(
    db,
    pages,
    (page) => page.series.length,
    (page) => {
      upsertCategory.run(categoryParams(page.category));
      for (const series of page.series) {
        upsertSeries.run({
          id: series.id,
          sourceId: series.sourceId,
          categoryId: series.categoryId,
          providerSeriesId: series.providerSeriesId,
          name: series.name,
          posterUrl: series.posterUrl ?? null,
          rating: series.rating ?? null,
          plot: series.plot ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
          remoteKey: remoteKeys.get(series.id),
        });
        seriesCount += 1;
      }
    },
  );

  return { categories: categories.length, series: seriesCount, durationMs: Date.now() - startedAt };
}
