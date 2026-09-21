import type { Source } from "../types.js";
import { base64Decode, type CredentialsLookup } from "./client.js";

/**
 * Catch-up TV (Xtream "tv_archive"): past programmes of a channel that the provider keeps for a few days,
 * played through its timeshift URL. Xtream-only and optional, so live playback never depends on it. Same
 * shape as `fetchShortEpg`: read on demand, credentials passed in, and the built URL goes straight to the
 * player and is never shown or logged.
 */

export interface CatchupProgramme {
  readonly title: string;
  readonly start: Date;
  readonly end: Date;
  /** The start as the provider's own clock wrote it ("2026-09-21 06:30:00"). The timeshift URL is built from this, not from the device's zone. */
  readonly serverStart: string;
  /** Whether the provider still has this one to play back. */
  readonly archived: boolean;
}

interface ListingDTO {
  readonly title?: string;
  readonly start?: string;
  readonly start_timestamp?: string;
  readonly stop_timestamp?: string;
  readonly has_archive?: number | string;
}

/** A provider clock string is "YYYY-MM-DD HH:mm:ss"; anything else cannot be turned into a timeshift address. */
const SERVER_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/;

/** The "YYYY-MM-DD:HH-mm" a timeshift URL wants, or undefined if the provider's time is not in the usual form. */
export function timeshiftStamp(serverStart: string): string | undefined {
  const match = SERVER_TIME.exec(serverStart);
  return match === null ? undefined : `${match[1]}:${match[2]}-${match[3]}`;
}

/** Whole minutes the programme runs for, at least 1: the timeshift URL asks for a length. */
export function programmeMinutes(programme: Pick<CatchupProgramme, "start" | "end">): number {
  return Math.max(1, Math.round((programme.end.getTime() - programme.start.getTime()) / 60_000));
}

/** Every listing the provider returns for the channel, oldest first. Listings it cannot address are dropped. */
export async function fetchCatchupProgrammes(source: Source, streamId: string, getCredentials: CredentialsLookup): Promise<CatchupProgramme[]> {
  if (source.kind !== "xtream") throw new Error("fetchCatchupProgrammes used with a non-xtream source");
  const credentials = await getCredentials(source.id);
  const url = new URL(`${credentials.baseUrl}/player_api.php`);
  url.searchParams.set("username", credentials.username);
  url.searchParams.set("password", credentials.password);
  url.searchParams.set("action", "get_simple_data_table");
  url.searchParams.set("stream_id", streamId);

  const response = await fetch(url.toString());
  if (!response.ok) return [];
  const body = (await response.json()) as { epg_listings?: readonly ListingDTO[] };

  const programmes: CatchupProgramme[] = [];
  for (const listing of body.epg_listings ?? []) {
    const start = Number(listing.start_timestamp);
    const end = Number(listing.stop_timestamp);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || listing.start === undefined || listing.title === undefined) continue;
    programmes.push({
      title: base64Decode(listing.title),
      start: new Date(start * 1000),
      end: new Date(end * 1000),
      serverStart: listing.start,
      archived: Number(listing.has_archive) === 1,
    });
  }
  return programmes.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The programme airing at `at` (if any) and the ones already over, newest first. Only archived ones, within `days`. */
export function splitCatchup(
  programmes: readonly CatchupProgramme[],
  at: Date,
  days: number,
): { readonly current: CatchupProgramme | undefined; readonly past: CatchupProgramme[] } {
  const oldest = at.getTime() - days * 86_400_000;
  const usable = programmes.filter((programme) => programme.archived && timeshiftStamp(programme.serverStart) !== undefined);
  return {
    current: usable.find((programme) => programme.start <= at && at < programme.end),
    past: usable.filter((programme) => programme.end <= at && programme.start.getTime() >= oldest).reverse(),
  };
}

/** The address that plays `programme` from its start. Only for the player. */
export async function buildTimeshiftUrl(source: Source, streamId: string, programme: CatchupProgramme, getCredentials: CredentialsLookup): Promise<string> {
  if (source.kind !== "xtream") throw new Error("buildTimeshiftUrl used with a non-xtream source");
  const stamp = timeshiftStamp(programme.serverStart);
  if (stamp === undefined) throw new Error("This programme has no catch-up time.");
  const credentials = await getCredentials(source.id);
  return `${credentials.baseUrl}/timeshift/${credentials.username}/${credentials.password}/${programmeMinutes(programme)}/${stamp}/${streamId}.ts`;
}
