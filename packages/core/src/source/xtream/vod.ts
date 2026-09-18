import type { Category, Episode, Movie, Season, Series, Source } from "../types.js";
import type { CredentialsLookup } from "./client.js";

/**
 * VOD/series methods live outside `SourceAdapter` — Xtream-only, so there's no M3U
 * implementation to require. Same precedent as `fetchShortEpg` in `client.ts`: each function
 * takes `getCredentials` explicitly rather than closing over it, since these are read on
 * demand (bulk import, or a lazy per-item open) rather than as part of the adapter contract.
 */

interface XtreamCategoryDTO {
  readonly category_id: string;
  readonly category_name: string;
}

interface XtreamVodStreamDTO {
  readonly stream_id: number;
  readonly name: string;
  readonly category_id: string;
  readonly stream_icon?: string;
  readonly container_extension?: string;
  readonly rating?: string | number;
}

interface XtreamSeriesListDTO {
  readonly series_id: number;
  readonly name: string;
  readonly category_id: string;
  readonly cover?: string;
  readonly plot?: string;
  readonly rating?: string | number;
}

interface XtreamSeasonDTO {
  readonly season_number: number;
  readonly name?: string;
  readonly cover?: string;
}

interface XtreamEpisodeInfoDTO {
  readonly duration_secs?: number | string;
  readonly plot?: string;
}

interface XtreamEpisodeDTO {
  readonly id: number | string;
  readonly episode_num: number;
  readonly title: string;
  readonly container_extension?: string;
  readonly season: number;
  readonly info?: XtreamEpisodeInfoDTO;
}

interface XtreamSeriesInfoDTO {
  readonly seasons?: readonly XtreamSeasonDTO[];
  readonly episodes?: Record<string, readonly XtreamEpisodeDTO[]>;
}

interface XtreamVodInfoDTO {
  readonly info?: { readonly plot?: string; readonly duration_secs?: number | string };
  readonly movie_data?: { readonly container_extension?: string };
}

function idFor(...parts: string[]): string {
  return parts.join(":");
}

function toFiniteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function call<T>(
  source: Source,
  action: string,
  params: Record<string, string>,
  getCredentials: CredentialsLookup,
): Promise<T> {
  if (source.kind !== "xtream") throw new Error(`Xtream VOD/series call used with a non-xtream source: ${source.kind}`);
  const credentials = await getCredentials(source.id);
  const url = new URL(`${credentials.baseUrl}/player_api.php`);
  url.searchParams.set("username", credentials.username);
  url.searchParams.set("password", credentials.password);
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Xtream ${action} failed: HTTP ${response.status}`);
  return (await response.json()) as T;
}

function mapCategoryDto(dto: XtreamCategoryDTO, source: Source): Category {
  return { id: idFor(source.id, dto.category_id), sourceId: source.id, providerId: dto.category_id, rawName: dto.category_name };
}

/** Pure DTO mapper — exported so Task 3's test exercises it without mocking `fetch`. */
export function mapMovieDto(dto: XtreamVodStreamDTO, source: Source, category: Category): Movie {
  return {
    id: idFor(source.id, String(dto.stream_id)),
    sourceId: source.id,
    categoryId: category.id,
    providerStreamId: String(dto.stream_id),
    name: dto.name,
    ...(dto.stream_icon !== undefined && dto.stream_icon !== "" ? { posterUrl: dto.stream_icon } : {}),
    ...(dto.container_extension !== undefined && dto.container_extension !== "" ? { containerExtension: dto.container_extension } : {}),
    ...(dto.rating !== undefined && String(dto.rating) !== "" && String(dto.rating) !== "0" ? { rating: String(dto.rating) } : {}),
  };
}

/** Pure DTO mapper — exported so Task 3's test exercises it without mocking `fetch`. */
export function mapSeriesDto(dto: XtreamSeriesListDTO, source: Source, category: Category): Series {
  return {
    id: idFor(source.id, String(dto.series_id)),
    sourceId: source.id,
    categoryId: category.id,
    providerSeriesId: String(dto.series_id),
    name: dto.name,
    ...(dto.cover !== undefined && dto.cover !== "" ? { posterUrl: dto.cover } : {}),
    ...(dto.rating !== undefined && String(dto.rating) !== "" && String(dto.rating) !== "0" ? { rating: String(dto.rating) } : {}),
    ...(dto.plot !== undefined && dto.plot !== "" ? { plot: dto.plot } : {}),
  };
}

/** Pure DTO mapper — exported so Task 3's test exercises it without mocking `fetch`. */
export function mapSeriesDetailsDto(dto: XtreamSeriesInfoDTO, series: Series): { seasons: Season[]; episodes: Episode[] } {
  const seasons: Season[] = (dto.seasons ?? []).map((s) => ({
    id: idFor(series.id, String(s.season_number)),
    seriesId: series.id,
    seasonNumber: s.season_number,
    ...(s.name !== undefined && s.name !== "" ? { name: s.name } : {}),
    ...(s.cover !== undefined && s.cover !== "" ? { posterUrl: s.cover } : {}),
  }));
  // Providers don't always list every season an episode references (e.g. season 0 "specials"
  // often has episodes but no `seasons` entry). `episodes.season_id` is a NOT NULL FK into
  // `seasons`, so any season number missing here would otherwise fail that insert.
  const knownSeasonNumbers = new Set(seasons.map((s) => s.seasonNumber));
  for (const e of Object.values(dto.episodes ?? {}).flat()) {
    if (knownSeasonNumbers.has(e.season)) continue;
    knownSeasonNumbers.add(e.season);
    seasons.push({ id: idFor(series.id, String(e.season)), seriesId: series.id, seasonNumber: e.season });
  }

  const episodes: Episode[] = Object.values(dto.episodes ?? {})
    .flat()
    .map((e) => {
      const seasonId = idFor(series.id, String(e.season));
      const durationSecs = toFiniteNumber(e.info?.duration_secs);
      return {
        id: idFor(seasonId, String(e.id)),
        seasonId,
        seriesId: series.id,
        providerEpisodeId: String(e.id),
        episodeNumber: e.episode_num,
        name: e.title,
        ...(e.container_extension !== undefined && e.container_extension !== "" ? { containerExtension: e.container_extension } : {}),
        ...(durationSecs !== undefined ? { durationSecs } : {}),
        ...(e.info?.plot !== undefined && e.info.plot !== "" ? { plot: e.info.plot } : {}),
      };
    });

  return { seasons, episodes };
}

export async function fetchVodCategories(source: Source, getCredentials: CredentialsLookup): Promise<Category[]> {
  const dtos = await call<XtreamCategoryDTO[]>(source, "get_vod_categories", {}, getCredentials);
  return dtos.map((dto) => mapCategoryDto(dto, source));
}

export async function fetchMovies(source: Source, category: Category, getCredentials: CredentialsLookup): Promise<Movie[]> {
  const dtos = await call<XtreamVodStreamDTO[]>(source, "get_vod_streams", { category_id: category.providerId }, getCredentials);
  return dtos.map((dto) => mapMovieDto(dto, source, category));
}

export async function fetchSeriesCategories(source: Source, getCredentials: CredentialsLookup): Promise<Category[]> {
  const dtos = await call<XtreamCategoryDTO[]>(source, "get_series_categories", {}, getCredentials);
  return dtos.map((dto) => mapCategoryDto(dto, source));
}

export async function fetchSeriesList(source: Source, category: Category, getCredentials: CredentialsLookup): Promise<Series[]> {
  const dtos = await call<XtreamSeriesListDTO[]>(source, "get_series", { category_id: category.providerId }, getCredentials);
  return dtos.map((dto) => mapSeriesDto(dto, source, category));
}

/** `get_series_info` — one API call per series. Called lazily; see `db/importVodDetails.ts`. */
export async function fetchSeriesDetails(
  source: Source,
  series: Series,
  getCredentials: CredentialsLookup,
): Promise<{ seasons: Season[]; episodes: Episode[] }> {
  const dto = await call<XtreamSeriesInfoDTO>(source, "get_series_info", { series_id: series.providerSeriesId }, getCredentials);
  return mapSeriesDetailsDto(dto, series);
}

/**
 * `get_vod_info` — plot/duration, plus (as a fallback source only) `container_extension` for
 * panels that omit it from the cheap bulk `get_vod_streams` call. Called lazily; see
 * `db/importVodDetails.ts`.
 */
export async function fetchVodDetails(
  source: Source,
  movie: Pick<Movie, "providerStreamId">,
  getCredentials: CredentialsLookup,
): Promise<{ plot?: string; durationSecs?: number; containerExtension?: string }> {
  const dto = await call<XtreamVodInfoDTO>(source, "get_vod_info", { vod_id: movie.providerStreamId }, getCredentials);
  const durationSecs = toFiniteNumber(dto.info?.duration_secs);
  return {
    ...(dto.info?.plot !== undefined && dto.info.plot !== "" ? { plot: dto.info.plot } : {}),
    ...(durationSecs !== undefined ? { durationSecs } : {}),
    ...(dto.movie_data?.container_extension !== undefined && dto.movie_data.container_extension !== ""
      ? { containerExtension: dto.movie_data.container_extension }
      : {}),
  };
}

export async function buildMovieStreamUrl(
  source: Source,
  movie: Pick<Movie, "providerStreamId" | "containerExtension">,
  getCredentials: CredentialsLookup,
): Promise<string> {
  if (source.kind !== "xtream") throw new Error("buildMovieStreamUrl used with a non-xtream source");
  const credentials = await getCredentials(source.id);
  const ext = movie.containerExtension && movie.containerExtension.length > 0 ? movie.containerExtension : "mp4";
  return `${credentials.baseUrl}/movie/${credentials.username}/${credentials.password}/${movie.providerStreamId}.${ext}`;
}

export async function buildEpisodeStreamUrl(
  source: Source,
  episode: Pick<Episode, "providerEpisodeId" | "containerExtension">,
  getCredentials: CredentialsLookup,
): Promise<string> {
  if (source.kind !== "xtream") throw new Error("buildEpisodeStreamUrl used with a non-xtream source");
  const credentials = await getCredentials(source.id);
  const ext = episode.containerExtension && episode.containerExtension.length > 0 ? episode.containerExtension : "mp4";
  return `${credentials.baseUrl}/series/${credentials.username}/${credentials.password}/${episode.providerEpisodeId}.${ext}`;
}
