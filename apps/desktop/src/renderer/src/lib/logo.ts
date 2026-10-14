/**
 * Rewrites a provider logo URL to go through the main-process cache scheme
 * (`src/main/logoCache.ts`) instead of the renderer fetching the CDN directly. Non-http inputs
 * (already-local, `data:`) and empty values pass straight through.
 */
export function logoSrc(url: string | null | undefined): string {
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) return url;
  return `testcard-logo://logo?u=${encodeURIComponent(url)}`;
}

/** TMDB's image path with its size part: `/t/p/original/…`, `/t/p/w600_and_h900_bestv2/…`. */
const TMDB = /^(https?:\/\/image\.tmdb\.org\/t\/p\/)[^/]+(\/.+)$/;

/**
 * `logoSrc` for film and series artwork, asked for at the size it is drawn at. Providers mostly link TMDB's `original`
 * images (often 2000 px tall) for a card a couple of hundred pixels wide. `card` is a poster in a grid or shelf, `large`
 * the detail pane. Other hosts are left as they are. Same rule as the TV app's `sized` (apps/mobile/src/ui/imageSize.ts).
 */
export function posterSrc(url: string | null | undefined, size: "card" | "large"): string {
  const match = url ? TMDB.exec(url) : null;
  return logoSrc(match === null ? url : `${match[1]}${size === "card" ? "w342" : "w780"}${match[2]}`);
}
