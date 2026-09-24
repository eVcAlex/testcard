import type Database from "better-sqlite3";
import { getPlaybackTarget, programmesInWindow } from "@testcard/core/src/db/queries.js";
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

/** Thrown to a caller whose guide was never fetched because another channel was asked for while it waited. */
export class GuideSuperseded extends Error {
  constructor() {
    super("Another channel's guide was asked for first.");
  }
}

/** How long a channel's answer is reused when nothing in it says sooner (no guide, or nothing airing now). */
const FRESH_MS = 5 * 60 * 1000;
const answers = new Map<string, { guide: ChannelGuide | null; until: number }>();
const pending = new Map<string, Promise<ChannelGuide | null>>();
let queue: Promise<unknown> = Promise.resolve();
let latest: string | undefined;

/**
 * What a channel is showing, asked of the provider for that one channel. Null when the source has no guide. Read on
 * demand and optional: playback never waits for it.
 *
 * One channel is asked about at a time, and only the latest one asked for: the full table the fallback downloads
 * can run to days of listings, parsed on the JS thread, and resting on channel after channel down a Live TV page
 * used to leave a queue of them landing (and stalling the app) long after the viewer had moved to another page.
 * A channel still waiting when a newer one is asked for is dropped with `GuideSuperseded`. Answers are kept until
 * the programme airing ends, so coming back to a channel costs nothing.
 */
export function fetchGuide(db: Database.Database, channelId: string): Promise<ChannelGuide | null> {
  const known = answers.get(channelId);
  if (known !== undefined && Date.now() < known.until) return Promise.resolve(known.guide);
  latest = channelId;
  const inFlight = pending.get(channelId);
  if (inFlight !== undefined) return inFlight;
  const run = queue.then(async () => {
    if (latest !== channelId) throw new GuideSuperseded();
    const guide = await readGuide(db, channelId);
    const now = Date.now();
    answers.set(channelId, { guide, until: guide?.now != null ? Math.min(guide.now.end, now + 30 * 60 * 1000) : now + FRESH_MS });
    return guide;
  });
  const settled = run.finally(() => pending.delete(channelId));
  pending.set(channelId, settled);
  queue = settled.catch(() => undefined);
  return settled;
}

/**
 * The short guide is tried first; some providers only list what is coming up there, so the full table (the one
 * catch-up reads) fills in the rest. That table can run to days of listings, parsed on the UI's thread, so it is
 * only read for a channel that keeps past programmes (the providers that fill it); for others it is empty anyway.
 */
async function readGuide(db: Database.Database, channelId: string): Promise<ChannelGuide | null> {
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

  if (now === null && keepsPast(db, channelId)) {
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

function keepsPast(db: Database.Database, channelId: string): boolean {
  const row = db.prepare(`SELECT catchup_days AS days FROM channels WHERE id = ?`).get(channelId) as { days: number | null } | undefined;
  return (row?.days ?? 0) > 0;
}

/** How many programmes the guide grid asks the provider for per channel: enough for most of a day. */
const LISTINGS_LIMIT = 24;
/** How long a channel's listings are reused before they are asked for again. */
const LISTINGS_FRESH_MS = 20 * 60 * 1000;
/** Channels asked about at once: enough to fill a screen of the guide quickly without flooding the provider. */
const LISTINGS_AT_ONCE = 3;

const listings = new Map<string, { airings: readonly Airing[]; until: number }>();
const listingsPending = new Map<string, Promise<readonly Airing[]>>();
const listingsQueue: (() => void)[] = [];
let listingsRunning = 0;

function nextListing(): void {
  while (listingsRunning < LISTINGS_AT_ONCE && listingsQueue.length > 0) {
    // Newest first: the rows the viewer has just scrolled to matter more than the ones they scrolled past.
    const run = listingsQueue.pop()!;
    listingsRunning += 1;
    run();
  }
}

/** Listings already fetched for a channel and still fresh, without asking the provider. */
export function knownListings(channelId: string): readonly Airing[] | undefined {
  const known = listings.get(channelId);
  return known !== undefined && Date.now() < known.until ? known.airings : undefined;
}

/**
 * A channel's programmes from now on, in start order, for the guide grid: from the imported guide when the
 * database has one for it, else asked of the provider (Xtream only). Empty when neither has anything. A few
 * channels are asked about at a time, newest request first, and answers are kept for a while.
 */
export function fetchListings(db: Database.Database, channelId: string): Promise<readonly Airing[]> {
  const known = knownListings(channelId);
  if (known !== undefined) return Promise.resolve(known);
  const inFlight = listingsPending.get(channelId);
  if (inFlight !== undefined) return inFlight;
  const promise = new Promise<readonly Airing[]>((resolve) => {
    listingsQueue.push(() => {
      readListings(db, channelId)
        .catch(() => [] as Airing[])
        .then((airings) => {
          listings.set(channelId, { airings, until: Date.now() + LISTINGS_FRESH_MS });
          listingsPending.delete(channelId);
          listingsRunning -= 1;
          resolve(airings);
          nextListing();
        });
    });
    nextListing();
  });
  listingsPending.set(channelId, promise);
  return promise;
}

async function readListings(db: Database.Database, channelId: string): Promise<Airing[]> {
  const at = Date.now();
  const stored = programmesInWindow(db, [channelId], at - 6 * 60 * 60 * 1000, at + 36 * 60 * 60 * 1000);
  if (stored.length > 0) return stored.map((row) => ({ title: row.title, start: row.start_at, end: row.end_at }));
  const target = getPlaybackTarget(db, channelId);
  if (target === undefined || target.source.kind !== "xtream") return [];
  const short = await fetchShortEpg(target.source, target.variant.providerStreamId, getCredentials, LISTINGS_LIMIT);
  return short
    .map((entry) => ({ title: entry.title, start: entry.start.getTime(), end: entry.end.getTime() }))
    .filter((airing) => airing.end > airing.start)
    .sort((a, b) => a.start - b.start);
}
