import type { WebChannel } from "./feeds.ts";
import { xtreamChannel } from "./feeds.ts";
import { xtreamKey } from "./keys.ts";
import { loadPlaylist, type Playlist } from "./playlist.ts";
import type { WebSource } from "./session.ts";
import { call, episodeUrl, movieUrl, toCategories, toEpisodes, toLive, toMovies, toSeriesList, type Category, type XtreamLogin } from "./xtream.ts";

/** A film as the browser lists it, with the address that plays it. */
export interface Film {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string;
  readonly poster: string | undefined;
  readonly url: string;
  /** Its key on the account, for favourites, recents and places. */
  readonly key: string;
}
export interface Show {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string;
  readonly cover: string | undefined;
  readonly plot: string | undefined;
  readonly key: string;
}
export interface Part {
  readonly id: string;
  readonly key: string;
  readonly season: number;
  readonly number: number;
  readonly title: string;
  readonly url: string;
}

// What has been fetched this visit, by source. Held in memory only: a catalogue is large, and the provider is slow to ask.
const memo = new Map<string, Promise<unknown>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  let found = memo.get(key) as Promise<T> | undefined;
  if (found === undefined) {
    found = make();
    memo.set(key, found);
    // A failure is not kept, so Try again asks afresh.
    found.catch(() => memo.delete(key));
  }
  return found;
}
export const forgetCatalogue = (): void => memo.clear();

/** What an Xtream source's items are keyed by on the account: the address it was first added with, which survives a provider moving. */
const keyHostOf = (source: WebSource): string => (source.kind === "xtream" ? source.keyHost : "");

const playlistOf = (source: Extract<WebSource, { kind: "m3u" }>): Promise<Playlist> => once(`${source.id}:playlist`, () => loadPlaylist(source.playlistUrl));
const loginOf = (source: WebSource): XtreamLogin => {
  if (source.kind !== "xtream") throw new Error("Not an Xtream source.");
  return source.login;
};

export async function categories(source: WebSource, kind: "live" | "movies" | "series"): Promise<Category[]> {
  if (source.kind === "m3u") {
    const list = await playlistOf(source);
    const used = new Set((kind === "live" ? list.live : kind === "movies" ? list.movies : list.shows).map((item) => item.categoryId));
    return list.categories.filter((category) => used.has(category.id));
  }
  const action = kind === "live" ? "get_live_categories" : kind === "movies" ? "get_vod_categories" : "get_series_categories";
  return once(`${source.id}:cats:${kind}`, async () => toCategories(await call(loginOf(source), action)));
}

/** Live channels in one category, or all of them (a big download: used for search and for finding another feed). */
export async function liveChannels(source: WebSource, categoryId?: string): Promise<WebChannel[]> {
  if (source.kind === "m3u") {
    const list = await playlistOf(source);
    return list.live.filter((channel) => categoryId === undefined || channel.categoryId === categoryId);
  }
  const login = loginOf(source);
  return once(`${source.id}:live:${categoryId ?? "*"}`, async () => toLive(await call(login, "get_live_streams", categoryId === undefined ? {} : { category_id: categoryId })).map((stream) => xtreamChannel(login, stream, source.id)));
}

export async function films(source: WebSource, categoryId?: string): Promise<Film[]> {
  if (source.kind === "m3u") {
    const list = await playlistOf(source);
    return list.movies.filter((movie) => categoryId === undefined || movie.categoryId === categoryId);
  }
  const login = loginOf(source);
  return once(`${source.id}:films:${categoryId ?? "*"}`, async () => {
      const rows = toMovies(await call(login, "get_vod_streams", categoryId === undefined ? {} : { category_id: categoryId }));
      const keys = await Promise.all(rows.map((movie) => xtreamKey(keyHostOf(source), movie.id)));
      return rows.map((movie, index) => ({ id: movie.id, name: movie.name, categoryId: movie.categoryId, poster: movie.poster, url: movieUrl(login, movie.id, movie.extension), key: keys[index] as string }));
  });
}

export async function shows(source: WebSource, categoryId?: string): Promise<Show[]> {
  if (source.kind === "m3u") {
    const list = await playlistOf(source);
    return list.shows.filter((show) => categoryId === undefined || show.categoryId === categoryId).map((show) => ({ id: show.id, name: show.name, categoryId: show.categoryId, cover: show.cover, plot: undefined, key: show.key }));
  }
  const login = loginOf(source);
  return once(`${source.id}:shows:${categoryId ?? "*"}`, async () => {
    const rows = toSeriesList(await call(login, "get_series", categoryId === undefined ? {} : { category_id: categoryId }));
    const keys = await Promise.all(rows.map((show) => xtreamKey(keyHostOf(source), show.id)));
    return rows.map((show, index) => ({ ...show, key: keys[index] as string }));
  });
}

export async function episodesOf(source: WebSource, show: Show): Promise<Part[]> {
  if (source.kind === "m3u") {
    const found = (await playlistOf(source)).shows.find((candidate) => candidate.id === show.id);
    return (found?.episodes ?? []).map((episode) => ({ id: episode.id, key: episode.key, season: episode.season, number: episode.number, title: episode.title, url: episode.url }));
  }
  const login = loginOf(source);
  return once(`${source.id}:episodes:${show.id}`, async () => {
    const rows = toEpisodes(await call(login, "get_series_info", { series_id: show.id }));
    const keys = await Promise.all(rows.map((episode) => xtreamKey(keyHostOf(source), episode.id)));
    return rows.map((episode, index) => ({ id: episode.id, key: keys[index] as string, season: episode.season, number: episode.number, title: episode.title, url: episodeUrl(login, episode.id, episode.extension) }));
  });
}
