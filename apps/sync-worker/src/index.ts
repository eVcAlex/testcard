import { Hono, type MiddlewareHandler } from "hono";
import { createAuth } from "./auth.js";
import { handleLinkApprove, handleLinkPoll, handleLinkSession, handleLinkStart } from "./routes/link.js";
import { handleRegisterGuide } from "./routes/guides.js";
import { handleWatchProxy } from "./routes/watch.js";
import { handlePull } from "./routes/pull.js";
import { handlePush } from "./routes/push.js";
import { handleShareClaim, handleShareCreate, handleShareList, handleShareRevoke } from "./routes/setup.js";
import { handleWaitlist } from "./routes/waitlist.js";
import { handleRelease } from "./routes/release.js";
import { handleGetSalt, handleSetSalt } from "./routes/salt.js";

export interface Env {
  readonly DB: D1Database;
  /** Release files for the in-app updater (the manifest and the APKs). */
  readonly RELEASES: R2Bucket;
  /** Signing/encryption secret for better-auth. Never in source: `wrangler secret put SYNC_AUTH_SECRET` when deployed, `.dev.vars` locally. */
  readonly SYNC_AUTH_SECRET: string;
  /** Cloudflare Email Sending binding (`send_email` in wrangler.toml). Absent in tests and local dev: no mail is sent. */
  readonly EMAIL?: { send(message: { from: string | { email: string; name?: string }; to: string; subject: string; text: string; html?: string }): Promise<unknown> };
  /** "on" lets signed-in accounts use the web player's stream proxy (`/watch/p`); anything else answers 404. Set in wrangler.toml. */
  readonly WEB_PLAYER?: string;
  /** "1" lets the proxy fetch private addresses. Tests only: never set in wrangler.toml. */
  readonly WATCH_ALLOW_PRIVATE?: string;
  /** Megabytes of proxied video one account may use per UTC day on the web player; unset or 0 for no cap. */
  readonly WATCH_DAILY_CAP_MB?: string;
  /** Comma-separated extra page origins allowed to sign in. Dev only (`wrangler dev --remote`); never set in wrangler.toml. */
  readonly AUTH_TRUSTED_ORIGINS?: string;
}

type AppEnv = { Bindings: Env; Variables: { userId: string } };

const app = new Hono<AppEnv>();

// apps/web/public/_headers covers the static site only; answers the Worker writes itself (API, installers) need these too.
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});

/** better-auth's `baseURL` taken from the request rather than its own inference (which its docs flag as "not recommended"). */
function authFor(c: { env: Env; req: { url: string } }) {
  return createAuth(c.env.DB, c.env.SYNC_AUTH_SECRET, new URL(c.req.url).origin, c.env.AUTH_TRUSTED_ORIGINS);
}

app.on(["GET", "POST"], "/auth/*", (c) => authFor(c).handler(c.req.raw));

const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await authFor(c).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", session.user.id);
  await next();
};

app.get("/app/:file", handleRelease);

// Signing a TV in with a code: the three calls behind it. No session: the TV has none yet.
app.post("/link/start", handleLinkStart);
app.get("/link/session", handleLinkSession);
app.post("/link/approve", handleLinkApprove);
app.get("/link/poll", handleLinkPoll);

// Sources shared by link. Claiming needs no session (the receiving device has no account); the rest are the sender's.
app.post("/share/claim", handleShareClaim);
app.post("/share", requireSession, handleShareCreate);
app.get("/share", requireSession, handleShareList);
app.delete("/share/:id", requireSession, handleShareRevoke);

app.post("/waitlist", handleWaitlist);

app.get("/sync/pull", requireSession, handlePull);
app.post("/sync/push", requireSession, handlePush);
app.get("/sync/salt", requireSession, handleGetSalt);
app.post("/sync/salt", requireSession, handleSetSalt);
app.post("/guides/register", requireSession, handleRegisterGuide);
app.on(["GET", "HEAD"], "/watch/p", requireSession, handleWatchProxy);

export default app;
