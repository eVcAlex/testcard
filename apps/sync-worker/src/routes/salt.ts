import type { Context } from "hono";
import { z } from "zod";
import type { Env } from "../index.js";

/**
 * Every device must derive the *same* AES-GCM key from the account password, which means every
 * device needs the same PBKDF2 salt. The device that signs up generates one (client-side, via
 * `packages/core/src/sync/credentialCrypto.ts#generateSalt`) and stores it here once; every other
 * device fetches it on first sign-in, before it can encrypt or decrypt anything. The salt itself
 * isn't secret — see the design spec's "Credential encryption" — so storing it server-side in the
 * clear is fine; only the password that derives a key from it matters.
 */

const SetSaltBodySchema = z.object({ salt: z.string().min(1) });

export async function handleGetSalt(c: Context<{ Bindings: Env; Variables: { userId: string } }>): Promise<Response> {
  const row = await c.env.DB.prepare(`SELECT salt FROM sync_salts WHERE user_id = ?`).bind(c.get("userId")).first<{ salt: string }>();
  if (!row) return c.json({ error: "no salt set for this account yet" }, 404);
  return c.json({ salt: row.salt });
}

/** Set-once: refuses to overwrite an existing salt, since changing it would strand every other device's key derivation. */
export async function handleSetSalt(c: Context<{ Bindings: Env; Variables: { userId: string } }>): Promise<Response> {
  const { salt } = SetSaltBodySchema.parse(await c.req.json());
  const result = await c.env.DB
    .prepare(`INSERT INTO sync_salts (user_id, salt) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING`)
    .bind(c.get("userId"), salt)
    .run();
  if (result.meta.changes === 0) return c.json({ error: "salt already set for this account" }, 409);
  return c.json({ ok: true });
}
