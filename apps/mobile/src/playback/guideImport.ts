import type Database from "better-sqlite3";
import { deleteInSlices, importEpg } from "@testcard/core/src/epg/importEpg.js";
import { fetchResponding } from "@testcard/core/src/source/fetchResponding.js";
import type { SourceAdapter } from "@testcard/core/src/source/types.js";
import { forgetGuides } from "./airing";

/**
 * The TV guide (XMLTV) for a source, loaded into the `programmes` table as the desktop app does, so Live TV, the
 * player and the guide grid have listings for playlists and for providers whose per-channel guide is empty. The
 * address is the one set for the source (on any device: it syncs); a source with none is left to its per-channel guide
 * (`airing.ts`). A provider's own full guide (Xtream's `xmltv.php`, a playlist's `url-tvg`) can run to hundreds of
 * megabytes, far too much to take on by default on the thread the UI runs on. Read in the background, one source at a time, never
 * while a source is importing; nothing waits on it.
 */

/** A guide older than this is read again, on launch or on coming back to the app. */
const STALE_MS = 12 * 60 * 60 * 1000;
/** Listings kept ahead of now: the guide grid shows a day; a small device need not hold a week. */
const HORIZON_MS = 36 * 60 * 60 * 1000;

interface GuideSource {
  readonly id: string;
  readonly kind: "xtream" | "m3u";
  readonly name: string;
  readonly baseUrl: string | null;
  readonly playlistUrl: string | null;
  readonly epgUrl: string | null;
}

interface GuideRecord {
  readonly at: number;
  /** The address set for the source when it was read ("" for the source's own), so a new one is read at once. */
  readonly url: string;
  /** How the last read went, for the Sources screen: under way, what it matched, or why it failed. */
  readonly state?: "loading" | "done" | "failed";
  readonly programmes?: number;
  readonly matched?: number;
  readonly channels?: number;
  readonly error?: string;
}

/** A guide that failed or matched nothing is tried again this soon, not a whole STALE_MS later. */
const RETRY_MS = 60 * 60 * 1000;
/** A read still "loading" after this was cut short (the app was closed mid-way). */
const ABANDONED_MS = 30 * 60 * 1000;

const metaKey = (sourceId: string) => `epg:${sourceId}`;

function readRecord(db: Database.Database, sourceId: string): GuideRecord | undefined {
  try {
    const row = db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get(metaKey(sourceId)) as { value: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.value) as GuideRecord);
  } catch {
    return undefined;
  }
}

function guideSources(db: Database.Database): GuideSource[] {
  return db
    .prepare(
      `SELECT id, kind, name, base_url AS baseUrl, playlist_url AS playlistUrl, epg_url AS epgUrl FROM sources
       WHERE include_live = 1 AND TRIM(COALESCE(epg_url, '')) <> ''
         AND EXISTS (SELECT 1 FROM channels WHERE source_id = sources.id)`,
    )
    .all() as GuideSource[];
}

const setAddress = (source: GuideSource) => source.epgUrl?.trim() ?? "";

/** Whether a source's guide is missing, old, or was read from another address than the one set now. */
function isStale(db: Database.Database, source: GuideSource): boolean {
  const record = readRecord(db, source.id);
  // Read by a version from before channels were matched by name (no `state`): read again now, as it may match more.
  if (record === undefined || record.url !== setAddress(source) || record.state === undefined) return true;
  const age = Date.now() - record.at;
  const unfinished = record.state === "failed" || (record.state === "done" && record.matched === 0) || (record.state === "loading" && age > ABANDONED_MS);
  return age > (unfinished ? RETRY_MS : STALE_MS);
}

function writeRecord(db: Database.Database, sourceId: string, record: GuideRecord): void {
  db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(metaKey(sourceId), JSON.stringify(record));
}

async function importOne(db: Database.Database, source: GuideSource): Promise<void> {
  const url = setAddress(source);
  const at = Date.now();
  // Tried, whatever happens: a source with no guide, or a broken one, is not asked again until it is due (isStale).
  writeRecord(db, source.id, { at, url, state: "loading" });
  if (url === "") return;
  try {
    const response = await fetchResponding(url);
    if (!response.ok || response.body === null) throw new Error(`The guide address responded with HTTP ${response.status}.`);
    const result = await importEpg(db, source.id, response.body as ReadableStream<Uint8Array>, { horizonMs: HORIZON_MS });
    const channels = (db.prepare(`SELECT COUNT(*) AS n FROM channels WHERE source_id = ?`).get(source.id) as { n: number }).n;
    writeRecord(db, source.id, { at, url, state: "done", programmes: result.programmes, matched: result.channels, channels });
    console.log(`Guide for ${source.name}: ${result.programmes} programmes on ${result.channels} channels in ${Math.round(result.durationMs / 1000)}s`);
  } catch (error) {
    writeRecord(db, source.id, { at, url, state: "failed", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * How the guide set for a source last went, in a line for the Sources screen, or undefined for a source with no guide
 * address (its channels ask the provider one at a time).
 */
export function guideStatus(db: Database.Database, sourceId: string, epgUrl: string | null): { readonly text: string; readonly problem: boolean } | undefined {
  const url = epgUrl?.trim() ?? "";
  if (url === "") return undefined;
  const record = readRecord(db, sourceId);
  if (record === undefined || record.url !== url) return { text: "TV guide: waiting to load", problem: false };
  if (record.state === "loading") {
    return Date.now() - record.at > ABANDONED_MS ? { text: "TV guide: did not finish loading. It tries again shortly.", problem: true } : { text: "TV guide: loading...", problem: false };
  }
  if (record.state === "failed") return { text: `TV guide failed: ${record.error ?? "unknown error"}`, problem: true };
  if (record.state === "done") {
    if ((record.matched ?? 0) === 0) return { text: "TV guide loaded, but none of its channels match this source's", problem: true };
    return { text: `TV guide: ${record.matched} of ${record.channels ?? "?"} channels, ${record.programmes ?? 0} programmes`, problem: false };
  }
  // Read by a version from before this was recorded.
  return { text: "TV guide: loaded", problem: false };
}

let queue: Promise<void> = Promise.resolve();
const queued = new Set<string>();

/**
 * Reads the guide of each source that needs it (or, with `force`, of the ones named), in turn. `onImported` is
 * told after each, so screens can show the new listings.
 */
export function refreshGuides(
  db: Database.Database,
  adapters: { readonly xtreamAdapter: SourceAdapter; readonly m3uAdapter: SourceAdapter },
  onImported: () => void,
  force: readonly string[] = [],
  /** True while a source is importing: the guide waits, rather than slowing it down. */
  busy: () => boolean = () => false,
): void {
  for (const source of guideSources(db)) {
    if (queued.has(source.id) || !(force.includes(source.id) || isStale(db, source))) continue;
    queued.add(source.id);
    queue = queue.then(async () => {
      try {
        while (busy()) await new Promise((resolve) => setTimeout(resolve, 5000));
        // Read again when its turn comes: the source may have changed or gone while it waited.
        const current = guideSources(db).find((entry) => entry.id === source.id);
        if (current === undefined) return;
        await importOne(db, current);
        forgetGuides();
        onImported();
      } catch (error) {
        console.warn(`Guide for ${source.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        queued.delete(source.id);
      }
    });
  }
}

/**
 * Clears guides this device keeps no longer: sources with no guide address (0.1.60, 0.1.61 and 0.1.72 read every
 * source's), in slices. Once for each of those; the guides it reads from now on replace themselves.
 */
export async function dropUnusedGuides(db: Database.Database): Promise<void> {
  if (db.prepare(`SELECT 1 FROM schema_meta WHERE key = 'guides_trimmed_2'`).get() !== undefined) return;
  const removed = await deleteInSlices(
    db,
    `SELECT p.rowid FROM programmes p JOIN channels c ON c.id = p.channel_id JOIN sources s ON s.id = c.source_id WHERE TRIM(COALESCE(s.epg_url, '')) = ''`,
  );
  db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('guides_trimmed_2', '1')`).run();
  if (removed > 0) forgetGuides();
}
