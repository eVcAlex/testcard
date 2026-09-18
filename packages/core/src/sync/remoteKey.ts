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

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** `sha1(normalizedHost + '|' + providerId)`, hex-encoded. */
export function remoteKeyFor(providerHost: string, providerId: string): Promise<string> {
  return sha1Hex(`${normalizeProviderHost(providerHost)}|${providerId}`);
}

/**
 * Identity of an M3U source. Unlike Xtream there is no stable provider id, and one host often
 * serves many playlists that differ only by query string, so the whole URL is the identity.
 */
export function remoteKeyForPlaylist(playlistUrl: string): Promise<string> {
  return sha1Hex(`m3u|${playlistUrl.trim()}`);
}

/**
 * Identity of a film or episode inside an M3U playlist, shared by every device on the same
 * playlist. Built from the title (`itemKey`), never the stream URL, which often embeds a login
 * or a rotating token.
 */
export function remoteKeyForPlaylistItem(playlistUrl: string, itemKey: string): Promise<string> {
  return sha1Hex(`m3u|${playlistUrl.trim()}|${itemKey}`);
}
