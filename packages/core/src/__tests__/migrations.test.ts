import { describe, expect, it } from "vitest";
import { MIGRATIONS, pendingMigrations, type Migration } from "../db/migrations.js";
import { SCHEMA_VERSION } from "../db/schema.js";

const fake: Migration[] = [
  { version: 2, up: () => undefined },
  { version: 3, up: () => undefined },
  { version: 4, up: () => undefined },
];

describe("pendingMigrations", () => {
  it("returns migrations newer than the current version, in order", () => {
    expect(pendingMigrations(2, fake).map((m) => m.version)).toEqual([3, 4]);
  });

  it("returns nothing when the database is already current", () => {
    expect(pendingMigrations(4, fake)).toEqual([]);
  });

  it("returns every migration for a v1 database", () => {
    expect(pendingMigrations(1, fake).map((m) => m.version)).toEqual([2, 3, 4]);
  });

  it("sorts an out-of-order migration list", () => {
    const shuffled = [fake[2], fake[0], fake[1]] as Migration[];
    expect(pendingMigrations(1, shuffled).map((m) => m.version)).toEqual([2, 3, 4]);
  });
});

describe("MIGRATIONS", () => {
  it("is contiguous from version 2 and ends at SCHEMA_VERSION", () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual(Array.from({ length: versions.length }, (_, i) => i + 2));
    expect(versions.at(-1)).toBe(SCHEMA_VERSION);
  });
});
