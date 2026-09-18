import Database from "better-sqlite3";
import { MIGRATIONS, pendingMigrations } from "./migrations.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";
import { reclassifyCategories } from "./categoryClassification.js";

/** Opens the app's SQLite database at `filePath`, creating or migrating it to the current schema. */
export function openDatabase(filePath: string): Database.Database {
  const db = openAndMigrate(filePath);
  reclassifyCategories(db); // no-op unless the category classifier's rules changed since last open
  return db;
}

function openAndMigrate(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");

  // Checked via sqlite_master (always safe, even on a brand-new empty file) BEFORE running
  // SCHEMA_SQL — SCHEMA_SQL describes the *latest* shape, and `CREATE TABLE IF NOT EXISTS` is a
  // no-op against a table an older release already created. Running it unconditionally here used
  // to mean a CREATE INDEX (or CREATE TABLE) statement for a column only a later migration adds
  // would fail against an existing database's still-old table shape (e.g. "no such column:
  // remote_key" on an upgrade from schema v4) — migrations must run first on an existing database.
  const schemaMetaExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'`).get();

  if (schemaMetaExists === undefined) {
    // Fresh database — SCHEMA_SQL builds it at the latest shape directly, nothing to migrate.
    db.exec(SCHEMA_SQL);
    db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('version', ?)`).run(String(SCHEMA_VERSION));
    return db;
  }

  const stored = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get() as
    | { value: string }
    | undefined;

  if (stored === undefined) {
    // schema_meta exists with no version row — shouldn't happen in practice, but nothing to
    // migrate from without a starting version, so just stamp current and move on.
    db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('version', ?)`).run(String(SCHEMA_VERSION));
    return db;
  }

  const pending = pendingMigrations(Number(stored.value), MIGRATIONS);
  if (pending.length > 0) {
    const run = db.transaction(() => {
      for (const migration of pending) migration.up(db);
      db.prepare(`UPDATE schema_meta SET value = ? WHERE key = 'version'`).run(String(SCHEMA_VERSION));
    });
    run();
  }

  return db;
}
