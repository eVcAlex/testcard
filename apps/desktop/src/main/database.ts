import { app } from "electron";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openDatabase, runDeferredCatalogueMaintenance } from "@testcard/core";

let db: Database.Database | null = null;

/** The app's single SQLite database, in Electron's per-user data directory. */
export function getDatabase(): Database.Database {
  if (db === null) {
    db = openDatabase(join(app.getPath("userData"), "testcard.sqlite3"));
    void runDeferredCatalogueMaintenance(db).catch((error: unknown) => console.error("Deferred catalogue maintenance failed", error));
  }
  return db;
}
