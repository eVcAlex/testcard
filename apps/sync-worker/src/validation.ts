import type { Context } from "hono";
import type { z } from "zod";
import type { Env } from "./index.js";

export type AppContext = Context<{ Bindings: Env; Variables: { userId: string } }>;

export type ParseResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly response: Response };

/**
 * Parses a JSON request body against a zod schema, answering `400` rather than letting a `ZodError`
 * (or a JSON syntax error) reach Hono's default handler as a `500`.
 *
 * This distinction matters for the sync loop: a `500` reads as "transient, retry me", but a schema
 * mismatch between an old client build and a newer Worker is *permanent*, so a retrying client
 * would hot-loop forever against it. `400` tells the client to stop and surface the problem.
 *
 * Note this is only for request-side validation. `pull.ts` validating its own *response* before
 * sending it is a genuine server bug when it fails, and correctly stays a `500`.
 */
export async function parseJsonBody<T>(c: AppContext, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: "invalid request", issues: [{ message: "request body is not valid JSON" }] }, 400) };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: c.json({ error: "invalid request", issues: parsed.error.issues }, 400) };
  return { ok: true, data: parsed.data };
}
