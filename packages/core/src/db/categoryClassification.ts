import type Database from "better-sqlite3";
import { CLASSIFIER_VERSION, classifyCategory, encodeTags } from "../normalise/classifyCategory.js";
import { applyInSlices } from "./applyInSlices.js";

/**
 * The columns every category table stores for `classifyCategory`'s advisory result. Shared by the
 * three importers so a category is classified identically whichever catalogue it came from.
 * The provider's own `raw_name` is never replaced — these sit beside it.
 */
export function categoryClassificationParams(rawName: string): {
  genre: string | null;
  language: string | null;
  service: string | null;
  tags: string;
} {
  const result = classifyCategory(rawName);
  return { genre: result.genre, language: result.language, service: result.service, tags: encodeTags(result.tags) };
}

const CATEGORY_TABLES = ["categories", "movie_categories", "series_categories"] as const;

/**
 * Recomputes every stored classification when the rules have changed (or on the first open after
 * the columns were added). A multi-source install can have thousands of category rows across the
 * three tables, so this runs in slices with a yield between them — like every other bulk import
 * pass — rather than one long transaction that would hold the JS thread (and the TV's remote)
 * still for its whole duration. Deliberately not part of `migrateDatabase` (which must stay
 * synchronous): call this once, in the background, after the database is open and already usable.
 * Idempotent: a no-op once `schema_meta.classifier_version` matches.
 */
export async function reclassifyCategories(db: Database.Database): Promise<void> {
  const stored = db.prepare(`SELECT value FROM schema_meta WHERE key = 'classifier_version'`).get() as { value: string } | undefined;
  if (stored !== undefined && Number(stored.value) === CLASSIFIER_VERSION) return;

  for (const table of CATEGORY_TABLES) {
    const rows = db.prepare(`SELECT id, raw_name AS rawName FROM ${table}`).all() as { id: string; rawName: string }[];
    const update = db.prepare(`UPDATE ${table} SET genre = @genre, language = @language, service = @service, tags = @tags WHERE id = @id`);
    await applyInSlices(
      db,
      rows,
      () => 1,
      (row) => update.run({ id: row.id, ...categoryClassificationParams(row.rawName) }),
    );
  }
  db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('classifier_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    String(CLASSIFIER_VERSION),
  );
}
