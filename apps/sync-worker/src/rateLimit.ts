import type { Context } from "hono";
import type { Env } from "./index.js";

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (text: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** An IPv6 caller owns a whole /64, so key on that rather than on one address of it. */
export function network(ip: string): string {
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1); // IPv4, or an IPv4-mapped IPv6 literal
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const groups = head.split(":").filter(Boolean);
  if (ip.includes("::")) groups.push(...Array(Math.max(0, 8 - groups.length - tail.split(":").filter(Boolean).length)).fill("0"));
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":");
}

/**
 * Counts this request against the caller's daily allowance for `scope`; true when it is over `max`. The caller is only
 * ever stored as a hash that changes every day, so the table cannot be turned back into addresses.
 */
export async function overDailyLimit(c: Context<{ Bindings: Env }>, scope: string, max: number): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const ip = network(c.req.header("cf-connecting-ip") ?? "unknown");
  const ipHash = await sha256(`${c.env.SYNC_AUTH_SECRET}:${scope}:${day}:${ip}`);
  const row = await c.env.DB
    .prepare(
      `INSERT INTO waitlist_rate (ip_hash, day, count) VALUES (?, ?, 1)
       ON CONFLICT(day, ip_hash) DO UPDATE SET count = count + 1 RETURNING count`,
    )
    .bind(ipHash, day)
    .first<{ count: number }>();
  // A first hit of the day for this caller is a cheap moment to drop every earlier day.
  if (row?.count === 1) await c.env.DB.prepare(`DELETE FROM waitlist_rate WHERE day < ?`).bind(day).run();
  return (row?.count ?? 0) > max;
}
