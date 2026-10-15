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
