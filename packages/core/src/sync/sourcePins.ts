import type Database from "better-sqlite3";
import type { SourcePin } from "@testcard/sync-schema";

export type PinKind = SourcePin["kind"];

const CATEGORY_TABLE = { live: "categories", movies: "movie_categories", series: "series_categories" } as const satisfies Record<PinKind, string>;

/** A category pinned to the Home page, with this device's id for it (null while that category is not imported here). */
export interface HomePin {
  readonly sourceId: string;
  readonly kind: PinKind;
  readonly key: string;
  readonly label: string;
  readonly categoryId: string | null;
}

/** Every pin, in the order they were pinned. */
export function listHomePins(db: Database.Database): HomePin[] {
  const rows = db.prepare(`SELECT source_id AS sourceId, kind, category_key AS key, label FROM home_pins ORDER BY pinned_at, rowid`).all() as Omit<HomePin, "categoryId">[];
  return rows.map((row) => {
    const found = db.prepare(`SELECT id FROM ${CATEGORY_TABLE[row.kind]} WHERE source_id = ? AND provider_id = ?`).get(row.sourceId, row.key) as { id: string } | undefined;
    return { ...row, categoryId: found?.id ?? null };
  });
}

/** The local ids of the categories of one kind that are pinned, for a screen that shows a Pin button. */
export function pinnedCategoryIds(db: Database.Database, kind: PinKind): Set<string> {
  return new Set(listHomePins(db).filter((pin) => pin.kind === kind && pin.categoryId !== null).map((pin) => pin.categoryId as string));
}

/** Marks the source as edited so the change is pushed to the account, later than anything it last synced under. */
function stamp(db: Database.Database, sourceId: string): void {
  db.prepare(`UPDATE sources SET sync_updated_at = MAX(?, COALESCE(sync_updated_at, 0) + 1) WHERE id = ?`).run(Date.now(), sourceId);
}

/** Pins a category to Home. Synced. Returns false for a category this device does not have. */
export function pinCategory(db: Database.Database, kind: PinKind, categoryId: string, label: string): boolean {
  const category = db.prepare(`SELECT source_id AS sourceId, provider_id AS key FROM ${CATEGORY_TABLE[kind]} WHERE id = ?`).get(categoryId) as { sourceId: string; key: string } | undefined;
  if (category === undefined) return false;
  db.transaction(() => {
    db.prepare(`INSERT INTO home_pins (source_id, kind, category_key, label, pinned_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id, kind, category_key) DO UPDATE SET label = excluded.label`).run(category.sourceId, kind, category.key, label, Date.now());
    stamp(db, category.sourceId);
  })();
  return true;
}

/** Takes a category off Home. Synced. */
export function unpinCategory(db: Database.Database, kind: PinKind, categoryId: string): void {
  const category = db.prepare(`SELECT source_id AS sourceId, provider_id AS key FROM ${CATEGORY_TABLE[kind]} WHERE id = ?`).get(categoryId) as { sourceId: string; key: string } | undefined;
  if (category === undefined) return;
  db.transaction(() => {
    db.prepare(`DELETE FROM home_pins WHERE source_id = ? AND kind = ? AND category_key = ?`).run(category.sourceId, kind, category.key);
    stamp(db, category.sourceId);
  })();
}

/** A source's pins as they go into its synced record. */
export function pinsForSource(db: Database.Database, sourceId: string): SourcePin[] {
  return db.prepare(`SELECT kind, category_key AS key, label FROM home_pins WHERE source_id = ? ORDER BY pinned_at, rowid`).all(sourceId) as SourcePin[];
}

/** Takes on the pins that came with a source from another device: the set replaces this device's. The sync clock is left as it came. */
export function applySourcePins(db: Database.Database, sourceId: string, pins: readonly SourcePin[]): void {
  const existing = db.prepare(`SELECT kind, category_key AS key FROM home_pins WHERE source_id = ?`).all(sourceId) as { kind: PinKind; key: string }[];
  const wanted = new Set(pins.map((pin) => `${pin.kind}|${pin.key}`));
  db.transaction(() => {
    for (const row of existing) if (!wanted.has(`${row.kind}|${row.key}`)) db.prepare(`DELETE FROM home_pins WHERE source_id = ? AND kind = ? AND category_key = ?`).run(sourceId, row.kind, row.key);
    const now = Date.now();
    pins.forEach((pin, index) => {
      // Keeps their order: pinned_at follows the position in the list.
      db.prepare(`INSERT INTO home_pins (source_id, kind, category_key, label, pinned_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id, kind, category_key) DO UPDATE SET label = excluded.label, pinned_at = excluded.pinned_at`).run(sourceId, pin.kind, pin.key, pin.label, now + index);
    });
  })();
}
