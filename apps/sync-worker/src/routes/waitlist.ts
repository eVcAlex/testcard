import { z } from "zod";
import type { Context } from "hono";
import type { Env } from "../index.js";

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
  .regex(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/);

const Schema = z.object({
  email: Email,
  windows: z.boolean().default(false),
  firetv: z.boolean().default(false),
  hp_note: z.unknown().optional(),
});

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (text: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

function respond(c: WaitlistContext, body: Record<string, unknown>, status: 200 | 400 | 403 | 413 | 415 | 429) {
  c.header("Cache-Control", "no-store");
  return c.json(body, status);
}

/** An IPv6 caller owns a whole /64, so key on that rather than on one address of it. */
function network(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const groups = head.split(":").filter(Boolean);
  if (ip.includes("::")) groups.push(...Array(Math.max(0, 8 - groups.length - tail.split(":").filter(Boolean).length)).fill("0"));
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":");
}

/** Counts this request against the caller's daily allowance; true when it is over the limit. */
async function overLimit(c: WaitlistContext): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const ip = network(c.req.header("cf-connecting-ip") ?? "unknown");
  const ipHash = await sha256(`${c.env.SYNC_AUTH_SECRET}:waitlist:${day}:${ip}`);
  const row = await c.env.DB
    .prepare(
      `INSERT INTO waitlist_rate (ip_hash, day, count) VALUES (?, ?, 1)
       ON CONFLICT(day, ip_hash) DO UPDATE SET count = count + 1 RETURNING count`,
    )
    .bind(ipHash, day)
    .first<{ count: number }>();
  // A first hit of the day for this caller is a cheap moment to drop every earlier day.
  if (row?.count === 1) await c.env.DB.prepare(`DELETE FROM waitlist_rate WHERE day < ?`).bind(day).run();
  return (row?.count ?? 0) > MAX_PER_IP_PER_DAY;
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

  if (await overLimit(c)) return respond(c, { error: "rate limited" }, 429);

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
