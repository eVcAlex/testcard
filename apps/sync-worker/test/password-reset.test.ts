import { describe, expect, it } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import app from "../src/index.js";

const ORIGIN = "https://sync.test";
const OLD = "old-password-correct-horse";
const NEW = "new-password-battery-staple";
const testEnv = env as unknown as { DB: D1Database; SYNC_AUTH_SECRET: string };

type Mail = { to: string; subject: string; text: string; html: string };

/** A Worker environment whose mail binding keeps what it is asked to send. */
function withMail() {
  const sent: Mail[] = [];
  return { sent, env: { ...testEnv, EMAIL: { send: async (message: Mail) => void sent.push(message) } } };
}

async function call(path: string, init: RequestInit = {}, workerEnv: object = testEnv, ip = "198.51.100.9"): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(init.headers as Record<string, string> | undefined) } }), workerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

const post = (path: string, body: unknown, workerEnv: object = testEnv, headers: Record<string, string> = {}, ip?: string) =>
  call(path, { method: "POST", body: JSON.stringify(body), headers }, workerEnv, ip);

async function signUp(email: string): Promise<{ token: string; userId: string }> {
  const res = await post("/auth/sign-up/email", { email, password: OLD, name: "Test" });
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

/** Asks for a reset and returns the token from the emailed link, the way the person's browser would deliver it. */
async function requestReset(email: string, mail: ReturnType<typeof withMail>, ip?: string): Promise<string | undefined> {
  await post("/auth/request-password-reset", { email, redirectTo: `${ORIGIN}/reset` }, mail.env, {}, ip);
  const message = mail.sent.find((m) => m.to === email);
  if (message === undefined) return undefined;
  const link = /https:\/\/sync\.test\/auth\/reset-password\/[^\s"<]+/.exec(message.text)![0];
  const redirect = await call(link.replace(ORIGIN, ""), { method: "GET" });
  expect(redirect.status).toBe(302);
  return new URL(redirect.headers.get("location")!).searchParams.get("token") ?? undefined;
}

const sealedSource = (remoteKey: string, updatedAt: number) => ({ remoteKey, label: "Mine", credentialsBlob: "Y2lwaGVydGV4dA==", credentialsIv: "AAAAAAAAAAAAAAAA", updatedAt, deletedAt: null });
const emptyPush = { sources: [], movieFavourites: [], movieRecents: [], seriesFavourites: [], seriesRecents: [], progress: [], profiles: [], channelFavourites: [], channelRecents: [] };

describe("forgotten password, by email", () => {
  it("emails a reset link from noreply, and the mail carries no password", async () => {
    await signUp("forgot@testcard.test");
    const mail = withMail();
    expect(await requestReset("forgot@testcard.test", mail)).toBeTruthy();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.subject).toBe("Reset your Testcard password");
    expect(mail.sent[0]!.text).not.toContain(OLD);
  });

  it("answers an unknown address like a known one and sends nothing", async () => {
    await signUp("known@testcard.test");
    const mail = withMail();
    const known = await post("/auth/request-password-reset", { email: "known@testcard.test", redirectTo: `${ORIGIN}/reset` }, mail.env, {}, "198.51.100.21");
    const unknown = await post("/auth/request-password-reset", { email: "nobody-here@testcard.test", redirectTo: `${ORIGIN}/reset` }, mail.env, {}, "198.51.100.22");
    expect(unknown.status).toBe(known.status);
    expect(mail.sent.map((m) => m.to)).toEqual(["known@testcard.test"]);
  });

  it("refuses to send the person on to another site", async () => {
    await signUp("redirect@testcard.test");
    const mail = withMail();
    const res = await post("/auth/request-password-reset", { email: "redirect@testcard.test", redirectTo: "https://evil.example/steal" }, mail.env);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mail.sent).toHaveLength(0);
  });

  it("changes the password, signs every device out and clears what the old password sealed", async () => {
    const { token, userId } = await signUp("reset-all@testcard.test");
    await call("/sync/salt", { method: "POST", body: JSON.stringify({ salt: "c2FsdA==" }), headers: { authorization: `Bearer ${token}` } });
    await call("/sync/push", { method: "POST", body: JSON.stringify({ ...emptyPush, sources: [sealedSource("k1", 100)], movieFavourites: [{ remoteKey: "m1", addedAt: 5, updatedAt: 100, deletedAt: null }] }), headers: { authorization: `Bearer ${token}` } });
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM sources WHERE user_id = ?`).bind(userId).first<{ n: number }>())?.n).toBe(1);

    const mail = withMail();
    const resetToken = await requestReset("reset-all@testcard.test", mail);
    const done = await post("/auth/reset-password", { newPassword: NEW, token: resetToken });
    expect(done.status).toBe(200);

    // Sealed rows gone; unsealed history and the salt kept.
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM sources WHERE user_id = ?`).bind(userId).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM movie_favourites WHERE user_id = ?`).bind(userId).first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare(`SELECT salt FROM sync_salts WHERE user_id = ?`).bind(userId).first<{ salt: string }>())?.salt).toBe("c2FsdA==");

    // The old session is dead; the old password no longer signs in; the new one does.
    expect((await call("/sync/pull?since=0", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await post("/auth/sign-in/email", { email: "reset-all@testcard.test", password: OLD })).status).not.toBe(200);
    expect((await post("/auth/sign-in/email", { email: "reset-all@testcard.test", password: NEW })).status).toBe(200);
  });

  it("works once only", async () => {
    await signUp("once@testcard.test");
    const mail = withMail();
    const resetToken = await requestReset("once@testcard.test", mail);
    expect((await post("/auth/reset-password", { newPassword: NEW, token: resetToken })).status).toBe(200);
    expect((await post("/auth/reset-password", { newPassword: "another-password-123", token: resetToken })).status).not.toBe(200);
  });

  it("rejects a made-up token without touching anything", async () => {
    const { userId } = await signUp("badtoken@testcard.test");
    expect((await post("/auth/reset-password", { newPassword: NEW, token: "not-a-token" })).status).not.toBe(200);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM session WHERE "userId" = ?`).bind(userId).first<{ n: number }>())?.n).toBeGreaterThan(0);
  });

  it("slows down repeated requests for a reset email", async () => {
    await signUp("spam@testcard.test");
    const mail = withMail();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await post("/auth/request-password-reset", { email: "spam@testcard.test", redirectTo: `${ORIGIN}/reset` }, mail.env, {}, "198.51.100.99")).status);
    expect(statuses).toContain(429);
    expect(mail.sent.length).toBeLessThanOrEqual(5);
  });

  it("does not offer changing the password while signed in, which would strand the synced sources", async () => {
    const { token } = await signUp("changer@testcard.test");
    const res = await post("/auth/change-password", { currentPassword: OLD, newPassword: NEW }, testEnv, { authorization: `Bearer ${token}` });
    expect(res.status).toBe(404);
    expect((await post("/auth/sign-in/email", { email: "changer@testcard.test", password: OLD })).status).toBe(200);
  });
});
