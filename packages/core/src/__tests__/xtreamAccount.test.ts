import { describe, expect, it } from "vitest";
import { fetchXtreamAccount } from "../source/xtream/detect.js";

const answering = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
const login = { baseUrl: "http://p", username: "u", password: "p" };

describe("fetchXtreamAccount", () => {
  it("reads when the account ends and its streams, as providers send them (strings)", async () => {
    const account = await fetchXtreamAccount(login, answering({ user_info: { exp_date: "1893456000", max_connections: "2", active_cons: "1", status: "Active", is_trial: "0" } }));
    expect(account).toEqual({ expiresAt: 1893456000000, maxConnections: 2, activeConnections: 1, status: "Active", trial: false });
  });

  it("takes a missing expiry as none, and no user_info as nothing to say", async () => {
    expect((await fetchXtreamAccount(login, answering({ user_info: { exp_date: null, max_connections: 1 } })))?.expiresAt).toBeNull();
    expect(await fetchXtreamAccount(login, answering({}))).toBeNull();
  });
});
