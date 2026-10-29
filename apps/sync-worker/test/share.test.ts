import { describe, expect, it } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { buildSetupPayload, parseSetupLinkText, setupLinkUrl, summariseSetup } from "../../../packages/core/src/sync/setupLink.js";
import { generateSetupLink, sealSetupProfile, setupProof, openSetupProfile } from "../../../packages/core/src/sync/setupCrypto.js";
import { handleShareClaim, handleShareCreate, handleShareList, handleShareRevoke, MAX_CLAIMS_PER_NETWORK_PER_DAY } from "../src/routes/setup.js";
import type { Env } from "../src/index.js";

function appAs(userId: string) {
  const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    await next();
  });
  app.post("/share/claim", handleShareClaim);
  app.post("/share", handleShareCreate);
  app.get("/share", handleShareList);
  app.delete("/share/:id", handleShareRevoke);
  return app;
}

const payload = { v: 1 as const, name: "Mum's TV", source: { host: "http://tv.example.com", username: "alice", password: "hunter2-secret" } };
const send = (app: ReturnType<typeof appAs>, method: string, path: string, body?: unknown, ip = "198.51.100.1") =>
  app.request(path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env, createExecutionContext());

async function share(app: ReturnType<typeof appAs>, extra: Record<string, unknown> = {}) {
  const link = generateSetupLink();
  const { proof, claimHash } = await setupProof(link.secret);
  const sealed = await sealSetupProfile(payload, link);
  const response = await send(app, "POST", "/share", { id: link.id, claimHash, label: "Mum's TV", ...sealed, ...extra });
  return { link, proof, response };
}

describe("sharing a source by link", () => {
  it("works end to end the way the apps use it: build, seal, send the link text, parse it, claim, open", async () => {
    const shared = buildSetupPayload({
      name: "Dad's playlist",
      epgOptimise: true,
      source: { kind: "m3u", playlistUrl: "http://p.example.com/get.php?username=dad&password=letmein" },
    });
    const link = generateSetupLink();
    const { claimHash, proof: senderProof } = await setupProof(link.secret);
    const created = await send(appAs("sender"), "POST", "/share", { id: link.id, claimHash, label: shared.name, ...(await sealSetupProfile(shared, link)) });
    expect(created.status).toBe(200);

    // The receiver has only the text of the link.
    const received = parseSetupLinkText(setupLinkUrl(link))!;
    const { proof } = await setupProof(received.secret);
    expect(proof).toBe(senderProof);
    const claim = await send(appAs("nobody"), "POST", "/share/claim", { id: received.id, proof });
    const opened = await openSetupProfile((await claim.json()) as { blob: string; iv: string }, received);
    expect(opened).toEqual(shared);
    expect(summariseSetup(opened)).toEqual({ name: "Dad's playlist", kind: "m3u", host: "p.example.com", epgOptimise: true });
  });

  it("lets a device claim the sealed source and open it with the link", async () => {
    const owner = appAs("sender");
    const { link, proof, response } = await share(owner);
    expect(response.status).toBe(200);
    const claim = await send(appAs("nobody"), "POST", "/share/claim", { id: link.id, proof });
    expect(claim.status).toBe(200);
    expect(await openSetupProfile((await claim.json()) as { blob: string; iv: string }, link)).toEqual(payload);
  });

  it("stores nothing the server could open the source with", async () => {
    const { link } = await share(appAs("sender"));
    const row = await env.DB.prepare(`SELECT * FROM setup_profiles WHERE id = ?`).bind(link.id).first();
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("hunter2-secret");
    expect(stored).not.toContain(link.secret);
    expect(stored).not.toContain("alice");
  });

  it("hands nothing to someone who only knows the id, or has the wrong proof", async () => {
    const { link } = await share(appAs("sender"));
    const other = await setupProof(generateSetupLink().secret);
    expect((await send(appAs("x"), "POST", "/share/claim", { id: link.id, proof: other.proof })).status).toBe(404);
    expect((await send(appAs("x"), "POST", "/share/claim", { id: link.id })).status).toBe(400);
    const row = await env.DB.prepare(`SELECT claims FROM setup_profiles WHERE id = ?`).bind(link.id).first<{ claims: number }>();
    expect(row?.claims).toBe(0);
  });

  it("answers an unknown id exactly as it answers a wrong proof", async () => {
    const real = await share(appAs("sender"));
    const wrong = await send(appAs("x"), "POST", "/share/claim", { id: real.link.id, proof: (await setupProof(generateSetupLink().secret)).proof });
    const unknown = await send(appAs("x"), "POST", "/share/claim", { id: generateSetupLink().id, proof: real.proof });
    expect(wrong.status).toBe(unknown.status);
    expect(await wrong.text()).toBe(await unknown.text());
  });

  it("is single use by default, even when two devices race for it", async () => {
    const { link, proof } = await share(appAs("sender"));
    const results = await Promise.all([1, 2, 3].map(() => send(appAs("x"), "POST", "/share/claim", { id: link.id, proof })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await send(appAs("x"), "POST", "/share/claim", { id: link.id, proof })).status).toBe(404);
  });

  it("allows as many claims as the sender chose, and no more", async () => {
    const { link, proof } = await share(appAs("sender"), { maxClaims: 2 });
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await send(appAs("x"), "POST", "/share/claim", { id: link.id, proof })).status);
    expect(statuses).toEqual([200, 200, 404]);
  });

  it("stops working when it expires", async () => {
    const { link, proof } = await share(appAs("sender"));
    await env.DB.prepare(`UPDATE setup_profiles SET expires_at = ? WHERE id = ?`).bind(Date.now() - 1, link.id).run();
    expect((await send(appAs("x"), "POST", "/share/claim", { id: link.id, proof })).status).toBe(404);
  });

  it("can be revoked by its sender, which discards the sealed source, and by nobody else", async () => {
    const { link, proof } = await share(appAs("sender"));
    expect((await send(appAs("stranger"), "DELETE", `/share/${link.id}`)).status).toBe(404);
    expect((await send(appAs("sender"), "DELETE", `/share/${link.id}`)).status).toBe(200);
    expect((await send(appAs("x"), "POST", "/share/claim", { id: link.id, proof })).status).toBe(404);
    const row = await env.DB.prepare(`SELECT blob, iv FROM setup_profiles WHERE id = ?`).bind(link.id).first();
    expect(row).toEqual({ blob: "", iv: "" });
  });

  it("revokes a link that was already claimed", async () => {
    const { link, proof } = await share(appAs("sender"), { maxClaims: 3 });
    await send(appAs("x"), "POST", "/share/claim", { id: link.id, proof });
    await send(appAs("sender"), "DELETE", `/share/${link.id}`);
    expect((await send(appAs("x"), "POST", "/share/claim", { id: link.id, proof })).status).toBe(404);
  });

  it("lists only the sender's own links, without the sealed source", async () => {
    const mine = await share(appAs("lister"));
    await share(appAs("someone-else"));
    const list = (await (await send(appAs("lister"), "GET", "/share")).json()) as { profiles: Record<string, unknown>[] };
    expect(list.profiles.map((p) => p["id"])).toEqual([mine.link.id]);
    expect(JSON.stringify(list)).not.toContain("blob");
    expect(list.profiles[0]).toMatchObject({ label: "Mum's TV", claims: 0, maxClaims: 1, revokedAt: null });
  });

  it("does not let an id be registered twice, or take a malformed or oversized request", async () => {
    const first = await share(appAs("sender"));
    const sealed = await sealSetupProfile(payload, first.link);
    expect((await send(appAs("sender"), "POST", "/share", { id: first.link.id, claimHash: (await setupProof(first.link.secret)).claimHash, label: "again", ...sealed })).status).toBe(409);
    expect((await share(appAs("sender"), { maxClaims: 99 })).response.status).toBe(400);
    expect((await share(appAs("sender"), { expiresInDays: 365 })).response.status).toBe(400);
    expect((await share(appAs("sender"), { blob: "A".repeat(9000) })).response.status).toBe(400);
  });

  it("caps how many live links one account holds", async () => {
    const app = appAs("capped");
    for (let i = 0; i < 25; i++) expect((await share(app)).response.status).toBe(200);
    expect((await share(app)).response.status).toBe(429);
    const listed = (await (await send(app, "GET", "/share")).json()) as { profiles: { id: string }[] };
    await send(app, "DELETE", `/share/${listed.profiles[0]!.id}`);
    expect((await share(app)).response.status).toBe(200);
  });

  it("limits how often one network can try claims", async () => {
    const { link, proof } = await share(appAs("sender"), { maxClaims: 1 });
    let last = 0;
    for (let i = 0; i <= MAX_CLAIMS_PER_NETWORK_PER_DAY; i++) last = (await send(appAs("x"), "POST", "/share/claim", { id: link.id, proof }, "203.0.113.77")).status;
    expect(last).toBe(429);
  });
});
