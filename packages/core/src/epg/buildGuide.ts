import type { GuideFile } from "@testcard/sync-schema";
import { parseXmltv } from "./parseXmltv.js";

/** Programmes that ended longer ago than this are left out: the guide grid opens on now. */
const KEEP_PAST_MS = 3 * 60 * 60 * 1000;

/** Every XMLTV channel id maps to itself: the file is keyed by the guide's own ids, the device translates them. */
const AS_IS = { get: (id: string) => id } as unknown as ReadonlyMap<string, string>;

/**
 * Reads a whole XMLTV document (gzipped or plain) into the small file devices fetch (see `GuideFile`): the programmes
 * from a little before `now` to `horizonMs` after it, for every channel in the guide. Run by the daily job, on a machine
 * that can afford the full parse.
 */
export async function buildGuide(body: ReadableStream<Uint8Array>, options: { readonly now: number; readonly horizonMs: number }): Promise<GuideFile> {
  const from = options.now - KEEP_PAST_MS;
  const to = options.now + options.horizonMs;
  const c: Record<string, [number, number, string][]> = {};
  for await (const programme of parseXmltv(body, AS_IS)) {
    const start = programme.start.getTime();
    const end = programme.end.getTime();
    if (end < from || start > to || end <= start) continue;
    (c[programme.channelId] ??= []).push([start, end, programme.title]);
  }
  for (const programmes of Object.values(c)) programmes.sort((a, b) => a[0] - b[0]);
  return { at: options.now, c };
}
