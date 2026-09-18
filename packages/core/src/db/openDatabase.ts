import Database from "better-sqlite3";
import { migrateDatabase } from "./migrateDatabase.js";

/** Opens the app's SQLite database at `filePath`, creating or migrating it to the current schema. */
export function openDatabase(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  return migrateDatabase(db);
}
