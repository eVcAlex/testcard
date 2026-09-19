import { openDatabaseSync, type SQLiteBindParams, type SQLiteBindValue, type SQLiteDatabase, type SQLiteStatement } from "expo-sqlite";
import type Database from "better-sqlite3";
import { migrateDatabase } from "@testcard/core/src/db/migrateDatabase.js";

/**
 * `packages/core` talks to SQLite through better-sqlite3's small synchronous API (`prepare` ->
 * `run` / `get` / `all`, `exec`, `transaction`). That native module does not exist on Android, so
 * this adapter gives expo-sqlite the same shape. It implements only what core uses.
 */

type Row = Record<string, unknown>;

/** Named tokens (`@id`, `:id`, `$id`) in the SQL, keyed by bare name, so an `{ id }` object can be bound like better-sqlite3 does. */
function namedTokens(sql: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of sql.matchAll(/([@:$])([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const [, prefix, name] = match;
    if (prefix !== undefined && name !== undefined) tokens.set(name, prefix);
  }
  return tokens;
}

function toBindValue(value: unknown): SQLiteBindValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  // Channel and variant ids use a NUL as their key separator. Android's SQLite binding treats text as a C
  // string and stops at the first NUL, so every id of a source would collapse to the same prefix (and the
  // second variant insert fails as a UNIQUE violation). Ids are local to a device, so swap it for U+0001.
  if (typeof value === "string" && value.includes("\0")) return value.replaceAll("\0", "\u0001");
  return value as SQLiteBindValue;
}

class Statement {
  private native: SQLiteStatement | undefined;
  private readonly tokens: Map<string, string>;

  constructor(
    private readonly db: SQLiteDatabase,
    private readonly sql: string,
  ) {
    this.tokens = namedTokens(sql);
  }

  private statement(): SQLiteStatement {
    this.native ??= this.db.prepareSync(this.sql);
    return this.native;
  }

  private bind(args: readonly unknown[]): SQLiteBindParams {
    const first = args[0];
    if (args.length === 1 && first !== null && typeof first === "object" && !Array.isArray(first) && !(first instanceof Uint8Array)) {
      const named: Record<string, SQLiteBindValue> = {};
      for (const [key, value] of Object.entries(first as Row)) named[`${this.tokens.get(key) ?? "@"}${key}`] = toBindValue(value);
      return named;
    }
    return (args.length === 1 && Array.isArray(first) ? first : args).map(toBindValue);
  }

  run(...args: unknown[]): { changes: number; lastInsertRowid: number } {
    const result = this.statement().executeSync(this.bind(args));
    const summary = { changes: result.changes, lastInsertRowid: result.lastInsertRowId };
    result.resetSync();
    return summary;
  }

  get(...args: unknown[]): Row | undefined {
    const result = this.statement().executeSync<Row>(this.bind(args));
    try {
      return result.getFirstSync() ?? undefined;
    } finally {
      result.resetSync();
    }
  }

  all(...args: unknown[]): Row[] {
    const result = this.statement().executeSync<Row>(this.bind(args));
    try {
      return result.getAllSync();
    } finally {
      result.resetSync();
    }
  }
}

class Adapter {
  private depth = 0;
  private readonly statements = new Map<string, Statement>();

  constructor(private readonly db: SQLiteDatabase) {}

  prepare(sql: string): Statement {
    let statement = this.statements.get(sql);
    if (statement === undefined) {
      statement = new Statement(this.db, sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  exec(sql: string): this {
    this.db.execSync(sql);
    return this;
  }

  pragma(source: string): void {
    this.db.execSync(`PRAGMA ${source}`);
  }

  /** better-sqlite3 style: returns a function that runs `fn` in a transaction. Nested calls join the outer one. */
  transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
    return (...args: Args): Result => {
      if (this.depth > 0) return fn(...args);
      let result: Result | undefined;
      this.depth += 1;
      try {
        this.db.withTransactionSync(() => {
          result = fn(...args);
        });
      } finally {
        this.depth -= 1;
      }
      return result as Result;
    };
  }
}

/** Opens (creating or migrating) the app database and returns it in the shape `packages/core` expects. */
export function openAppDatabase(name = "testcard.db"): Database.Database {
  const native = openDatabaseSync(name);
  native.execSync("PRAGMA journal_mode = WAL");
  native.execSync("PRAGMA foreign_keys = ON");
  return migrateDatabase(new Adapter(native) as unknown as Database.Database);
}
