import type Database from "better-sqlite3";
import type { SourceHidden } from "@testcard/sync-schema";

/**
 * Categories and channels the viewer hid: left out of every list, row, search and the channels the player steps
 * through. The set is the account's (not one profile's) and rides in each source's synced record, like its pins.
 */

export type HiddenCategoryKind = "live" | "movies" | "series";

const CATEGORY_TABLE = { live: "categories", movies: "movie_categories", series: "series_categories" } as const satisfies Record<HiddenCategoryKind, string>;

const quoted = (ids: readonly string[]) => ids.map((id) => `'${id.replaceAll("'", "''")}'`).join(", ");
const notIn = (column: string, ids: readonly string[]) => (ids.length === 0 ? "1" : `${column} NOT IN (${quoted(ids)})`);

/** This device's ids for the hidden categories of one kind: nearly always none, so the filters below cost nothing. */
function hiddenCategoryIds(db: Database.Database, kind: HiddenCategoryKind): string[] {
  return (
    db
      .prepare(`SELECT cat.id FROM hidden_categories hc JOIN ${CATEGORY_TABLE[kind]} cat ON cat.source_id = hc.source_id AND cat.provider_id = hc.category_key WHERE hc.kind = ?`)
      .all(kind) as { id: string }[]
  ).map((row) => row.id);
}

/**
 * SQL: true when the category row `alias` (of `kind`) is not hidden. Built from the (short) list of hidden ids, not a
 * lookup per row: these filters sit in queries that walk the whole catalogue (the Home shelves).
 */
export const categoryShown = (db: Database.Database, alias: string, kind: HiddenCategoryKind) => notIn(`${alias}.id`, hiddenCategoryIds(db, kind));

/** SQL: true when the channel row `alias` is not hidden, itself or through its category. */
export function channelShown(db: Database.Database, alias: string): string {
  const channels = (db.prepare(`SELECT source_id || ':' || channel_key AS id FROM hidden_channels`).all() as { id: string }[]).map((row) => row.id);
  const categories = hiddenCategoryIds(db, "live");
  return `${notIn(`${alias}.id`, channels)} AND ${notIn(`${alias}.category_id`, categories)}`;
}

/** SQL: true when the film or series row `alias` is not in a hidden category. */
export const titleShown = (db: Database.Database, alias: string, kind: "movies" | "series") => notIn(`${alias}.category_id`, hiddenCategoryIds(db, kind));

/** Marks the source as edited so the change is pushed, later than anything it last synced under. */
function stamp(db: Database.Database, sourceId: string): void {
  db.prepare(`UPDATE sources SET sync_updated_at = MAX(?, COALESCE(sync_updated_at, 0) + 1) WHERE id = ?`).run(Date.now(), sourceId);
}

/** Hides a category. Synced. False for one this device does not have. */
export function hideCategory(db: Database.Database, kind: HiddenCategoryKind, categoryId: string, label: string): boolean {
  const category = db.prepare(`SELECT source_id AS sourceId, provider_id AS key FROM ${CATEGORY_TABLE[kind]} WHERE id = ?`).get(categoryId) as { sourceId: string; key: string } | undefined;
  if (category === undefined) return false;
  db.transaction(() => {
    db.prepare(`INSERT INTO hidden_categories (source_id, kind, category_key, label, hidden_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET label = excluded.label`).run(category.sourceId, kind, category.key, label, Date.now());
    stamp(db, category.sourceId);
  })();
  return true;
}

/** Hides a channel. Synced. False for one this device does not have. */
export function hideChannel(db: Database.Database, channelId: string, label: string): boolean {
  const channel = db.prepare(`SELECT source_id AS sourceId FROM channels WHERE id = ?`).get(channelId) as { sourceId: string } | undefined;
  if (channel === undefined || !channelId.startsWith(`${channel.sourceId}:`)) return false;
  db.transaction(() => {
    db.prepare(`INSERT INTO hidden_channels (source_id, channel_key, label, hidden_at) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET label = excluded.label`).run(channel.sourceId, channelId.slice(channel.sourceId.length + 1), label, Date.now());
    stamp(db, channel.sourceId);
  })();
  return true;
}

/** One hidden thing, for the list the viewer brings them back from. */
export interface HiddenEntry {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly kind: SourceHidden["kind"];
  readonly key: string;
  readonly label: string;
}

export function listHidden(db: Database.Database): HiddenEntry[] {
  return db
    .prepare(
      `SELECT h.source_id AS sourceId, s.name AS sourceName, h.kind, h.category_key AS key, h.label, h.hidden_at AS at FROM hidden_categories h JOIN sources s ON s.id = h.source_id
       UNION ALL
       SELECT h.source_id, s.name, 'channel', h.channel_key, h.label, h.hidden_at FROM hidden_channels h JOIN sources s ON s.id = h.source_id
       ORDER BY at DESC`,
    )
    .all()
    .map((row) => {
      const { at: _at, ...entry } = row as HiddenEntry & { at: number };
      return entry;
    });
}

/** Brings a hidden category or channel back. Synced. */
export function unhide(db: Database.Database, entry: Pick<HiddenEntry, "sourceId" | "kind" | "key">): void {
  db.transaction(() => {
    if (entry.kind === "channel") db.prepare(`DELETE FROM hidden_channels WHERE source_id = ? AND channel_key = ?`).run(entry.sourceId, entry.key);
    else db.prepare(`DELETE FROM hidden_categories WHERE source_id = ? AND kind = ? AND category_key = ?`).run(entry.sourceId, entry.kind, entry.key);
    stamp(db, entry.sourceId);
  })();
}

/** A source's hidden set as it goes into its synced record. */
export function hiddenForSource(db: Database.Database, sourceId: string): SourceHidden[] {
  return [
    ...(db.prepare(`SELECT kind, category_key AS key, label FROM hidden_categories WHERE source_id = ? ORDER BY hidden_at, rowid`).all(sourceId) as SourceHidden[]),
    ...(db.prepare(`SELECT 'channel' AS kind, channel_key AS key, label FROM hidden_channels WHERE source_id = ? ORDER BY hidden_at, rowid`).all(sourceId) as SourceHidden[]),
  ];
}

/** Takes on the hidden set that came with a source from another device: it replaces this device's. */
export function applySourceHidden(db: Database.Database, sourceId: string, hidden: readonly SourceHidden[]): void {
  const now = Date.now();
  db.transaction(() => {
    db.prepare(`DELETE FROM hidden_categories WHERE source_id = ?`).run(sourceId);
    db.prepare(`DELETE FROM hidden_channels WHERE source_id = ?`).run(sourceId);
    hidden.forEach((entry, index) => {
      if (entry.kind === "channel") db.prepare(`INSERT OR REPLACE INTO hidden_channels (source_id, channel_key, label, hidden_at) VALUES (?, ?, ?, ?)`).run(sourceId, entry.key, entry.label, now + index);
      else db.prepare(`INSERT OR REPLACE INTO hidden_categories (source_id, kind, category_key, label, hidden_at) VALUES (?, ?, ?, ?, ?)`).run(sourceId, entry.kind, entry.key, entry.label, now + index);
    });
  })();
}
