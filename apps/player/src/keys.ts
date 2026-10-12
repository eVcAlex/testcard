import { channelKeyFor } from "@testcard/core/src/sync/channelHistory.ts";
import { remoteKeyFor, remoteKeyForPlaylistItem } from "@testcard/core/src/sync/remoteKey.ts";
import { movieKey, seriesKey } from "@testcard/core/src/source/m3u/classifyEntry.ts";

/**
 * The keys films, series, episodes and channels go by on the account, the same ones the apps compute, so a heart or a place
 * made here is the same one there. An Xtream item's is a hash of the provider's address and its own id; an M3U item's of the
 * playlist and its title. These are asynchronous (they hash), except a channel's.
 */

export const xtreamKey = (keyHost: string, providerId: string): Promise<string> => remoteKeyFor(keyHost, providerId);
export const movieKeyForPlaylist = (playlistUrl: string, title: string): Promise<string> => remoteKeyForPlaylistItem(playlistUrl, `movie|${movieKey(title)}`);
export const seriesKeyForPlaylist = (playlistUrl: string, show: string): Promise<string> => remoteKeyForPlaylistItem(playlistUrl, `series|${seriesKey(show)}`);
export const episodeKeyForPlaylist = (playlistUrl: string, show: string, season: number, episode: number): Promise<string> =>
  remoteKeyForPlaylistItem(playlistUrl, `episode|${seriesKey(show)}|s${season}e${episode}`);

/** A live channel's key. Only an Xtream source has one (its stream id is stable); `sourceKey` is the source's key on the account. */
export const channelKey = (sourceKey: string, streamId: string): string => channelKeyFor(sourceKey, "s", `s:${streamId}`) as string;
