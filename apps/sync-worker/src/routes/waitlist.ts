import { z } from "zod";
import type { Context } from "hono";
import type { Env } from "../index.js";
import { overDailyLimit } from "../rateLimit.js";

/**
 * Website waitlist. Same-origin only (no CORS headers are ever sent), JSON only, small bodies. The email is never
 * echoed, logged or confirmed as already present; the IP is only ever stored as a daily-salted hash.
 */
type WaitlistContext = Context<{ Bindings: Env }>;

const MAX_BODY_BYTES = 2048;
export const MAX_PER_IP_PER_DAY = 5;

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/)
  // The regex is permissive on purpose; these catch the typos that would never get an invitation.
  .refine((e) => !e.startsWith(".") && !e.includes("..") && !e.includes(".@") && /\.[a-z]{2,}$/.test(e));

const Schema = z.object({
  email: Email,
  windows: z.boolean().default(false),
  firetv: z.boolean().default(false),
  hp_note: z.unknown().optional(),
});

function respond(c: WaitlistContext, body: Record<string, unknown>, status: 200 | 400 | 403 | 413 | 415 | 429) {
  c.header("Cache-Control", "no-store");
  return c.json(body, status);
}

export async function handleWaitlist(c: WaitlistContext): Promise<Response> {
  const origin = c.req.header("origin");
  if (origin !== undefined && origin !== new URL(c.req.url).origin) return respond(c, { error: "forbidden" }, 403);

  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") return respond(c, { error: "unsupported media type" }, 415);

  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return respond(c, { error: "too large" }, 413);
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return respond(c, { error: "too large" }, 413);

  if (await overDailyLimit(c, "waitlist", MAX_PER_IP_PER_DAY)) return respond(c, { error: "rate limited" }, 429);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return respond(c, { error: "invalid request" }, 400);
  }
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) return respond(c, { error: "invalid request" }, 400);
  const { email, windows, firetv, hp_note } = parsed.data;

  // Honeypot: a bot filled the hidden field. Look successful, store nothing.
  if (hp_note !== undefined && hp_note !== "") return respond(c, { ok: true }, 200);

  await c.env.DB
    .prepare(`INSERT INTO waitlist (email, windows, firetv, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`)
    .bind(email, windows ? 1 : 0, firetv ? 1 : 0, new Date().toISOString())
    .run();
  return respond(c, { ok: true }, 200);
}
