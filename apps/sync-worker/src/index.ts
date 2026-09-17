import { Hono, type MiddlewareHandler } from "hono";
import { createAuth } from "./auth.js";
import { handlePull } from "./routes/pull.js";
import { handlePush } from "./routes/push.js";
import { handleGetSalt, handleSetSalt } from "./routes/salt.js";

export interface Env {
  readonly DB: D1Database;
  /**
   * Signing/encryption secret for better-auth. Declared with a placeholder under `[vars]` in
   * `wrangler.toml` so local dev and tests work with no manual step; a real deploy must override
   * it with `wrangler secret put SYNC_AUTH_SECRET`.
   */
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

app.get("/sync/pull", requireSession, handlePull);
app.post("/sync/push", requireSession, handlePush);
app.get("/sync/salt", requireSession, handleGetSalt);
app.post("/sync/salt", requireSession, handleSetSalt);

export default app;
