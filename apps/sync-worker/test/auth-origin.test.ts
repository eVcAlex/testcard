import { describe, expect, it } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import app from "../src/index.js";

/**
 * `wrangler dev --remote` runs the Worker on a Cloudflare preview address while the browser's page is on localhost, so the
 * page's Origin differs from the address the Worker sees. Sign-in is refused (INVALID_ORIGIN) unless that origin is allowed
 * by `AUTH_TRUSTED_ORIGINS`.
 */
const WORKER = "https://preview.example.workers.dev";
const PAGE = "http://localhost:8787";
const base = env as unknown as { DB: D1Database; SYNC_AUTH_SECRET: string };

const signUp = (bindings: Record<string, string>, origin = PAGE) =>
  app.fetch(
    new Request(`${WORKER}/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: `origin-${crypto.randomUUID()}@example.com`, password: "correct-horse-battery-staple", name: "o" }),
    }),
    { ...base, ...bindings } as never,
    createExecutionContext(),
  );

describe("which page origins may sign in", () => {
  it("refuses a page on another origin by default", async () => {
    const response = await signUp({});
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).toBe("INVALID_ORIGIN");
  });

  it("accepts one listed in AUTH_TRUSTED_ORIGINS, and still refuses others", async () => {
    expect((await signUp({ AUTH_TRUSTED_ORIGINS: PAGE })).status).toBe(200);
    expect((await signUp({ AUTH_TRUSTED_ORIGINS: PAGE }, "https://evil.example")).status).toBe(403);
  });

  it("accepts the Worker's own origin with nothing set", async () => {
    expect((await signUp({}, WORKER)).status).toBe(200);
  });
});
