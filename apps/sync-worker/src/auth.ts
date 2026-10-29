import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { RESET_SUBJECT, resetHtml, resetText } from "./resetEmail.js";

/** Sends one email; absent in tests and local dev, where no mail goes out. */
export type Mailer = (message: { from: { email: string; name: string }; to: string; subject: string; text: string; html: string }) => Promise<unknown>;

/** An hour: long enough to find the email, short enough that a forgotten one soon stops working. */
const RESET_TOKEN_SECONDS = 60 * 60;

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
export function createAuth(db: D1Database, secret: string, baseUrl: string, extraOrigins: string = "", sendMail?: Mailer, background?: (work: Promise<unknown>) => void) {
  return betterAuth({
    database: db,
    /**
     * Must match the path `index.ts` mounts the handler at. better-auth defaults to `/api/auth`,
     * which would make every route it advertises 404 behind our `/auth/*` mount.
     */
    basePath: "/auth",
    baseURL: baseUrl,
    /**
     * Pages allowed to call this Worker besides its own address. Only for `wrangler dev --remote`, where the Worker sees a
     * preview address while the browser's page is on localhost (`AUTH_TRUSTED_ORIGINS`, never set in wrangler.toml).
     */
    trustedOrigins: extraOrigins.split(",").map((origin) => origin.trim()).filter((origin) => origin !== ""),
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
    advanced: {
      database: { validateSchema: false },
      // Cloudflare puts the real client address in cf-connecting-ip; x-forwarded-for is not trusted.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      // The reset email goes out after the answer, so a known address does not take longer to answer than an unknown one.
      ...(background !== undefined ? { backgroundTasks: { handler: background } } : {}),
    },
    emailAndPassword: {
      enabled: true,
      /**
       * Forgotten password, by email. The account's sources and profiles are sealed under a key made from the password
       * (packages/core/src/sync/credentialCrypto.ts), so a new password cannot open them: they are cleared here, and every
       * device is signed out. Each device then signs in again with the new password, which zeroes its sync cursors
       * (`SyncController.forgetSession`), so whatever it still holds is sealed afresh and uploaded. Favourites, recents and
       * progress are not sealed and stay. The deletes and the sign-outs are one batch, so a failure leaves nothing half done.
       */
      resetPasswordTokenExpiresIn: RESET_TOKEN_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // Never answers differently for an unknown address (better-auth only calls this for a real one), and sends nothing
        // when no mail binding exists. The link holds the token: it is not logged.
        await sendMail?.({ from: { email: "noreply@evicted.dev", name: "Testcard" }, to: user.email, subject: RESET_SUBJECT, text: resetText(url), html: resetHtml(url) }).catch(() => undefined);
      },
      onPasswordReset: async ({ user }) => {
        await db.batch([
          db.prepare(`DELETE FROM sources WHERE user_id = ?`).bind(user.id),
          db.prepare(`DELETE FROM profiles WHERE user_id = ?`).bind(user.id),
          db.prepare(`DELETE FROM session WHERE "userId" = ?`).bind(user.id),
        ]);
      },
    },
    /**
     * Brute-force protection for sign-in and sign-up. better-auth only switches its limiter on when NODE_ENV is
     * "production", which a Worker never sets, so it is enabled here explicitly. Counters live in D1 (migration 0007).
     */
    rateLimit: {
      enabled: true,
      storage: "database",
      // Each request mails someone, and each reset is a guess at a token: keep both slow.
      customRules: { "/request-password-reset": { window: 60 * 60, max: 5 }, "/reset-password": { window: 10 * 60, max: 10 } },
    },
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
