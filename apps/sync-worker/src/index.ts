import { Hono, type MiddlewareHandler } from "hono";
import { createAuth } from "./auth.js";
import { handleLinkApprove, handleLinkPage, handleLinkPoll, handleLinkSession, handleLinkStart } from "./routes/link.js";
import { handlePull } from "./routes/pull.js";
import { handlePush } from "./routes/push.js";
import { handleRelease } from "./routes/release.js";
import { handleGetSalt, handleSetSalt } from "./routes/salt.js";

export interface Env {
  readonly DB: D1Database;
  /** Release files for the in-app updater (the manifest and the APKs). */
  readonly RELEASES: R2Bucket;
  /** Signing/encryption secret for better-auth. Never in source: `wrangler secret put SYNC_AUTH_SECRET` when deployed, `.dev.vars` locally. */
  readonly SYNC_AUTH_SECRET: string;
}

type AppEnv = { Bindings: Env; Variables: { userId: string } };

const app = new Hono<AppEnv>();

/** better-auth's `baseURL` taken from the request rather than its own inference (which its docs flag as "not recommended"). */
function authFor(c: { env: Env; req: { url: string } }) {
  return createAuth(c.env.DB, c.env.SYNC_AUTH_SECRET, new URL(c.req.url).origin);
}

app.on(["GET", "POST"], "/auth/*", (c) => authFor(c).handler(c.req.raw));

const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await authFor(c).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", session.user.id);
  await next();
};

app.get("/app/:file", handleRelease);

// Signing a TV in with a code: the page, and the three calls behind it. No session: the TV has none yet.
app.get("/link", handleLinkPage);
app.post("/link/start", handleLinkStart);
app.get("/link/session", handleLinkSession);
app.post("/link/approve", handleLinkApprove);
app.get("/link/poll", handleLinkPoll);

app.get("/sync/pull", requireSession, handlePull);
app.post("/sync/push", requireSession, handlePush);
app.get("/sync/salt", requireSession, handleGetSalt);
app.post("/sync/salt", requireSession, handleSetSalt);

export default app;
