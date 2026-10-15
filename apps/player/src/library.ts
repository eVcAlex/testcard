import type { SyncClient } from "@testcard/core/src/sync/client.ts";
import type { SyncChannelFavourite, SyncFavourite, SyncProgress, SyncPullResponse, SyncPushRequest, SyncRecent } from "@testcard/sync-schema";

/** What the account remembers about what was watched, for one profile: the same favourites, recents and places the apps have. */
export type Shelf = "movieFavs" | "movieRecents" | "seriesFavs" | "seriesRecents" | "channelFavs" | "channelRecents";
export interface Place {
  readonly position: number;
  readonly duration: number | null;
  readonly watched: boolean;
}

/** How soon a change is sent. Several in a row (a few hearts, a film's progress) go as one. */
const SEND_AFTER_MS = 1500;
/** A film or episode counts as watched this far through. */
const WATCHED_AT = 0.95;

type Row = { remoteKey: string; updatedAt: number; deletedAt: number | null };

/**
 * Held in memory for one profile. Rows come from the account when the profile is opened, and what the viewer does here
 * (a heart, a film begun, a place kept) is sent back with a newer timestamp, so it shows up in the apps; theirs show up here.
 */
export class Library {
  private readonly shelves: Record<Shelf, Map<string, number>> = {
    movieFavs: new Map(),
    movieRecents: new Map(),
    seriesFavs: new Map(),
    seriesRecents: new Map(),
    channelFavs: new Map(),
    channelRecents: new Map(),
  };
  /** Channel favourites the viewer has put in their own order: key -> position. */
  private readonly channelOrder = new Map<string, number>();
  private readonly places = new Map<string, Place>();
  private readonly listeners = new Set<() => void>();
  private waiting: SyncPushRequest = Library.empty();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failed = false;

  constructor(
    private readonly client: Pick<SyncClient, "push">,
    private readonly prefix: string,
    pulled: SyncPullResponse,
    private readonly now: () => number = Date.now,
  ) {
    const mine = <T extends Row>(rows: readonly T[]) => rows.filter((row) => (prefix === "" ? !row.remoteKey.startsWith("p.") : row.remoteKey.startsWith(prefix)) && row.deletedAt === null);
    const strip = (key: string) => key.slice(prefix.length);
    const fill = (shelf: Shelf, rows: readonly (SyncFavourite | SyncRecent | SyncChannelFavourite)[]) => {
      for (const row of mine(rows)) this.shelves[shelf].set(strip(row.remoteKey), "addedAt" in row ? row.addedAt : row.playedAt);
    };
    fill("movieFavs", pulled.movieFavourites);
    fill("movieRecents", pulled.movieRecents);
    fill("seriesFavs", pulled.seriesFavourites);
    fill("seriesRecents", pulled.seriesRecents);
    fill("channelFavs", pulled.channelFavourites);
    fill("channelRecents", pulled.channelRecents);
    for (const row of mine(pulled.channelFavourites)) if (row.position !== null) this.channelOrder.set(strip(row.remoteKey), row.position);
    for (const row of mine(pulled.progress)) this.places.set(strip(row.remoteKey), { position: row.positionSecs, duration: row.durationSecs, watched: row.watched });
  }

  private static empty(): SyncPushRequest {
    return { sources: [], movieFavourites: [], movieRecents: [], seriesFavourites: [], seriesRecents: [], progress: [], profiles: [], channelFavourites: [], channelRecents: [] };
  }

  /** Call to be told when something changed (a heart, a place), so a list can redraw. Answers a function that stops it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  has(shelf: Shelf, key: string): boolean {
    return this.shelves[shelf].has(key);
  }

  /** The keys on a shelf: favourites in the viewer's order (channels) or newest first, recents newest first. */
  keys(shelf: Shelf): string[] {
    const entries = [...this.shelves[shelf]];
    if (shelf === "channelFavs") {
      return entries
        .sort(([a, at], [b, bt]) => (this.channelOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (this.channelOrder.get(b) ?? Number.MAX_SAFE_INTEGER) || bt - at)
        .map(([key]) => key);
    }
    return entries.sort((a, b) => b[1] - a[1]).map(([key]) => key);
  }

  placeOf(key: string): Place | undefined {
    return this.places.get(key);
  }

  /** Adds or takes away a favourite. */
  toggleFavourite(shelf: "movieFavs" | "seriesFavs" | "channelFavs", key: string): boolean {
    const t = this.now();
    const adding = !this.shelves[shelf].has(key);
    if (adding) this.shelves[shelf].set(key, t);
    else {
      this.shelves[shelf].delete(key);
      this.channelOrder.delete(key);
    }
    const row = { remoteKey: this.prefix + key, addedAt: t, updatedAt: t, deletedAt: adding ? null : t };
    if (shelf === "movieFavs") this.waiting.movieFavourites.push(row);
    else if (shelf === "seriesFavs") this.waiting.seriesFavourites.push(row);
    else this.waiting.channelFavourites.push({ ...row, position: null });
    this.queue();
    this.changed();
    return adding;
  }

  /** Notes that something was started, so it leads the Recent list in every app. */
  played(shelf: "movieRecents" | "seriesRecents" | "channelRecents", key: string): void {
    const t = this.now();
    this.shelves[shelf].set(key, t);
    const row = { remoteKey: this.prefix + key, playedAt: t, updatedAt: t, deletedAt: null };
    if (shelf === "movieRecents") this.waiting.movieRecents.push(row);
    else if (shelf === "seriesRecents") this.waiting.seriesRecents.push(row);
    else this.waiting.channelRecents.push(row);
    this.queue();
    this.changed();
  }

  /** Keeps the place in a film or episode. Past 95% it counts as watched. */
  keepPlace(key: string, kind: "movie" | "episode", position: number, duration: number | null): void {
    const whole = Math.floor(position);
    if (!Number.isFinite(whole) || whole < 0) return;
    const length = duration !== null && Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : null;
    const watched = length !== null && whole / length >= WATCHED_AT;
    const place: Place = { position: whole, duration: length === 0 ? null : length, watched };
    this.places.set(key, place);
    const t = this.now();
    const row: SyncProgress = { remoteKey: this.prefix + key, itemType: kind, positionSecs: place.position, durationSecs: place.duration, watched, updatedAt: t, deletedAt: null };
    this.waiting.progress = [...this.waiting.progress.filter((queued) => queued.remoteKey !== row.remoteKey), row];
    this.queue();
    this.changed();
  }

  private queue(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => void this.send(), SEND_AFTER_MS);
  }

  /** Sends what is waiting now (the player closing, the tab being left). A failure keeps it for the next try. */
  async send(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const batch = this.waiting;
    if (Object.values(batch).every((rows) => rows.length === 0)) return;
    this.waiting = Library.empty();
    try {
      await this.client.push(batch);
      this.failed = false;
    } catch {
      this.failed = true;
      // Back in the queue, ahead of anything newer for the same row.
      const merged = Library.empty();
      for (const name of Object.keys(merged) as (keyof SyncPushRequest)[]) {
        const rows = new Map<string, unknown>();
        for (const row of [...batch[name], ...this.waiting[name]] as { remoteKey: string }[]) rows.set(row.remoteKey, row);
        (merged[name] as unknown[]) = [...rows.values()];
      }
      this.waiting = merged;
      this.timer = setTimeout(() => void this.send(), SEND_AFTER_MS * 10);
    }
  }

  /** True while changes could not be sent (offline, signed out elsewhere). */
  get unsaved(): boolean {
    return this.failed;
  }
}
