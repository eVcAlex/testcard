/** TMDB's image path with its size part: `/t/p/original/…`, `/t/p/w600_and_h900_bestv2/…`. */
const TMDB = /^(https?:\/\/image\.tmdb\.org\/t\/p\/)[^/]+(\/.+)$/;

/**
 * An artwork URL asked for at the size it is drawn at, where the host lets us choose. Providers mostly link TMDB's
 * `original` images (often 2000 px tall), which cost the Fire Stick a large download and decode for a 300 px card.
 * `card` is a poster on a row, `large` the hero and detail pages. Other hosts are left as they are.
 */
export function sized(url: string, size: "card" | "large"): string {
  const match = TMDB.exec(url);
  if (match === null) return url;
  return `${match[1]}${size === "card" ? "w342" : "w780"}${match[2]}`;
}
