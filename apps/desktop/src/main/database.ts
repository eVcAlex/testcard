import { app } from "electron";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openDatabase } from "@testcard/core";

let db: Database.Database | null = null;

/** The app's single SQLite database, in Electron's per-user data directory. */
export function getDatabase(): Database.Database {
  db ??= openDatabase(join(app.getPath("userData"), "testcard.sqlite3"));
  return db;
}
