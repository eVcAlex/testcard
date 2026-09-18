import type Database from "better-sqlite3";
import { CLASSIFIER_VERSION, classifyCategory, encodeTags } from "../normalise/classifyCategory.js";

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
 * the columns were added). Categories number in the hundreds and the classifier is pure and
 * synchronous, so this costs milliseconds and needs no refresh, network or provider round trip —
 * which is also what lets a rule improvement reach existing installs. Idempotent: a no-op once
 * `schema_meta.classifier_version` matches.
 */
export function reclassifyCategories(db: Database.Database): void {
  const stored = db.prepare(`SELECT value FROM schema_meta WHERE key = 'classifier_version'`).get() as { value: string } | undefined;
  if (stored !== undefined && Number(stored.value) === CLASSIFIER_VERSION) return;

  db.transaction(() => {
    for (const table of CATEGORY_TABLES) {
      const rows = db.prepare(`SELECT id, raw_name AS rawName FROM ${table}`).all() as { id: string; rawName: string }[];
      const update = db.prepare(`UPDATE ${table} SET genre = @genre, language = @language, service = @service, tags = @tags WHERE id = @id`);
      for (const row of rows) update.run({ id: row.id, ...categoryClassificationParams(row.rawName) });
    }
    db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('classifier_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
      String(CLASSIFIER_VERSION),
    );
  })();
}
