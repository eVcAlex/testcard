/**
 * Two devices pointed at the same Xtream provider assign different *local* ids to the same
 * movie (`idFor(source.id, stream_id)` — `source.id` is a per-device UUID). Sync needs a
 * device-independent key instead: a hash of the provider's own host + its own stream/series/
 * episode id, which is the same on every device that points at that provider. See the design
 * spec's "Portable content identity".
 */

/** Strips scheme/port/trailing-slash noise so the same panel reached two ways still collapses. */
export function normalizeProviderHost(rawHost: string): string {
  const withScheme = rawHost.includes("://") ? rawHost : `http://${rawHost}`;
  const url = new URL(withScheme);
  const isDefaultPort = url.port === "" || url.port === "80" || url.port === "443";
  return `${url.hostname.toLowerCase()}${isDefaultPort ? "" : `:${url.port}`}`;
}

/** `sha1(normalizedHost + '|' + providerId)`, hex-encoded. */
export async function remoteKeyFor(providerHost: string, providerId: string): Promise<string> {
  const data = new TextEncoder().encode(`${normalizeProviderHost(providerHost)}|${providerId}`);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
