import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/openDatabase.js";
import { MIGRATIONS } from "../db/migrations.js";
import { SCHEMA_VERSION } from "../db/schema.js";

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testcard-opendb-"));
  filePath = join(dir, "testcard.sqlite3");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Builds a database file shaped like a real device's on-disk `testcard.sqlite3` left over from
 * before the device-sync migration (`schema_meta.version = 4`) — i.e. every table migration 4
 * creates, none of migration 5's added columns/tables, exactly what a returning user's existing
 * install looks like when the app upgrades to schema v5.
 */
function seedPreV5Database(path: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO schema_meta (key, value) VALUES ('version', '4');

    CREATE TABLE sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT,
      playlist_url TEXT,
      epg_url TEXT,
      refresh_interval_hours INTEGER,
      created_at INTEGER NOT NULL,
      last_refreshed_at INTEGER
    );
  `);
  const v4 = MIGRATIONS.find((m) => m.version === 4);
  if (!v4) throw new Error("expected a version-4 migration to exist");
  v4.up(db);
  db.close();
}

describe("openDatabase", () => {
  it("migrates an existing pre-v5 database on disk without throwing", () => {
    seedPreV5Database(filePath);

    expect(() => openDatabase(filePath)).not.toThrow();
  });

  it("brings a pre-v5 database's schema fully up to SCHEMA_VERSION", () => {
    seedPreV5Database(filePath);

    const db = openDatabase(filePath);
    const version = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get() as { value: string };
    expect(Number(version.value)).toBe(SCHEMA_VERSION);

    const sourcesColumns = (db.prepare(`PRAGMA table_info(sources)`).all() as { name: string }[]).map((c) => c.name);
    expect(sourcesColumns).toContain("remote_key");
    expect(sourcesColumns).toContain("sync_updated_at");

    const progressColumns = (db.prepare(`PRAGMA table_info(playback_progress)`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(progressColumns).toContain("remote_key");
    expect(progressColumns).toContain("deleted_at");

    // The migration's own CREATE INDEX statements must have succeeded too, not just the columns.
    const indexNames = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(indexNames).toContain("idx_sources_remote_key");
  });

  it("still builds a fresh database correctly (no regression on the new-install path)", () => {
    const db = openDatabase(filePath);
    const version = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get() as { value: string };
    expect(Number(version.value)).toBe(SCHEMA_VERSION);
  });
});
