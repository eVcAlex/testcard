/**
 * Decides whether one M3U entry is a live channel, a film or a TV episode. M3U carries no such
 * field, so this reads the two signals a playlist does have: the stream URL (Xtream-style
 * `/movie/` and `/series/` paths, and a video-file extension, which live streams never have) and,
 * for episodes, an `S01E02` / `1x02` marker in the title. Pure and deterministic: no network, no
 * clock. Anything it cannot place stays `live`, which is what every M3U entry was before.
 */

export interface EntryInput {
  readonly rawName: string;
  readonly url: string;
}

export type ClassifiedEntry =
  | { readonly kind: "live" }
  | { readonly kind: "movie"; readonly title: string; readonly extension: string | null }
  | {
      readonly kind: "episode";
      readonly series: string;
      readonly season: number;
      readonly episode: number;
      readonly title: string;
      readonly extension: string | null;
    };

/** Container files a live stream never uses (`.ts` and `.m3u8` are live). */
const VOD_EXTENSIONS: ReadonlySet<string> = new Set(["mp4", "mkv", "avi", "mov", "m4v", "wmv", "flv", "mpg", "mpeg", "webm"]);

const LIVE_PATH = /\/live\//i;
const MOVIE_PATH = /\/(?:movie|movies|vod)\//i;
const SERIES_PATH = /\/series\//i;

/** "S01E02", "S1 E2", "s01.e02", "S01E02E03" (first episode wins). */
const SEASON_EPISODE = /^(?<title>.*?)[\s._\-:]*[[(]?\bS(?<season>\d{1,3})[\s._-]*E(?<episode>\d{1,4})(?!\d)[\])]?(?:[\s._-]*E\d{1,4})*[\s._\-:]*(?<rest>.*)$/i;
/** "1x02" */
const CROSS_EPISODE = /^(?<title>.*?)[\s._\-:]*\b(?<season>\d{1,2})x(?<episode>\d{2,3})\b[\s._\-:]*(?<rest>.*)$/i;

/** Trims separators; turns "The.Wire" style dots and underscores into spaces only when the text has no spaces at all. */
function tidy(text: string): string {
  const spaced = /\s/.test(text.trim()) ? text : text.replace(/[._]+/g, " ");
  return spaced
    .replace(/\s+/g, " ")
    .replace(/^[\s\-:|]+|[\s\-:|]+$/g, "")
    .trim();
}

const FILE_EXTENSION = /\.(?:mkv|mp4|avi|mov|m4v|wmv|flv|mpg|mpeg|webm)$/i;

/** The file extension of the URL's path (query and fragment ignored), lower-cased, or null. */
export function urlExtension(url: string): string | null {
  const path = url.split(/[?#]/, 1)[0] ?? "";
  const match = /\.([a-z0-9]{2,5})$/i.exec(path);
  return match?.[1] !== undefined ? match[1].toLowerCase() : null;
}

function parseEpisode(rawName: string): { series: string; season: number; episode: number; title: string } | null {
  const name = rawName.replace(FILE_EXTENSION, "");
  const match = SEASON_EPISODE.exec(name) ?? CROSS_EPISODE.exec(name);
  const groups = match?.groups;
  if (groups === undefined) return null;
  const series = tidy(groups["title"] ?? "");
  if (series === "") return null;
  return {
    series,
    season: Number(groups["season"]),
    episode: Number(groups["episode"]),
    title: tidy(groups["rest"] ?? ""),
  };
}

export function classifyEntry(entry: EntryInput): ClassifiedEntry {
  const { rawName, url } = entry;
  if (LIVE_PATH.test(url)) return { kind: "live" };

  const extension = urlExtension(url);
  const vodPath = MOVIE_PATH.test(url) || SERIES_PATH.test(url);
  const vodFile = extension !== null && VOD_EXTENSIONS.has(extension);
  if (!vodPath && !vodFile) return { kind: "live" };

  const episode = parseEpisode(rawName);
  if (episode !== null && (SERIES_PATH.test(url) || !MOVIE_PATH.test(url))) {
    return { kind: "episode", ...episode, extension };
  }
  const title = tidy(rawName.replace(FILE_EXTENSION, ""));
  return { kind: "movie", title: title === "" ? rawName.trim() : title, extension };
}

/** A grouping key that ignores case, punctuation and a trailing "(2019)" so "Show" and "Show (2019)" are one series. */
export function seriesKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\((?:19|20)\d{2}\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

/** A stable key for a movie title (year kept, so two films with the same name but different years stay apart). */
export function movieKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}
