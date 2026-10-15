/** A live picture that stops to refill is moved to the next feed once it has been stuck this long (a blip is not one). */
export const BUFFER_FAILOVER_MS = 3_000;
/** How long a feed may take to show a first picture before the next is tried. */
export const START_WITHIN_MS = 15_000;

export type HealthAction = "failover" | null;

/**
 * What the player does about a live stream that is not behaving, as the Fire TV app does (`PlaybackHealth.kt`): a feed that
 * errors or never starts, or one that has played and then sits buffering, is moved on from while another feed is left. The
 * viewer can turn the buffering switch off. Time comes from `now`, so tests run on a fake clock.
 */
export class FeedHealth {
  private everPlayed = false;
  private waitingSince: number | null = null;
  private readonly startedAt: number;

  constructor(
    private readonly now: () => number,
    private readonly moreFeeds: boolean,
    private readonly switchOnBuffering: boolean | (() => boolean),
  ) {
    this.startedAt = now();
  }

  /** The picture is moving. */
  onPlaying(): void {
    this.everPlayed = true;
    this.waitingSince = null;
  }

  /** The picture stopped to refill. */
  onWaiting(): void {
    if (this.waitingSince === null) this.waitingSince = this.now();
  }

  /** The stream failed outright. */
  onError(): HealthAction {
    return this.moreFeeds ? "failover" : null;
  }

  /** Called every half second or so. */
  tick(): HealthAction {
    if (!this.moreFeeds) return null;
    const t = this.now();
    if (!this.everPlayed && t - this.startedAt >= START_WITHIN_MS) return "failover";
    if (this.everPlayed && (typeof this.switchOnBuffering === "function" ? this.switchOnBuffering() : this.switchOnBuffering) && this.waitingSince !== null && t - this.waitingSince >= BUFFER_FAILOVER_MS) return "failover";
    return null;
  }
}

/** Quiet reconnects allowed in a row, and how long a picture must run before they are counted afresh. */
export const MAX_RECONNECTS = 3;
export const STABLE_MS = 30_000;

/**
 * Cloudflare cuts a long stream now and then (runtime updates), and a provider drops a connection. A picture that had been
 * playing and is lost is reconnected without the viewer being told, a few times; one that runs for {@link STABLE_MS}
 * between losses starts the count again, so a stream that keeps failing still ends in the error screen.
 */
export class Reconnects {
  private used = 0;
  private playingSince: number | null = null;

  constructor(private readonly now: () => number) {}

  onPlaying(): void {
    this.playingSince ??= this.now();
  }

  /** The picture was lost. True if it should be reconnected quietly. */
  take(): boolean {
    if (this.playingSince !== null && this.now() - this.playingSince >= STABLE_MS) this.used = 0;
    this.playingSince = null;
    if (this.used >= MAX_RECONNECTS) return false;
    this.used += 1;
    return true;
  }
}
