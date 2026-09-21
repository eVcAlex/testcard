import type Database from "better-sqlite3";
import { getPlaybackTarget } from "@testcard/core/src/db/queries.js";
import { fetchShortEpg } from "@testcard/core/src/source/xtream/client.js";
import { fetchCatchupProgrammes } from "@testcard/core/src/source/xtream/catchup.js";
import { getCredentials } from "../platform/secrets";

/** A programme on a channel, in epoch ms. */
export interface Airing {
  readonly title: string;
  readonly start: number;
  readonly end: number;
}

/** What is on a channel now and what follows. Either can be missing. */
export interface ChannelGuide {
  readonly now: Airing | null;
  readonly next: Airing | null;
}

/**
 * What a channel is showing, asked of the provider for that one channel. The short guide is tried first; some
 * providers only list what is coming up there, so the full table (the one catch-up reads) fills in the rest.
 * Null when the source has no guide. Read on demand and optional: playback never waits for it.
 */
export async function fetchGuide(db: Database.Database, channelId: string): Promise<ChannelGuide | null> {
  const target = getPlaybackTarget(db, channelId);
  if (target === undefined || target.source.kind !== "xtream") return null;
  const streamId = target.variant.providerStreamId;
  const at = Date.now();
  const cover = (start: Date, end: Date) => start.getTime() <= at && at < end.getTime();

  const short = await fetchShortEpg(target.source, streamId, getCredentials).catch(() => []);
  let now: Airing | null = null;
  let next: Airing | null = null;
  const current = short.find((entry) => cover(entry.start, entry.end));
  const upcoming = short.find((entry) => entry.start.getTime() > at);
  if (current !== undefined) now = { title: current.title, start: current.start.getTime(), end: current.end.getTime() };
  if (upcoming !== undefined) next = { title: upcoming.title, start: upcoming.start.getTime(), end: upcoming.end.getTime() };

  if (now === null) {
    const table = await fetchCatchupProgrammes(target.source, streamId, getCredentials).catch(() => []);
    const running = table.find((entry) => cover(entry.start, entry.end));
    if (running !== undefined) now = { title: running.title, start: running.start.getTime(), end: running.end.getTime() };
    if (next === null) {
      const after = table.find((entry) => entry.start.getTime() > at);
      if (after !== undefined) next = { title: after.title, start: after.start.getTime(), end: after.end.getTime() };
    }
  }
  return now === null && next === null ? null : { now, next };
}
