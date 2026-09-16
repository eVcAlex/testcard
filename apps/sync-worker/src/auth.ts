import { betterAuth } from "better-auth";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";

/**
 * One `better-auth` instance per request (Workers have no persistent module-level state across
 * requests) — cheap: it just wraps the D1 binding already handed to us, no connection to open.
 */
export function createAuth(db: D1Database) {
  return betterAuth({
    database: { db: new Kysely({ dialect: new D1Dialect({ database: db }) }), type: "sqlite" },
    emailAndPassword: { enabled: true },
    session: { expiresIn: 60 * 60 * 24 * 30 }, // 30 days
  });
}
