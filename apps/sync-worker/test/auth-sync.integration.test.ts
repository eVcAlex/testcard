import { describe, expect, it } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
// Deep import rather than the `@testcard/core` barrel on purpose: the barrel re-exports the
// better-sqlite3-backed local DB modules, which cannot load inside the Workers runtime.
import { encryptCredentials, decryptCredentials, generateSalt } from "@testcard/core/src/sync/credentialCrypto.js";
import app from "../src/index.js";
import { createAuth } from "../src/auth.js";

/**
 * The one test that drives the *real* `src/index.ts` app end-to-end — no stub session middleware,
 * no hand-rolled Hono instance. The other tests in this directory mount the route handlers behind a
 * middleware that hardcodes a `userId`, which is useful for exercising the SQL but means the auth
 * seam (better-auth's `basePath`, the `bearer()` plugin, the configured `secret`) is never touched.
 * Everything below goes through `Authorization: Bearer <token>` against a session minted by a real
 * `/auth/sign-up/email` call, so a regression in any of those three shows up here as a 401 or 404.
 */

const ORIGIN = "https://sync.test";
const PASSWORD = "correct-horse-battery-staple";

/** `env` is typed from wrangler.toml's bindings; the test worker gets the same `[vars]` values. */
const testEnv = env as unknown as { DB: D1Database; SYNC_AUTH_SECRET: string };

/** `app.fetch` (not `app.request`) so the real Worker entrypoint handles a real absolute-URL Request. */
function request(path: string, init?: RequestInit): Promise<Response> {
  return app.fetch(new Request(`${ORIGIN}${path}`, init), testEnv, createExecutionContext());
}

function authed(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return request(path, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` },
  });
}

function json(path: string, token: string, body: unknown, method = "POST"): Promise<Response> {
  return authed(path, token, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const emptyPush = {
  sources: [],
  movieFavourites: [],
  movieRecents: [],
  seriesFavourites: [],
  seriesRecents: [],
  progress: [],
};

async function signUp(email: string): Promise<string> {
  const res = await request("/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, name: "Test Device" }),
  });
  expect(res.status, `sign-up failed: ${await res.clone().text()}`).toBe(200);
  const body = (await res.json()) as { token?: string; user?: { id: string } };
  expect(body.token, "sign-up response carried no session token").toBeTruthy();
  return body.token as string;
}

describe("real Worker app: auth -> salt -> encrypted push -> pull -> decrypt", () => {
  it("rejects /sync/* with no bearer token", async () => {
    const res = await request("/sync/pull?since=0");
    expect(res.status).toBe(401);
  });

  it("rejects /sync/* with a bogus bearer token", async () => {
    const res = await authed("/sync/pull?since=0", "not-a-real-session-token");
    expect(res.status).toBe(401);
  });

  it("threads the SYNC_AUTH_SECRET binding through to a working session lookup", async () => {
    // The binding must actually reach the Worker — an undefined secret would silently fall back to
    // better-auth's env-var lookup, which does not exist on Workers, and getSession would throw
    // rather than resolve.
    //
    // Note: for the default `bearer()` config (raw, undotted tokens, `requireSignature: false`),
    // better-auth re-signs the incoming token with *this instance's own* secret and verifies that
    // signature against itself — a tautology that passes for any non-empty secret. So this does not
    // prove a differently-configured secret would reject the token; what actually gates a bearer
    // token is the session row it resolves to in D1 (see "rejects ... with a bogus bearer token"
    // above, and the round-trip test below). It only proves the binding reaches `createAuth`.
    expect(testEnv.SYNC_AUTH_SECRET).toBeTruthy();

    const token = await signUp("secret-bound@testcard.test");
    const headers = new Headers({ authorization: `Bearer ${token}` });
    expect(await createAuth(testEnv.DB, testEnv.SYNC_AUTH_SECRET, ORIGIN).api.getSession({ headers })).not.toBeNull();
  });

  it("runs the whole credential round-trip through the real app", async () => {
    // 1. Sign up -> session token. Proves /auth/* is mounted where better-auth actually routes (C2).
    const token = await signUp("round-trip@testcard.test");

    // Every /sync/* call below relies on bearer(): the token is sent as an Authorization header and
    // there is no cookie jar in this test at all (C3), signed with wrangler.toml's secret (C4).
    // 2. Set the account's PBKDF2 salt.
    const salt = generateSalt();
    const setRes = await json("/sync/salt", token, { salt });
    expect(setRes.status, `set salt failed: ${await setRes.clone().text()}`).toBe(200);

    // 3. Read it back.
    const getRes = await authed("/sync/salt", token);
    expect(getRes.status).toBe(200);
    expect(((await getRes.json()) as { salt: string }).salt).toBe(salt);

    // 4. Set-once: a second, different salt must be refused rather than stranding other devices.
    const conflictRes = await json("/sync/salt", token, { salt: generateSalt() });
    expect(conflictRes.status).toBe(409);

    // 5. Encrypt a credentials payload client-side with that salt + the account password.
    const plaintext = { host: "http://provider.example:8080", username: "device-user", password: "device-pass" };
    const encrypted = await encryptCredentials(plaintext, PASSWORD, salt);

    // 6. Push the ciphertext.
    const source = {
      remoteKey: "xtream:provider.example:device-user",
      label: "Provider",
      credentialsBlob: encrypted.blob,
      credentialsIv: encrypted.iv,
      updatedAt: 1_700_000_000_000,
      deletedAt: null,
    };
    const pushRes = await json("/sync/push", token, { ...emptyPush, sources: [source] });
    expect(pushRes.status, `push failed: ${await pushRes.clone().text()}`).toBe(200);
    expect((await pushRes.json()).newCursor).toBe(source.updatedAt);

    // 7. Pull it back.
    const pullRes = await authed("/sync/pull?since=0", token);
    expect(pullRes.status).toBe(200);
    const pulled = await pullRes.json();
    expect(pulled.sources).toHaveLength(1);
    expect(pulled.sources[0].credentialsBlob).toBe(encrypted.blob);
    expect(pulled.sources[0].credentialsIv).toBe(encrypted.iv);
    expect(pulled.serverCursor).toBe(source.updatedAt);

    // 8. Decrypt what came back — the full chain, not just byte equality.
    const decrypted = await decryptCredentials(
      { blob: pulled.sources[0].credentialsBlob, iv: pulled.sources[0].credentialsIv },
      PASSWORD,
      salt,
    );
    expect(decrypted).toEqual(plaintext);
  });

  it("scopes rows to the signed-in account", async () => {
    const tokenA = await signUp("scoping-a@testcard.test");
    const tokenB = await signUp("scoping-b@testcard.test");

    const res = await json("/sync/push", tokenA, {
      ...emptyPush,
      movieFavourites: [{ remoteKey: "movie-scoped", addedAt: 500, updatedAt: 500, deletedAt: null }],
    });
    expect(res.status).toBe(200);

    const pulledB = await (await authed("/sync/pull?since=0", tokenB)).json();
    expect(pulledB.movieFavourites).toHaveLength(0);

    const pulledA = await (await authed("/sync/pull?since=0", tokenA)).json();
    expect(pulledA.movieFavourites).toHaveLength(1);
  });

  it("accepts a source tombstone carrying no credentials, and round-trips it as nulls", async () => {
    const token = await signUp("tombstone@testcard.test");
    const remoteKey = "xtream:gone.example:user";

    const tombstone = {
      remoteKey,
      label: null,
      credentialsBlob: null,
      credentialsIv: null,
      updatedAt: 1_700_000_100_000,
      deletedAt: 1_700_000_100_000,
    };
    const pushRes = await json("/sync/push", token, { ...emptyPush, sources: [tombstone] });
    expect(pushRes.status, `tombstone push failed: ${await pushRes.clone().text()}`).toBe(200);

    const pulled = await (await authed("/sync/pull?since=0", token)).json();
    const row = pulled.sources.find((s: { remoteKey: string }) => s.remoteKey === remoteKey);
    expect(row).toBeDefined();
    expect(row.label).toBeNull();
    expect(row.credentialsBlob).toBeNull();
    expect(row.credentialsIv).toBeNull();
    expect(row.deletedAt).toBe(tombstone.deletedAt);
  });

  it("answers 400, not 500, on a malformed push body and a malformed `since`", async () => {
    const token = await signUp("malformed@testcard.test");

    // Schema mismatch: permanent, so it must not look retryable to the sync loop.
    const badSchema = await json("/sync/push", token, { ...emptyPush, movieFavourites: [{ remoteKey: 42 }] });
    expect(badSchema.status).toBe(400);
    expect((await badSchema.json()).error).toBe("invalid request");

    const badJson = await authed("/sync/push", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect(badJson.status).toBe(400);

    const badSalt = await json("/sync/salt", token, { salt: "" });
    expect(badSalt.status).toBe(400);

    // NaN `since` would otherwise silently return zero rows with a 200.
    const badSince = await authed("/sync/pull?since=not-a-number", token);
    expect(badSince.status).toBe(400);
  });
});
