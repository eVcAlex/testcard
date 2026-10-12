import { viaProxy } from "./proxy.ts";

export interface XtreamLogin {
  readonly host: string;
  readonly username: string;
  readonly password: string;
}

/** A provider's address as typed: scheme defaulted to http, no trailing slash. */
export function baseOf(host: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `http://${host}`;
  return withScheme.replace(/\/+$/, "");
}

const creds = (login: XtreamLogin) => `${encodeURIComponent(login.username)}/${encodeURIComponent(login.password)}`;

export function apiUrl(login: XtreamLogin, action: string, params: Record<string, string> = {}): string {
  const url = new URL(`${baseOf(login.host)}/player_api.php`);
  url.searchParams.set("username", login.username);
  url.searchParams.set("password", login.password);
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** A live channel's ways to play, best for a browser first: HLS, then the raw transport stream (which needs a remuxer). */
export const liveUrls = (login: XtreamLogin, streamId: string | number): string[] => [
  `${baseOf(login.host)}/live/${creds(login)}/${streamId}.m3u8`,
  `${baseOf(login.host)}/live/${creds(login)}/${streamId}.ts`,
];
export const movieUrl = (login: XtreamLogin, streamId: string | number, extension?: string): string => `${baseOf(login.host)}/movie/${creds(login)}/${streamId}.${extension || "mp4"}`;
export const episodeUrl = (login: XtreamLogin, episodeId: string | number, extension?: string): string => `${baseOf(login.host)}/series/${creds(login)}/${episodeId}.${extension || "mp4"}`;

export interface Category {
  readonly id: string;
  readonly name: string;
}
export interface LiveStream {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string;
  readonly logo: string | undefined;
}
export interface Movie {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string;
  readonly poster: string | undefined;
  readonly extension: string | undefined;
}
export interface Series {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string;
  readonly cover: string | undefined;
  readonly plot: string | undefined;
}
export interface Episode {
  readonly id: string;
  readonly season: number;
  readonly number: number;
  readonly title: string;
  readonly extension: string | undefined;
}

type Dto = Record<string, unknown>;
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : typeof value === "number" ? String(value) : undefined);

export const toCategories = (rows: unknown): Category[] =>
  (Array.isArray(rows) ? (rows as Dto[]) : []).flatMap((row) => {
    const id = text(row.category_id);
    const name = text(row.category_name);
    return id !== undefined && name !== undefined ? [{ id, name }] : [];
  });

export const toLive = (rows: unknown): LiveStream[] =>
  (Array.isArray(rows) ? (rows as Dto[]) : []).flatMap((row) => {
    const id = text(row.stream_id);
    const name = text(row.name);
    return id !== undefined && name !== undefined ? [{ id, name, categoryId: text(row.category_id) ?? "", logo: text(row.stream_icon) }] : [];
  });

export const toMovies = (rows: unknown): Movie[] =>
  (Array.isArray(rows) ? (rows as Dto[]) : []).flatMap((row) => {
    const id = text(row.stream_id);
    const name = text(row.name);
    return id !== undefined && name !== undefined ? [{ id, name, categoryId: text(row.category_id) ?? "", poster: text(row.stream_icon), extension: text(row.container_extension) }] : [];
  });

export const toSeriesList = (rows: unknown): Series[] =>
  (Array.isArray(rows) ? (rows as Dto[]) : []).flatMap((row) => {
    const id = text(row.series_id);
    const name = text(row.name);
    return id !== undefined && name !== undefined ? [{ id, name, categoryId: text(row.category_id) ?? "", cover: text(row.cover), plot: text(row.plot) }] : [];
  });

/** `get_series_info` keys its episodes by season number. */
export function toEpisodes(info: unknown): Episode[] {
  const bySeason = (info as { episodes?: unknown } | null)?.episodes;
  if (bySeason === null || typeof bySeason !== "object") return [];
  const all: Episode[] = [];
  for (const rows of Object.values(bySeason as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Dto[]) {
      const id = text(row.id);
      if (id === undefined) continue;
      all.push({ id, season: Number(row.season) || 0, number: Number(row.episode_num) || 0, title: text(row.title) ?? `Episode ${row.episode_num}`, extension: text(row.container_extension) });
    }
  }
  return all.sort((a, b) => a.season - b.season || a.number - b.number);
}

/** One call to the provider's JSON API, through the proxy. */
export async function call(login: XtreamLogin, action: string, params: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(viaProxy(apiUrl(login, action, params)));
  if (!response.ok) throw new Error(await describeFailure(response));
  try {
    return await response.json();
  } catch {
    throw new Error("The provider's server did not answer properly. Check the source's address in the app.");
  }
}

/** The words for a proxy or provider failure. */
export async function describeFailure(response: Response): Promise<string> {
  if (response.status === 401) return "You were signed out. Sign in again.";
  if (response.status === 404) return "The web player is not switched on yet.";
  if (response.status === 429) {
    const limit = (await response.clone().json().catch(() => null)) as { error?: string; detail?: string } | null;
    return limit?.error === "daily limit reached" ? (limit.detail ?? "Today's streaming allowance on the web player is used up.") : "Too many requests. Wait a moment.";
  }
  const body = (await response.json().catch(() => null)) as { error?: string; detail?: string } | null;
  if (body?.error === "could not reach the provider") return `Could not reach the provider${body.detail ? ` (${body.detail})` : ""}. Some servers cannot be reached from the web player.`;
  return body?.error ?? `The provider answered ${response.status}.`;
}

export interface Programme {
  readonly title: string;
  readonly start: number;
  readonly end: number;
}

const fromBase64 = (value: unknown): string => {
  if (typeof value !== "string" || value === "") return "";
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
  } catch {
    return value;
  }
};

/** `get_short_epg`: the programmes on now and next (titles are base64; times are epoch seconds). */
export function toShortEpg(info: unknown): Programme[] {
  const rows = (info as { epg_listings?: unknown } | null)?.epg_listings;
  return (Array.isArray(rows) ? (rows as Dto[]) : [])
    .flatMap((row) => {
      const start = Number(row.start_timestamp);
      const end = Number(row.stop_timestamp);
      const title = fromBase64(row.title);
      return title !== "" && Number.isFinite(start) && Number.isFinite(end) ? [{ title, start: start * 1000, end: end * 1000 }] : [];
    })
    .sort((a, b) => a.start - b.start);
}

/** What is on now, and what follows, from a list in start order. */
export function nowAndNext(programmes: readonly Programme[], at: number): { now?: Programme; next?: Programme } {
  const now = programmes.find((programme) => programme.start <= at && at < programme.end);
  const next = programmes.find((programme) => programme.start >= (now?.end ?? at));
  return { ...(now !== undefined ? { now } : {}), ...(next !== undefined ? { next } : {}) };
}

export const shortEpg = async (login: XtreamLogin, streamId: string): Promise<Programme[]> => toShortEpg(await call(login, "get_short_epg", { stream_id: streamId, limit: "4" }));
