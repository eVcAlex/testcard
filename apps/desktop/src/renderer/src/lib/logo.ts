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
