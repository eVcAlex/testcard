import { classifyEntry } from "@testcard/core/src/source/m3u/classifyEntry.ts";
import { parseM3U } from "@testcard/core/src/source/m3u/parseM3U.ts";
import { seriesKey } from "@testcard/core/src/source/m3u/classifyEntry.ts";
import { episodeKeyForPlaylist, movieKeyForPlaylist, seriesKeyForPlaylist } from "./keys.ts";
import { toChannel, type WebChannel } from "./feeds.ts";
import { describeFailure } from "./xtream.ts";
import { viaProxy } from "./proxy.ts";

export interface PlaylistMovie {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string;
  readonly poster: string | undefined;
  readonly url: string;
  key: string;
}
export interface PlaylistEpisode {
  readonly id: string;
  readonly season: number;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  key: string;
}
export interface PlaylistShow {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string;
  readonly cover: string | undefined;
  key: string;
  readonly episodes: PlaylistEpisode[];
}

export interface Playlist {
  readonly categories: readonly { id: string; name: string }[];
  readonly live: readonly WebChannel[];
  readonly movies: readonly PlaylistMovie[];
  readonly shows: readonly PlaylistShow[];
}

/** Reads an M3U source in the browser: live channels and films, grouped by the playlist's own groups. Episodes are grouped into series by title, as the apps do. */
export async function loadPlaylist(playlistUrl: string): Promise<Playlist> {
  const response = await fetch(viaProxy(playlistUrl));
  if (!response.ok || response.body === null) throw new Error(await describeFailure(response));
  const groups = new Map<string, string>();
  const live: WebChannel[] = [];
  const movies: PlaylistMovie[] = [];
  const shows = new Map<string, PlaylistShow>();
  const pending: Promise<void>[] = [];
  let n = 0;
  for await (const item of parseM3U(response.body as unknown as AsyncIterable<Uint8Array>)) {
    if (item.kind !== "entry") continue;
    const { entry } = item;
    const group = entry.groupTitle ?? "Other";
    if (!groups.has(group)) groups.set(group, group);
    n += 1;
    const classified = classifyEntry({ rawName: entry.rawName, url: entry.url });
    const logo = entry.attributes["tvg-logo"] || undefined;
    if (classified.kind === "live") live.push(toChannel({ id: String(n), name: entry.rawName, categoryId: group, logo }, [entry.url]));
    else if (classified.kind === "movie") {
      const movie = { id: String(n), name: classified.title, categoryId: group, poster: logo, url: entry.url, key: "" };
      movies.push(movie);
      pending.push(movieKeyForPlaylist(playlistUrl, classified.title).then((key) => void (movie.key = key)));
    } else {
      const showId = seriesKey(classified.series);
      if (showId === "") continue;
      let show = shows.get(showId);
      if (show === undefined) {
        show = { id: showId, name: classified.series, categoryId: group, cover: logo, key: "", episodes: [] };
        shows.set(showId, show);
        const created = show;
        pending.push(seriesKeyForPlaylist(playlistUrl, classified.series).then((key) => void (created.key = key)));
      }
      // The same episode listed twice (another quality): the first one wins.
      if (show.episodes.some((episode) => episode.season === classified.season && episode.number === classified.episode)) continue;
      const episode = { id: String(n), season: classified.season, number: classified.episode, title: classified.title !== "" ? classified.title : `Episode ${classified.episode}`, url: entry.url, key: "" };
      show.episodes.push(episode);
      pending.push(episodeKeyForPlaylist(playlistUrl, classified.series, classified.season, classified.episode).then((key) => void (episode.key = key)));
    }
  }
  await Promise.all(pending);
  for (const show of shows.values()) show.episodes.sort((a, b) => a.season - b.season || a.number - b.number);
  return { categories: [...groups.keys()].map((name) => ({ id: name, name })), live, movies, shows: [...shows.values()] };
}
