import Database from "better-sqlite3";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

/** Opens (creating and migrating if needed) the app's SQLite database at `filePath`. */
export function openDatabase(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);

  const currentVersion = db
    .prepare(`SELECT value FROM schema_meta WHERE key = 'version'`)
    .get() as { value: string } | undefined;

  if (currentVersion === undefined) {
    db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('version', ?)`).run(String(SCHEMA_VERSION));
  }
  // No migrations yet — schema is at v1. Future schema changes add a migration step here
  // keyed off `currentVersion`, run inside a transaction, before returning `db`.

  return db;
}
