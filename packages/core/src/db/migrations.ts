import type Database from "better-sqlite3";

export interface Migration {
  readonly version: number;
  readonly up: (db: Database.Database) => void;
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((row) => row.name === column);
}

/** `ALTER TABLE ADD COLUMN`, skipped if the column is somehow already present. */
function addColumn(db: Database.Database, table: string, columnDef: string): void {
  const column = columnDef.split(/\s+/)[0];
  if (column !== undefined && !hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  }
}

/**
 * Forward-only schema migrations. `schema.ts`'s `SCHEMA_SQL` always describes the *latest*
 * shape, so a fresh database is built correct and skips every migration; these bring an
 * older database (one created by a previous release) up to `SCHEMA_VERSION`. `openDatabase`
 * runs the pending set inside one transaction and bumps the stored version.
 *
 * Adding a migration: append an entry here and bump `SCHEMA_VERSION` + `SCHEMA_SQL` to match.
 * Never edit or reorder a shipped migration.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 2,
    up: (db) => {
      // Phase 4a — editable sources + per-source auto-refresh.
      addColumn(db, "sources", "original_input TEXT");
      addColumn(db, "sources", "refresh_interval_hours INTEGER");
    },
  },
];

/** The migrations still needed to bring a database at `fromVersion` up to date. Pure. */
export function pendingMigrations(
  fromVersion: number,
  all: readonly Migration[] = MIGRATIONS,
): Migration[] {
  return all.filter((migration) => migration.version > fromVersion).sort((a, b) => a.version - b.version);
}
