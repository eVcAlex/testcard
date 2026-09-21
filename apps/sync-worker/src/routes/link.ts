import { z } from "zod";
import type { Context } from "hono";
import { linkPageHtml } from "../pages/linkPage.js";
import type { Env } from "../index.js";

/**
 * Signing a TV in with a code. None of these routes is behind a session: the TV has none yet, and the person
 * on the page proves who they are inside the sealed payload. Bodies, codes and blobs are never logged.
 */
type LinkContext = Context<{ Bindings: Env }>;

const SESSION_LIFETIME_MS = 10 * 60 * 1000;

/** Base64 of a 32-byte hash, a 16-byte salt and a small sealed payload: generous caps, so nothing large is stored. */
const LookupSchema = z.string().min(20).max(64).regex(/^[A-Za-z0-9+/=]+$/);
const SaltSchema = z.string().min(16).max(40).regex(/^[A-Za-z0-9+/=]+$/);
const BlobSchema = z.string().min(16).max(4096).regex(/^[A-Za-z0-9+/=]+$/);
const IvSchema = z.string().min(12).max(24).regex(/^[A-Za-z0-9+/=]+$/);

const StartSchema = z.object({ lookup: LookupSchema, salt: SaltSchema });
const ApproveSchema = z.object({ lookup: LookupSchema, blob: BlobSchema, iv: IvSchema });

const bad = (c: LinkContext) => c.json({ error: "invalid request" }, 400);
const gone = (c: LinkContext) => c.json({ error: "not found or expired" }, 404);

async function body<T>(c: LinkContext, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T | undefined> {
  try {
    const parsed = schema.safeParse(await c.req.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The TV registers a code it just made. */
export async function handleLinkStart(c: LinkContext): Promise<Response> {
  const data = await body(c, StartSchema);
  if (data === undefined) return bad(c);
  const now = Date.now();
  await c.env.DB.prepare(`DELETE FROM link_sessions WHERE expires_at <= ?`).bind(now).run();
  const result = await c.env.DB
    .prepare(`INSERT INTO link_sessions (lookup, salt, created_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(lookup) DO NOTHING`)
    .bind(data.lookup, data.salt, now, now + SESSION_LIFETIME_MS)
    .run();
  // A code that is already live cannot be registered again over the top of it.
  if (result.meta.changes === 0) return c.json({ error: "already in use" }, 409);
  return c.json({ expiresAt: now + SESSION_LIFETIME_MS });
}

/** The page asks for the salt of the code it was given, which also tells it whether the code is live. */
export async function handleLinkSession(c: LinkContext): Promise<Response> {
  const lookup = LookupSchema.safeParse(c.req.query("lookup"));
  if (!lookup.success) return bad(c);
  const row = await c.env.DB
    .prepare(`SELECT salt FROM link_sessions WHERE lookup = ? AND expires_at > ? AND blob IS NULL`)
    .bind(lookup.data, Date.now())
    .first<{ salt: string }>();
  return row === null ? gone(c) : c.json({ salt: row.salt });
}

/** The page hands over the sealed sign-in. Only once per code, and only while it is live. */
export async function handleLinkApprove(c: LinkContext): Promise<Response> {
  const data = await body(c, ApproveSchema);
  if (data === undefined) return bad(c);
  const result = await c.env.DB
    .prepare(`UPDATE link_sessions SET blob = ?, iv = ? WHERE lookup = ? AND expires_at > ? AND blob IS NULL`)
    .bind(data.blob, data.iv, data.lookup, Date.now())
    .run();
  return result.meta.changes === 0 ? gone(c) : c.json({ ok: true });
}

/** The TV asks whether it has been approved. Collecting the sealed sign-in deletes it. */
export async function handleLinkPoll(c: LinkContext): Promise<Response> {
  const lookup = LookupSchema.safeParse(c.req.query("lookup"));
  if (!lookup.success) return bad(c);
  const row = await c.env.DB
    .prepare(`SELECT blob, iv FROM link_sessions WHERE lookup = ? AND expires_at > ?`)
    .bind(lookup.data, Date.now())
    .first<{ blob: string | null; iv: string | null }>();
  if (row === null) return gone(c);
  if (row.blob === null || row.iv === null) return c.json({ status: "waiting" });
  await c.env.DB.prepare(`DELETE FROM link_sessions WHERE lookup = ?`).bind(lookup.data).run();
  return c.json({ status: "ready", blob: row.blob, iv: row.iv });
}

/** The page itself. Nothing on it may be cached or sent on to another site. */
export function handleLinkPage(c: LinkContext): Response {
  return c.html(linkPageHtml, 200, {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
}
