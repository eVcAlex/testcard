import type Database from "better-sqlite3";
import { parseXmltv } from "./parseXmltv.js";

export interface EpgImportResult {
  /** Distinct channels that received at least one programme. */
  readonly channels: number;
  readonly programmes: number;
  readonly durationMs: number;
}

/** Programmes older than this before "now" are dropped after every import. */
const KEEP_PAST_MS = 6 * 60 * 60 * 1000;
/** Rows per synchronous transaction — the event loop is yielded between flushes. */
const FLUSH_EVERY = 2000;

/**
 * Streams an XMLTV document into the `programmes` table for one source.
 *
 * The caller (the desktop main process, or the TV app) fetches the URL and hands the response body in — this
 * function never does I/O of its own, so `packages/core` keeps its no-Node-HTTP stance and the
 * credential-bearing Xtream `xmltv.php` URL is built and used only by the caller, never stored.
 *
 * Delete-then-insert per source makes a re-import idempotent without a primary key on
 * `programmes`. Unlike `importSource` this cannot drain the parser into memory first — an XMLTV
 * file expands to far more programme rows than there are channels — so it flushes in batches and
 * yields the event loop between them to keep the app responsive during a large import.
 */
export async function importEpg(
  db: Database.Database,
  sourceId: string,
  body: ReadableStream<Uint8Array>,
  options: {
    readonly gzipped?: boolean;
    readonly onProgress?: (programmesSoFar: number) => void;
    /** Leaves out programmes starting further ahead than this: a small device need not hold a fortnight of listings. */
    readonly horizonMs?: number;
  } = {},
): Promise<EpgImportResult> {
  const startedAt = Date.now();

  const channelIdMap = new Map<string, string>();
  const channelRows = db
    .prepare(`SELECT tvg_id AS tvgId, id FROM channels WHERE source_id = ? AND tvg_id IS NOT NULL AND tvg_id <> ''`)
    .all(sourceId) as { tvgId: string; id: string }[];
  for (const row of channelRows) channelIdMap.set(row.tvgId, row.id);

  const insert = db.prepare(
    `INSERT INTO programmes (channel_id, title, description, start_at, end_at) VALUES (?, ?, ?, ?, ?)`,
  );
  type Pending = readonly [string, string, string | null, number, number];
  const flush = db.transaction((rows: readonly Pending[]) => {
    for (const row of rows) insert.run(...row);
  });

  db.prepare(`DELETE FROM programmes WHERE channel_id IN (SELECT id FROM channels WHERE source_id = ?)`).run(sourceId);

  const touchedChannels = new Set<string>();
  let programmes = 0;
  let buffer: Pending[] = [];

  const { gzipped } = options;
  const oldest = Date.now() - KEEP_PAST_MS;
  const furthest = options.horizonMs !== undefined ? Date.now() + options.horizonMs : Number.POSITIVE_INFINITY;
  for await (const programme of parseXmltv(body, channelIdMap, gzipped !== undefined ? { gzipped } : {})) {
    if (programme.end.getTime() < oldest || programme.start.getTime() > furthest) continue;
    buffer.push([
      programme.channelId,
      programme.title,
      programme.description ?? null,
      programme.start.getTime(),
      programme.end.getTime(),
    ]);
    touchedChannels.add(programme.channelId);
    programmes += 1;

    if (buffer.length >= FLUSH_EVERY) {
      flush(buffer);
      buffer = [];
      options.onProgress?.(programmes);
      await yieldToEventLoop();
    }
  }
  if (buffer.length > 0) flush(buffer);
  options.onProgress?.(programmes);

  db.prepare(`DELETE FROM programmes WHERE end_at < ?`).run(Date.now() - KEEP_PAST_MS);

  return { channels: touchedChannels.size, programmes, durationMs: Date.now() - startedAt };
}

/** `setImmediate` where there is one (Node, React Native); a zero timer anywhere else. */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => (typeof setImmediate === "function" ? setImmediate(resolve) : setTimeout(resolve, 0)));
}
