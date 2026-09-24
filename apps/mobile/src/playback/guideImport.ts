import type Database from "better-sqlite3";
import { importEpg } from "@testcard/core/src/epg/importEpg.js";
import type { Source, SourceAdapter } from "@testcard/core/src/source/types.js";
import { forgetGuides } from "./airing";

/**
 * The TV guide (XMLTV) for a source, loaded into the `programmes` table as the desktop app does, so Live TV, the
 * player and the guide grid have listings for playlists and for providers whose per-channel guide is empty. The
 * address is the one set for the source (on any device: it syncs), else the source's own: an Xtream account's
 * `xmltv.php`, a playlist's `url-tvg`. Read in the background, one source at a time; nothing waits on it.
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
}

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
       WHERE include_live = 1 AND EXISTS (SELECT 1 FROM channels WHERE source_id = sources.id)`,
    )
    .all() as GuideSource[];
}

const setAddress = (source: GuideSource) => source.epgUrl?.trim() ?? "";

/** Whether a source's guide is missing, old, or was read from another address than the one set now. */
function isStale(db: Database.Database, source: GuideSource): boolean {
  const record = readRecord(db, source.id);
  return record === undefined || Date.now() - record.at > STALE_MS || record.url !== setAddress(source);
}

async function importOne(db: Database.Database, source: GuideSource, adapter: SourceAdapter): Promise<void> {
  const set = setAddress(source);
  const asSource = (source.kind === "xtream" ? { id: source.id, kind: "xtream", name: source.name, baseUrl: source.baseUrl ?? "" } : { id: source.id, kind: "m3u", name: source.name, playlistUrl: source.playlistUrl ?? "" }) as Source;
  const url = set !== "" ? set : await adapter.probeEpgUrl?.(asSource);
  // Tried, whatever happens: a source with no guide, or a broken one, is not asked again until it is stale.
  db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(metaKey(source.id), JSON.stringify({ at: Date.now(), url: set } satisfies GuideRecord));
  if (url === undefined || url === "") return;
  const response = await fetch(url);
  if (!response.ok || response.body === null) throw new Error(`The guide address responded with HTTP ${response.status}.`);
  const result = await importEpg(db, source.id, response.body as ReadableStream<Uint8Array>, { horizonMs: HORIZON_MS });
  console.log(`Guide for ${source.name}: ${result.programmes} programmes on ${result.channels} channels in ${Math.round(result.durationMs / 1000)}s`);
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
): void {
  for (const source of guideSources(db)) {
    if (queued.has(source.id) || !(force.includes(source.id) || isStale(db, source))) continue;
    queued.add(source.id);
    queue = queue.then(async () => {
      try {
        // Read again when its turn comes: the source may have changed or gone while it waited.
        const current = guideSources(db).find((entry) => entry.id === source.id);
        if (current === undefined) return;
        await importOne(db, current, current.kind === "xtream" ? adapters.xtreamAdapter : adapters.m3uAdapter);
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
