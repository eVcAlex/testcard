import { classifyEntry } from "@testcard/core/src/source/m3u/classifyEntry.ts";
import { parseM3U } from "@testcard/core/src/source/m3u/parseM3U.ts";
import { toChannel, type WebChannel } from "./feeds.ts";
import { describeFailure } from "./xtream.ts";
import { viaProxy } from "./proxy.ts";

export interface PlaylistMovie {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string;
  readonly poster: string | undefined;
  readonly url: string;
}

export interface Playlist {
  readonly categories: readonly { id: string; name: string }[];
  readonly live: readonly WebChannel[];
  readonly movies: readonly PlaylistMovie[];
}

/** Reads an M3U source in the browser: live channels and films, grouped by the playlist's own groups. Episodes are left to the apps. */
export async function loadPlaylist(playlistUrl: string): Promise<Playlist> {
  const response = await fetch(viaProxy(playlistUrl));
  if (!response.ok || response.body === null) throw new Error(await describeFailure(response));
  const groups = new Map<string, string>();
  const live: WebChannel[] = [];
  const movies: PlaylistMovie[] = [];
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
    else if (classified.kind === "movie") movies.push({ id: String(n), name: classified.title, categoryId: group, poster: logo, url: entry.url });
  }
  return { categories: [...groups.keys()].map((name) => ({ id: name, name })), live, movies };
}
