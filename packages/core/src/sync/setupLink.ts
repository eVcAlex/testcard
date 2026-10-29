import { SetupProfilePayloadSchema, type SetupProfilePayload } from "@testcard/sync-schema";
import { parseSetupFragment, type SetupLink } from "./setupCrypto.js";

/** Where setup links point: the website's `/s` page, which hands the link to the app or offers the download. */
export const SETUP_LINK_ORIGIN = "https://evicted.dev";
/** The scheme the desktop app registers, so the page can open it directly. */
export const SETUP_APP_SCHEME = "testcard";

/** The shareable address: the secret is in the fragment, so it is never sent to a server by following it. */
export function setupLinkUrl(link: SetupLink): string {
  return `${SETUP_LINK_ORIGIN}/s#${link.id}.${link.secret}`;
}

/** The same link as the app opens it. */
export function setupAppUrl(link: SetupLink): string {
  return `${SETUP_APP_SCHEME}://s#${link.id}.${link.secret}`;
}

const HOSTS = new Set(["evicted.dev", "www.evicted.dev"]);

/**
 * Reads whatever a person pasted or the OS handed over: our `https://evicted.dev/s#...` address, the app's `testcard://s#...`
 * form, or just the part after the `#`. Anything else, including another host, is not a setup link (null). Strict because
 * the text may come from a web page or a message.
 */
export function parseSetupLinkText(text: string): SetupLink | null {
  const trimmed = text.trim();
  if (trimmed.length > 300) return null;
  const hash = trimmed.indexOf("#");
  if (hash === -1) return parseSetupFragment(trimmed);
  const head = trimmed.slice(0, hash).replace(/\/+$/, "");
  const fragment = trimmed.slice(hash + 1);
  const web = /^https:\/\/([^/?#]+)\/s$/i.exec(head);
  const app = new RegExp(`^${SETUP_APP_SCHEME}:(?://)?s$`, "i").test(head);
  if (!app && !(web !== null && HOSTS.has(web[1]!.toLowerCase()))) return null;
  return parseSetupFragment(fragment);
}

/** What the person is shown before agreeing: never a password, and for a playlist (whose address may hold a login) only its host. */
export interface SetupSummary {
  readonly name: string;
  readonly kind: "xtream" | "m3u";
  /** Host name only. */
  readonly host: string;
  readonly epgOptimise: boolean;
}

function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return "";
  }
}

export function summariseSetup(payload: SetupProfilePayload): SetupSummary {
  const { source } = payload;
  return "playlistUrl" in source
    ? { name: payload.name, kind: "m3u", host: hostOf(source.playlistUrl), epgOptimise: payload.epgOptimise === true }
    : { name: payload.name, kind: "xtream", host: hostOf(source.host), epgOptimise: payload.epgOptimise === true };
}

export interface SharedSourceInput {
  readonly name: string;
  readonly epgOptimise?: boolean;
  readonly content?: { readonly live: boolean; readonly movies: boolean; readonly series: boolean };
  readonly epgUrl?: string | null;
  readonly source:
    | { readonly kind: "xtream"; readonly host: string; readonly username: string; readonly password: string; readonly backupHosts?: readonly string[] }
    | { readonly kind: "m3u"; readonly playlistUrl: string };
}

/**
 * The one source to share, and only what the receiver needs to watch it. The sender's pins, hidden items, history and the like
 * are not part of it. Throws if the result is not an acceptable setup profile.
 */
export function buildSetupPayload(input: SharedSourceInput): SetupProfilePayload {
  const common = {
    ...(input.content !== undefined ? { content: { live: input.content.live, movies: input.content.movies, series: input.content.series } } : {}),
    ...(input.epgUrl ? { epgUrl: input.epgUrl } : {}),
  };
  const source =
    input.source.kind === "xtream"
      ? {
          host: input.source.host,
          username: input.source.username,
          password: input.source.password,
          ...(input.source.backupHosts !== undefined && input.source.backupHosts.length > 0 ? { backupHosts: [...input.source.backupHosts] } : {}),
          ...common,
        }
      : { playlistUrl: input.source.playlistUrl, ...common };
  return SetupProfilePayloadSchema.parse({ v: 1, name: input.name, ...(input.epgOptimise === true ? { epgOptimise: true } : {}), source });
}
