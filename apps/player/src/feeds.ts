import { channelDisplayName, fallbackRank, sameChannelKey } from "@testcard/core/src/normalise/displayName.ts";
import type { XtreamLogin } from "./xtream.ts";
import { liveUrls } from "./xtream.ts";

/** A live channel as the web player lists it. `urls` is every address that plays it, best first. */
export interface WebChannel {
  readonly id: string;
  readonly name: string;
  readonly key: string;
  readonly categoryId: string;
  readonly logo: string | undefined;
  readonly urls: readonly string[];
}

export function toChannel(stream: { id: string; name: string; categoryId: string; logo: string | undefined }, urls: readonly string[]): WebChannel {
  const name = channelDisplayName(stream.name);
  return { id: stream.id, name, key: sameChannelKey(name), categoryId: stream.categoryId, logo: stream.logo, urls };
}

export const xtreamChannel = (login: XtreamLogin, stream: { id: string; name: string; categoryId: string; logo: string | undefined }): WebChannel => toChannel(stream, liveUrls(login, stream.id));

/** Enough to get past a dead stream without trying every copy a large list carries. */
const MOST_FEEDS = 8;

/**
 * Every way to play a channel, in the order to try them: the channel itself, then the same channel listed in another
 * quality or category ("BBC One 4K" failing over to "BBC One HD"), HD first and 4K last. `pool` is whatever channels of the
 * source are loaded; a channel is never offered twice.
 */
export function feedsFor(channel: WebChannel, pool: readonly WebChannel[]): WebChannel[] {
  const others = pool
    .filter((other) => other.id !== channel.id && other.key === channel.key)
    .sort((a, b) => fallbackRank(a.name) - fallbackRank(b.name) || a.name.localeCompare(b.name));
  return [channel, ...others].slice(0, MOST_FEEDS);
}

/** What the viewer is told once a channel is playing on a feed other than the first. */
export function fellBackNote(first: WebChannel, now: WebChannel): string {
  return now.name !== first.name ? `Playing ${now.name} instead` : "Playing a backup feed instead";
}
