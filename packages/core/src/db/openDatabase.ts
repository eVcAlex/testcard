import Database from "better-sqlite3";
import { MIGRATIONS, pendingMigrations } from "./migrations.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

/** Opens the app's SQLite database at `filePath`, creating or migrating it to the current schema. */
export function openDatabase(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);

  const stored = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get() as
    | { value: string }
    | undefined;

  if (stored === undefined) {
    // Fresh database — SCHEMA_SQL just built it at the latest shape, so nothing to migrate.
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
