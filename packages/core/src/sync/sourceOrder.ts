import type Database from "better-sqlite3";

const ORDER = `ORDER BY sort_order IS NULL, sort_order, created_at`;

/** Source ids in the order the user keeps them. Ones never placed come after the placed ones, oldest first. */
export function orderedSourceIds(db: Database.Database): string[] {
  return (db.prepare(`SELECT id FROM sources ${ORDER}`).all() as { id: string }[]).map((row) => row.id);
}

/** Records a position that arrived from another device. The sync clock is left as it came. */
export function applySourcePosition(db: Database.Database, sourceId: string, position: number): void {
  db.prepare(`UPDATE sources SET sort_order = ? WHERE id = ?`).run(position, sourceId);
}

/**
 * Numbers the list in its current order and stamps each source as edited, so the order (and everything else
 * about the source) is pushed to the account. For a device that is the source of truth for the list; run once.
 */
export function stampSourceOrder(db: Database.Database): void {
  writeOrder(db, orderedSourceIds(db), true);
}

/** Moves a source one place up (-1) or down (1). Returns false at either end or for an unknown source. */
export function moveSource(db: Database.Database, sourceId: string, delta: -1 | 1): boolean {
  const ids = orderedSourceIds(db);
  const from = ids.indexOf(sourceId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return false;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  writeOrder(db, ids, false);
  return true;
}

function writeOrder(db: Database.Database, ids: readonly string[], all: boolean): void {
  const now = Date.now();
  const read = db.prepare(`SELECT sort_order AS position, sync_updated_at AS updatedAt FROM sources WHERE id = ?`);
  const write = db.prepare(`UPDATE sources SET sort_order = ?, sync_updated_at = ? WHERE id = ?`);
  db.transaction(() => {
    ids.forEach((id, index) => {
      const row = read.get(id) as { position: number | null; updatedAt: number | null };
      if (!all && row.position === index) return;
      // Later than what this source last synced under, so the newer order wins on the other devices.
      write.run(index, Math.max(now, (row.updatedAt ?? 0) + 1), id);
    });
  })();
}
