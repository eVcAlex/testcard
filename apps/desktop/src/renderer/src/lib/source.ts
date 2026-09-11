import type { SourceListItem } from "../../../shared/ipc.js";

/**
 * The host to show on a source card. Only `URL.host` — never the full playlist/base URL — so a
 * playlist link carrying a token in its query string can't leak onto the card. Falls back to
 * the raw string if it doesn't parse as a URL (shouldn't happen for anything that passed
 * `verifySource`/`verifyXtreamCredentials`, but a card must never throw over it).
 */
export function sourceHost(source: SourceListItem): string {
  const raw = source.kind === "xtream" ? source.baseUrl : source.playlistUrl;
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}

/** The letter shown on a source's avatar chip. */
export function sourceInitial(source: SourceListItem): string {
  return source.name.trim().charAt(0).toUpperCase() || "?";
}
