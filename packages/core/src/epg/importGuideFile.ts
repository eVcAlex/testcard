import type Database from "better-sqlite3";
import type { GuideFile } from "@testcard/sync-schema";
import { yieldToEventLoop } from "../db/applyInSlices.js";
import { deleteInSlices, type EpgImportResult } from "./importEpg.js";

/** Rows per synchronous transaction, as in `importEpg`. */
const FLUSH_EVERY = 500;

/**
 * Loads a guide file built by the daily job (see `buildGuide`) into the `programmes` table for one source, in place of
 * `importEpg` reading the whole XMLTV: the guide's channel ids are matched to the source's `tvg_id`s, and only listings
 * for channels the source has are kept. Same delete-then-insert per source, same slices with the event loop let run
 * between them.
 */
export async function importGuideFile(db: Database.Database, sourceId: string, file: GuideFile): Promise<EpgImportResult> {
  const startedAt = Date.now();
  const channelIds = new Map<string, string>();
  const rows = db.prepare(`SELECT tvg_id AS tvgId, id FROM channels WHERE source_id = ? AND tvg_id IS NOT NULL AND tvg_id <> ''`).all(sourceId) as { tvgId: string; id: string }[];
  for (const row of rows) channelIds.set(row.tvgId, row.id);

  const insert = db.prepare(`INSERT INTO programmes (channel_id, title, description, start_at, end_at) VALUES (?, ?, NULL, ?, ?)`);
  type Pending = readonly [string, string, number, number];
  const flush = db.transaction((batch: readonly Pending[]) => {
    for (const row of batch) insert.run(...row);
  });

  await deleteInSlices(db, `SELECT p.rowid FROM programmes p JOIN channels c ON c.id = p.channel_id WHERE c.source_id = ?`, [sourceId]);

  const touched = new Set<string>();
  let programmes = 0;
  let batch: Pending[] = [];
  for (const [guideId, listings] of Object.entries(file.c)) {
    const channelId = channelIds.get(guideId);
    if (channelId === undefined) continue;
    for (const [start, end, title] of listings) {
      batch.push([channelId, title, start, end]);
      programmes += 1;
    }
    touched.add(channelId);
    if (batch.length >= FLUSH_EVERY) {
      flush(batch);
      batch = [];
      await yieldToEventLoop();
    }
  }
  if (batch.length > 0) flush(batch);
  return { channels: touched.size, programmes, durationMs: Date.now() - startedAt };
}
