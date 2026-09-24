import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";

/**
 * One `better-auth` instance per request (Workers have no persistent module-level state across
 * requests) — cheap: it just wraps the D1 binding already handed to us, no connection to open.
 *
 * `secret` and `baseURL` are passed explicitly rather than left to better-auth's env-var /
 * request-inference fallbacks: Workers have no `process.env`, so the env-var fallback would throw
 * or silently land on an insecure default instead of resolving at all. `secret` also underpins
 * other better-auth internals (cookie signing, CSRF checks) even though the `bearer()` plugin below
 * — configured with the default `requireSignature: false` — does not itself use it to gate raw
 * bearer tokens; see the comment on `test/auth-sync.integration.test.ts`'s secret-binding test.
 */
export function createAuth(db: D1Database, secret: string, baseUrl: string) {
  return betterAuth({
    database: db,
    /**
     * Must match the path `index.ts` mounts the handler at. better-auth defaults to `/api/auth`,
     * which would make every route it advertises 404 behind our `/auth/*` mount.
     */
    basePath: "/auth",
    baseURL: baseUrl,
    secret,
    /**
     * better-auth 1.7's Kysely adapter validates its schema at init by introspecting
     * `sqlite_master`, and *rethrows* the failure into every auth request. D1 refuses that query
     * outright (`D1_ERROR: not authorized: SQLITE_AUTH`), so left on, every `/auth/*` call 500s.
     * Our schema is pinned by `migrations/0000_better_auth.sql` and applied by `wrangler d1
     * migrations apply`, so the check buys nothing here anyway — if that migration ever drifts from
     * better-auth's expectations, the integration test in `test/auth-sync.integration.test.ts` is
     * what catches it.
     */
    advanced: { database: { validateSchema: false } },
    emailAndPassword: { enabled: true },
    session: { expiresIn: 60 * 60 * 24 * 30 }, // 30 days
    /**
     * Turns an `Authorization: Bearer <session token>` header into a resolvable session.
     * `SyncClient` (packages/core/src/sync/client.ts) runs over bare `fetch` with no cookie jar,
     * so the default cookie-only session lookup is unavailable to it. Left at the default
     * `requireSignature: false` so the raw token from the sign-in/sign-up response body works.
     */
    plugins: [bearer()],
  });
}
