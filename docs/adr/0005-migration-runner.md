# ADR 0005: Schema migration runner

## Status

Accepted (Phase 4a).

## Context

`openDatabase.ts` was `db.exec(SCHEMA_SQL)` — every statement `CREATE ... IF NOT EXISTS` — plus
a `schema_meta.version` row written once and never read back. That works for adding a new table
or index (the `IF NOT EXISTS` runs on every open) but **not** for adding a column to an existing
table: `CREATE TABLE IF NOT EXISTS sources (...)` is a no-op once `sources` exists, so a new
column never reaches a database created by an earlier release. Phase 4a needs new `sources`
columns (`original_input`, `refresh_interval_hours`) and Phase 4b needs whole new tables plus
columns, so the runner had to exist before that work.

## Decision

A minimal forward-only runner in `packages/core/src/db/migrations.ts`:

- **`SCHEMA_SQL` always describes the latest shape.** A fresh database is built correct in one
  `db.exec` and is stamped at `SCHEMA_VERSION` with no migration run.
- **`MIGRATIONS`** is an ordered list of `{ version, up(db) }`. Each `up` brings a database from
  `version - 1` to `version` — typically `ALTER TABLE ... ADD COLUMN` (guarded by a
  `PRAGMA table_info` check so a partially-migrated db is safe) or `CREATE TABLE`.
- **`pendingMigrations(fromVersion, all)`** is a **pure** function: it filters and sorts the
  list. This is the unit-tested part (`__tests__/migrations.test.ts`), along with a guard that
  `MIGRATIONS` stays contiguous from 2 and ends at `SCHEMA_VERSION`. The effectful executor in
  `openDatabase` — read the stored version, run the pending `up`s in one transaction, bump the
  stamp — is verified in the desktop smoke test, consistent with the rest of the DB layer
  (ADR 0003: `better-sqlite3`'s native binding is Electron's ABI, not plain Node's, so core has
  no DB-backed unit tests).

Rules: never edit or reorder a shipped migration; bump `SCHEMA_VERSION` and update `SCHEMA_SQL`
in the same change that appends a migration (the test enforces the version match).

## Consequences

- Forward-only. No `down`. A downgrade path isn't a goal for a local single-user app; a user on
  a newer schema who installs an older build is unsupported (the older `pendingMigrations` would
  simply run nothing and the extra columns sit unused).
- The whole pending set runs in one transaction — a failure rolls back cleanly and the version
  stamp is unchanged, so the next launch retries.
- `openDatabase` no longer inserts the version row for an already-stamped database; it only
  `UPDATE`s after a successful migration batch.
