import { Hono } from "hono";
import { createAuth } from "./auth.js";
import { handlePull } from "./routes/pull.js";
import { handlePush } from "./routes/push.js";
import { handleGetSalt, handleSetSalt } from "./routes/salt.js";

export interface Env {
  readonly DB: D1Database;
}

type AppEnv = { Bindings: Env; Variables: { userId: string } };

const app = new Hono<AppEnv>();

app.on(["GET", "POST"], "/auth/*", (c) => createAuth(c.env.DB).handler(c.req.raw));

async function requireSession(c: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>): Promise<Response | void> {
  const session = await createAuth(c.env.DB).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", session.user.id);
  await next();
}

app.get("/sync/pull", requireSession, handlePull);
app.post("/sync/push", requireSession, handlePush);
app.get("/sync/salt", requireSession, handleGetSalt);
app.post("/sync/salt", requireSession, handleSetSalt);

export default app;
