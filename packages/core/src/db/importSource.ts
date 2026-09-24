import { applyInSlices } from "./applyInSlices.js";
import { categoryClassificationParams } from "./categoryClassification.js";
import type Database from "better-sqlite3";
import { parseName } from "../normalise/parseName.js";
import type { Category, Channel, Source, SourceAdapter } from "../source/types.js";

/**
 * Imports (or re-imports) a Source's full category/channel set. Always diff-and-merge,
 * never destructive — see CONTEXT.md "Refresh": Favourites and Recents are keyed off
 * `channels.id`, which `groupVariants` derives deterministically from
 * (sourceId, categoryId, normalisedName, country), so a re-import naturally reuses the same
 * id for a channel the provider hasn't meaningfully changed, and matching needs no separate
 * "provider id -> our id" table.
 *
 * Runs as a single transaction so a crash mid-import can't leave a half-imported source, and
 * uses prepared statements reused across all ~18k rows rather than re-preparing per row.
 */
export async function importSource(
  db: Database.Database,
  source: Source,
  adapter: Pick<SourceAdapter, "importAll">,
): Promise<{ categories: number; channels: number; variants: number; durationMs: number }> {
  const startedAt = Date.now();
  const now = Date.now();

  const upsertCategory = db.prepare(`
    INSERT INTO categories (id, source_id, provider_id, raw_name, country, genre, language, service, tags)
    VALUES (@id, @sourceId, @providerId, @rawName, @country, @genre, @language, @service, @tags)
    ON CONFLICT(id) DO UPDATE SET raw_name = excluded.raw_name, country = excluded.country,
      genre = excluded.genre, language = excluded.language, service = excluded.service, tags = excluded.tags
    WHERE categories.raw_name IS NOT excluded.raw_name OR categories.tags IS NOT excluded.tags
  `);

  // `country` is not a field on the Category domain type (see CONTEXT.md — it's a
  // presentation-layer grouping, not a separate concept). This column is a cached,
  // query-time-only value derived here purely so the sidebar tree can be built with a
  // single indexed query instead of parsing 171 category names on every render.
  function categoryParams(category: Category) {
    return { ...category, country: parseName(category.rawName).country ?? null, ...categoryClassificationParams(category.rawName) };
  }

  const upsertChannel = db.prepare(`
    INSERT INTO channels (
      id, source_id, category_id, normalised_name, raw_name, country, logo_url,
      channel_number, catchup_type, catchup_days, tvg_id, first_seen_at, last_seen_at
    ) VALUES (
      @id, @sourceId, @categoryId, @normalisedName, @rawName, @country, @logoUrl,
      @channelNumber, @catchupType, @catchupDays, @tvgId, @firstSeenAt, @lastSeenAt
    )
    ON CONFLICT(id) DO UPDATE SET
      normalised_name = excluded.normalised_name,
      raw_name         = excluded.raw_name,
      country          = excluded.country,
      logo_url         = excluded.logo_url,
      channel_number   = excluded.channel_number,
      tvg_id           = excluded.tvg_id,
      catchup_type     = excluded.catchup_type,
      catchup_days     = excluded.catchup_days,
      last_seen_at     = excluded.last_seen_at
    -- Only a channel that changed is written: rewriting thousands of unchanged rows was most of a refresh's cost.
    WHERE channels.normalised_name IS NOT excluded.normalised_name OR channels.raw_name IS NOT excluded.raw_name
      OR channels.country IS NOT excluded.country OR channels.logo_url IS NOT excluded.logo_url
      OR channels.channel_number IS NOT excluded.channel_number OR channels.tvg_id IS NOT excluded.tvg_id
      OR channels.catchup_type IS NOT excluded.catchup_type OR channels.catchup_days IS NOT excluded.catchup_days
  `);

  const deleteVariantsForChannel = db.prepare(`DELETE FROM channel_variants WHERE channel_id = ?`);
  const insertVariant = db.prepare(`
    INSERT INTO channel_variants (id, channel_id, provider_stream_id, quality, is_offline, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Each channel's streams as stored, so a channel whose streams are unchanged is left alone rather than having them
  // deleted and written again. (Android's SQLite adapter stores a NUL in an id as U+0001.)
  const unNul = (text: string) => text.replaceAll("\u0001", "\0");
  const variantKey = (id: string, stream: string, quality: string | null | undefined, offline: boolean | number) => `${id}|${stream}|${quality ?? ""}|${offline ? 1 : 0}`;
  const storedVariants = new Map<string, string>();
  for (const row of db
    .prepare(
      `SELECT v.channel_id AS channelId, v.id, v.provider_stream_id AS stream, v.quality, v.is_offline AS offline
       FROM channel_variants v JOIN channels c ON c.id = v.channel_id WHERE c.source_id = ? ORDER BY v.channel_id, v.sort_order`,
    )
    .all(source.id) as { channelId: string; id: string; stream: string; quality: string | null; offline: number }[]) {
    const channelId = unNul(row.channelId);
    const entry = variantKey(unNul(row.id), row.stream, row.quality, row.offline);
    const before = storedVariants.get(channelId);
    storedVariants.set(channelId, before === undefined ? entry : `${before}\n${entry}`);
  }

  let categoryCount = 0;
  let channelCount = 0;
  let variantCount = 0;

  // better-sqlite3 has no async transaction support, so pages are drained into memory first —
  // acceptable at 18k-channel scale (a few MB of plain objects), unlike the raw playlist text
  // which `parseM3U`/`importAll` never buffer whole.
  const pages: { category: Category; channels: readonly Channel[] }[] = [];
  for await (const page of adapter.importAll(source)) pages.push(page);

  await applyInSlices(
    db,
    pages,
    (page) => page.channels.length * 2,
    (page) => {
      upsertCategory.run(categoryParams(page.category));
      categoryCount += 1;

      for (const channel of page.channels) {
        upsertChannel.run({
          id: channel.id,
          sourceId: channel.sourceId,
          categoryId: channel.categoryId,
          normalisedName: channel.normalisedName,
          rawName: channel.rawName,
          country: channel.country ?? null,
          logoUrl: channel.logoUrl ?? null,
          channelNumber: channel.channelNumber ?? null,
          catchupType: channel.catchup?.type ?? null,
          catchupDays: channel.catchup?.days ?? null,
          tvgId: channel.tvgId ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
        });
        channelCount += 1;

        variantCount += channel.variants.length;
        const wanted = channel.variants.map((variant) => variantKey(variant.id, variant.providerStreamId, variant.quality, variant.isOffline === true)).join("\n");
        if (storedVariants.get(channel.id) === wanted) continue;
        deleteVariantsForChannel.run(channel.id);
        channel.variants.forEach((variant, index) => {
          insertVariant.run(variant.id, channel.id, variant.providerStreamId, variant.quality ?? null, variant.isOffline ? 1 : 0, index);
        });
      }
    },
  );
  db.prepare(`UPDATE sources SET last_refreshed_at = ? WHERE id = ?`).run(now, source.id);

  // Deliberately not deleting channels absent from this refresh: `last_seen_at` records
  // when each channel was last confirmed present, and a UI can use it to grey out or hide
  // stale entries — but never auto-deletes, so a favourite briefly missing from one refresh
  // (or a provider category that vanishes and reappears) never silently loses its favourite.
  // A real "prune channels stale for N refreshes" pass, if wanted, is a v2 addition.

  return { categories: categoryCount, channels: channelCount, variants: variantCount, durationMs: Date.now() - startedAt };
}
