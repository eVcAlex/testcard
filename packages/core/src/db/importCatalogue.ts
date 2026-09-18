import type Database from "better-sqlite3";
import type { M3UAdapter, M3UPlaylist } from "../source/m3u/adapter.js";
import type { CredentialsLookup } from "../source/xtream/client.js";
import type { Source, SourceAdapter } from "../source/types.js";
import { importM3UVod, removeVodFromLive } from "./importM3UVod.js";
import { importSeries } from "./importSeries.js";
import { importSource } from "./importSource.js";
import { importVod } from "./importVod.js";

/** A source row with its content switches, as `sources` stores them. */
export type CatalogueSource = Source & {
  readonly includeLive: number;
  readonly includeMovies: number;
  readonly includeSeries: number;
};

export interface CatalogueDeps {
  readonly xtreamAdapter: SourceAdapter;
  readonly m3uAdapter: M3UAdapter;
  readonly getCredentials: CredentialsLookup;
}

/** Progress a caller may surface; movies and series are best-effort, so their failures arrive here, not as throws. */
export interface CatalogueEvents {
  vod?(event: { phase: "fetching" | "done" | "error"; movies?: number; message?: string }): void;
  series?(event: { phase: "fetching" | "done" | "error"; series?: number; message?: string }): void;
}

export interface CatalogueResult {
  readonly categories: number;
  readonly channels: number;
  readonly variants: number;
  readonly durationMs: number;
  readonly movies?: number;
  readonly series?: number;
}

const NO_LIVE = { categories: 0, channels: 0, variants: 0, durationMs: 0 };

/**
 * Imports everything a source provides that is not the TV guide: live channels, movies and series,
 * honouring the source's content switches. An M3U playlist is fetched and parsed once and split into
 * live channels and films/episodes; Xtream has a separate API per content type. Live import failing
 * throws; movies and series are best-effort (reported through `events`) so a provider without a VOD
 * catalogue does not fail the refresh. Shared by the desktop main process and the Android apps.
 */
export async function importCatalogue(
  db: Database.Database,
  row: CatalogueSource,
  deps: CatalogueDeps,
  events: CatalogueEvents = {},
): Promise<CatalogueResult> {
  let playlist: M3UPlaylist | undefined;
  let live: typeof NO_LIVE;

  if (row.kind === "m3u") {
    const loaded = await deps.m3uAdapter.loadPlaylist(row);
    playlist = loaded;
    live =
      row.includeLive === 0
        ? NO_LIVE
        : await importSource(db, row, {
            async *importAll() {
              yield* loaded.livePages;
            },
          });
  } else {
    live = row.includeLive === 0 ? NO_LIVE : await importSource(db, row, deps.xtreamAdapter);
  }

  let movies: number | undefined;
  let series: number | undefined;

  if (playlist !== undefined) {
    const imported = await importM3UVod(db, row, playlist.vod, {
      movies: row.includeMovies !== 0,
      series: row.includeSeries !== 0,
    });
    removeVodFromLive(db, row.id, playlist.vod);
    if (row.includeMovies !== 0) movies = imported.movies;
    if (row.includeSeries !== 0) series = imported.series;
  }

  if (row.kind === "xtream" && row.includeMovies !== 0) {
    events.vod?.({ phase: "fetching" });
    try {
      movies = (await importVod(db, row, deps.getCredentials)).movies;
      events.vod?.({ phase: "done", movies });
    } catch (error) {
      events.vod?.({ phase: "error", message: error instanceof Error ? error.message : "The movie catalog could not be updated." });
    }
  }

  if (row.kind === "xtream" && row.includeSeries !== 0) {
    events.series?.({ phase: "fetching" });
    try {
      series = (await importSeries(db, row, deps.getCredentials)).series;
      events.series?.({ phase: "done", series });
    } catch (error) {
      events.series?.({ phase: "error", message: error instanceof Error ? error.message : "The series catalog could not be updated." });
    }
  }

  return { ...live, ...(movies !== undefined ? { movies } : {}), ...(series !== undefined ? { series } : {}) };
}
