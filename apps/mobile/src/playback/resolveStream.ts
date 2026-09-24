import type Database from "better-sqlite3";
import { getPlaybackTarget } from "@testcard/core/src/db/queries.js";
import type { ChannelFeed } from "@testcard/core/src/db/channelFeeds.js";
import { getMoviePlaybackTarget } from "@testcard/core/src/db/vodQueries.js";
import { getEpisodePlaybackTarget } from "@testcard/core/src/db/seriesQueries.js";
import { getPlaybackProgress } from "@testcard/core/src/db/progressQueries.js";
import { createM3UAdapter } from "@testcard/core/src/source/m3u/adapter.js";
import { createXtreamAdapter } from "@testcard/core/src/source/xtream/client.js";
import { buildEpisodeStreamUrl, buildMovieStreamUrl } from "@testcard/core/src/source/xtream/vod.js";
import { buildTimeshiftUrl, type CatchupProgramme } from "@testcard/core/src/source/xtream/catchup.js";
import { getCredentials } from "../platform/secrets";

export type PlayKind = "channel" | "movie" | "episode";

export interface PlayItem {
  readonly kind: PlayKind;
  readonly id: string;
  readonly title: string;
}

export interface ResolvedStream {
  readonly url: string;
  readonly title: string;
  /** Where to start, for a film or episode that was left part-way. */
  readonly resumeSecs: number | null;
}

const xtream = createXtreamAdapter(getCredentials);
const m3u = createM3UAdapter();

/**
 * Turns a channel, film or episode id into a playable URL. As on desktop, an M3U film or episode
 * stores its direct URL as the provider id; Xtream URLs are built from the stored login. The URL
 * goes straight to the player and is never shown or logged. With `catchup`, a channel plays that past programme
 * from its start instead of the live picture. With `feed`, a channel plays that one of its feeds (see `listChannelFeeds`).
 */
export async function resolveStream(db: Database.Database, item: PlayItem, resume: boolean, catchup?: CatchupProgramme, feed?: ChannelFeed): Promise<ResolvedStream> {
  if (item.kind === "channel") {
    const target = feed !== undefined ? getPlaybackTarget(db, feed.channelId, feed.variantId) : getPlaybackTarget(db, item.id);
    if (target === undefined) throw new Error("That channel is no longer available.");
    if (catchup !== undefined) {
      const url = await buildTimeshiftUrl(target.source, target.variant.providerStreamId, catchup, getCredentials);
      return { url, title: `${catchup.title} on ${item.title}`, resumeSecs: null };
    }
    const adapter = target.source.kind === "xtream" ? xtream : m3u;
    return { url: await adapter.buildStreamUrl(target.source, target.variant), title: item.title, resumeSecs: null };
  }

  if (item.kind === "movie") {
    const target = getMoviePlaybackTarget(db, item.id);
    if (target === undefined) throw new Error("That movie could not be found.");
    const url =
      target.source.kind === "m3u"
        ? target.providerStreamId
        : await buildMovieStreamUrl(
            target.source,
            { providerStreamId: target.providerStreamId, ...(target.containerExtension !== null ? { containerExtension: target.containerExtension } : {}) },
            getCredentials,
          );
    const progress = getPlaybackProgress(db, "movie", item.id);
    return { url, title: target.movieName, resumeSecs: resume && progress ? progress.position_secs : null };
  }

  const target = getEpisodePlaybackTarget(db, item.id);
  if (target === undefined) throw new Error("That episode could not be found.");
  const url =
    target.source.kind === "m3u"
      ? target.providerEpisodeId
      : await buildEpisodeStreamUrl(
          target.source,
          { providerEpisodeId: target.providerEpisodeId, ...(target.containerExtension !== null ? { containerExtension: target.containerExtension } : {}) },
          getCredentials,
        );
  const progress = getPlaybackProgress(db, "episode", item.id);
  return { url, title: target.episodeName, resumeSecs: resume && progress ? progress.position_secs : null };
}
