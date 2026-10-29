import {
  SETUP_MAX_ACTIVE_PER_ACCOUNT,
  SetupClaimRequestSchema,
  SetupCreateRequestSchema,
  SetupIdSchema,
  setupClaimHash,
  type SetupProfileSummary,
} from "@testcard/sync-schema";
import type { Context } from "hono";
import type { Env } from "../index.js";
import { overDailyLimit } from "../rateLimit.js";
import { parseJsonBody, type AppContext } from "../validation.js";

/** The claim has no session, so no `userId` either. */
type ClaimContext = Context<{ Bindings: Env }>;

/**
 * Sources shared by link. The Worker stores a sealed blob and a hash; it never sees the secret that opens the one or
 * produces the proof for the other (they live in the link's fragment). Bodies, ids and blobs are never logged.
 *
 * Creating, listing and revoking need the sender's session. Claiming needs none: the receiving device has no account, and
 * proves it holds the link instead. A claim grants that one sealed source and nothing of the sender's account.
 */

/** A claim is a handful per person; this only stops one network hammering the endpoint. */
export const MAX_CLAIMS_PER_NETWORK_PER_DAY = 120;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Spent and expired rows are kept this long after, so the sender's list can still show what happened. */
const KEEP_AFTER_END_MS = 30 * DAY_MS;

const notFound = (c: AppContext | ClaimContext) => c.json({ error: "not found or expired" }, 404);

/** The sender registers a sealed source. */
export async function handleShareCreate(c: AppContext): Promise<Response> {
  const parsed = await parseJsonBody(c, SetupCreateRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { id, claimHash, label, blob, iv, expiresInDays, maxClaims } = parsed.data;
  const userId = c.get("userId");
  const now = Date.now();

  await c.env.DB.prepare(`DELETE FROM setup_profiles WHERE user_id = ? AND (expires_at < ? OR revoked_at < ?)`).bind(userId, now - KEEP_AFTER_END_MS, now - KEEP_AFTER_END_MS).run();
  const live = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM setup_profiles WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? AND claims < max_claims`)
    .bind(userId, now)
    .first<{ n: number }>();
  if ((live?.n ?? 0) >= SETUP_MAX_ACTIVE_PER_ACCOUNT) return c.json({ error: "too many active links; revoke one first" }, 429);

  const expiresAt = now + expiresInDays * DAY_MS;
  const result = await c.env.DB
    .prepare(
      `INSERT INTO setup_profiles (id, user_id, label, claim_hash, blob, iv, created_at, expires_at, max_claims) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(id, userId, label, claimHash, blob, iv, now, expiresAt, maxClaims)
    .run();
  if (result.meta.changes === 0) return c.json({ error: "already in use" }, 409);
  return c.json({ id, expiresAt });
}

/** The sender's own links, newest first. Never includes the sealed source. */
export async function handleShareList(c: AppContext): Promise<Response> {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, label, created_at AS createdAt, expires_at AS expiresAt, max_claims AS maxClaims, claims, revoked_at AS revokedAt
       FROM setup_profiles WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(c.get("userId"))
    .all<SetupProfileSummary>();
  return c.json({ profiles: rows.results });
}

/** Stops a link working and discards its sealed source at once, whether or not it was ever used. */
export async function handleShareRevoke(c: AppContext): Promise<Response> {
  const id = SetupIdSchema.safeParse(c.req.param("id"));
  if (!id.success) return notFound(c);
  const result = await c.env.DB
    .prepare(`UPDATE setup_profiles SET revoked_at = ?, blob = '', iv = '' WHERE id = ? AND user_id = ? AND revoked_at IS NULL`)
    .bind(Date.now(), id.data, c.get("userId"))
    .run();
  return result.meta.changes === 0 ? notFound(c) : c.json({ ok: true });
}

/**
 * A device shows the proof from its link and is handed the sealed source, counting one use. Unknown, wrong, expired,
 * revoked and used-up all answer the same, so nothing can be learned about which ids exist.
 */
export async function handleShareClaim(c: ClaimContext): Promise<Response> {
  if (await overDailyLimit(c, "share-claim", MAX_CLAIMS_PER_NETWORK_PER_DAY)) return c.json({ error: "rate limited" }, 429);
  const parsed = SetupClaimRequestSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "invalid request" }, 400);
  const hash = await setupClaimHash(parsed.data.proof);
  // One statement checks and counts, so two devices racing for a single-use link cannot both win it.
  const row = await c.env.DB
    .prepare(
      `UPDATE setup_profiles SET claims = claims + 1
       WHERE id = ? AND claim_hash = ? AND revoked_at IS NULL AND expires_at > ? AND claims < max_claims
       RETURNING blob, iv`,
    )
    .bind(parsed.data.id, hash, Date.now())
    .first<{ blob: string; iv: string }>();
  return row === null ? notFound(c) : c.json({ blob: row.blob, iv: row.iv });
}
