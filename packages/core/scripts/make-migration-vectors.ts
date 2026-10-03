/**
 * Migration vectors for the native app: databases as older releases left them (the `SCHEMA_SQL` of three past schema versions,
 * under test-vectors/db/old/) with a few rows in, brought up to date by the TypeScript migrations. The Kotlin port must reach the
 * same tables, columns, indexes and rows. Run under vitest, like make-db-vectors.ts.
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { migrateDatabase } from "../src/db/migrateDatabase.js";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

/** Rows every old database gets: a source that wants everything, one that wants only live (so its films and series are stray), favourites, recents. */
export const SEED = `
INSERT INTO sources (id, kind, name, base_url, created_at, include_live, include_movies, include_series) VALUES ('s1', 'xtream', 'One', 'http://a', 1, 1, 1, 1);
INSERT INTO sources (id, kind, name, base_url, created_at, include_live, include_movies, include_series) VALUES ('s2', 'xtream', 'Two', 'http://b', 2, 1, 0, 0);
INSERT INTO movie_categories (id, source_id, provider_id, raw_name) VALUES ('mc1', 's1', '1', 'Films'), ('mc2', 's2', '1', 'Films');
INSERT INTO movies (id, source_id, category_id, provider_stream_id, name, first_seen_at, last_seen_at) VALUES ('m1', 's1', 'mc1', '1', 'Kept', 1, 1), ('m2', 's2', 'mc2', '2', 'Stray', 1, 1);
INSERT INTO series_categories (id, source_id, provider_id, raw_name) VALUES ('sc1', 's1', '1', 'Shows'), ('sc2', 's2', '1', 'Shows');
INSERT INTO series (id, source_id, category_id, provider_series_id, name, episodes_fetched_at, first_seen_at, last_seen_at) VALUES ('t1', 's1', 'sc1', '1', 'Show', 5, 1, 1), ('t2', 's2', 'sc2', '2', 'Stray show', 5, 1, 1);
INSERT INTO favourites (channel_id, added_at) VALUES ('c1', 10);
INSERT INTO recents (channel_id, played_at) VALUES ('c1', 20);
`;

const dump = (db: Database.Database) => {
  const objects = db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all() as { type: string; name: string; tbl_name: string; sql: string | null }[];
  const tables = objects.filter((entry) => entry.type === "table" && !/_(fts|data|idx|content|docsize|config)\b/.test(entry.name) || entry.name.endsWith("_fts")).map((entry) => entry.name);
  const columns: Record<string, string[]> = {};
  for (const table of tables) columns[table] = (db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map((row) => row.name);
  const rows = (sql: string) => db.prepare(sql).all();
  return {
    objects: objects.map((entry) => ({ type: entry.type, name: entry.name })),
    columns,
    data: {
      schema_meta: rows(`SELECT key, value FROM schema_meta WHERE key = 'version'`),
      sources: rows(`SELECT id, include_live, include_movies, include_series, sort_order, backup_urls FROM sources ORDER BY id`),
      movies: rows(`SELECT id FROM movies ORDER BY id`),
      series: rows(`SELECT id, episodes_fetched_at FROM series ORDER BY id`),
      favourites: rows(`SELECT channel_id, added_at, position, updated_at FROM favourites`),
      recents: rows(`SELECT channel_id, played_at, updated_at FROM recents`),
    },
  };
};

export function buildMigrationVectors() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const cases = [7, 10, 13].map((version) => {
    const schema = readFileSync(join(here, "..", "test-vectors", "db", "old", `schema-v${version}.sql`), "utf8");
    const db = new Database(":memory:");
    db.exec(schema);
    db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('version', ?)`).run(String(version));
    db.exec(SEED);
    migrateDatabase(db);
    const out = { from: version, now: NOW, ...dump(db) };
    db.close();
    return out;
  });
  vi.useRealTimers();
  return { "db/migrations": cases };
}
