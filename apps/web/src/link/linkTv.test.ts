import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.ts", () => ({
  linkSession: vi.fn(), linkApprove: vi.fn(), signIn: vi.fn(), signUp: vi.fn(),
  errorStatus: (e: { status?: number }) => e?.status,
  errorMessage: (e: { message?: string }) => e?.message,
}));
vi.mock("@testcard/core/src/sync/linkCrypto.ts", () => ({
  normaliseLinkCode: (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, ""),
  isValidLinkCode: (c: string) => c.length === 8,
  deriveLinkLookup: async () => "lookup",
  sealLinkSecrets: async () => ({ blob: "blob", iv: "iv" }),
}));

import * as api from "../api.ts";
import { LinkError, linkTv } from "./linkTv.ts";

const good = { code: "K7M4-QX2P", email: "a@b.co", password: "hunter22", confirm: "hunter22", mode: "signin" as const };
const m = (f: unknown) => f as ReturnType<typeof vi.fn>;
const httpError = (status: number, message?: string) => Object.assign(new Error(message ?? "http"), { status });

beforeEach(() => {
  vi.resetAllMocks();
  m(api.linkSession).mockResolvedValue({ salt: "salt" });
  m(api.signIn).mockResolvedValue({});
  m(api.signUp).mockResolvedValue({});
  m(api.linkApprove).mockResolvedValue({});
});

describe("linkTv", () => {
  it("signs in, seals and approves", async () => {
    await linkTv(good);
    expect(api.signIn).toHaveBeenCalledWith("a@b.co", "hunter22");
    expect(api.linkApprove).toHaveBeenCalledWith({ lookup: "lookup", blob: "blob", iv: "iv" });
  });

  it("rejects a malformed code before any request", async () => {
    await expect(linkTv({ ...good, code: "NOPE" })).rejects.toMatchObject({ field: "code" });
    expect(api.linkSession).not.toHaveBeenCalled();
  });

  it("checks the code before creating an account, so an expired code leaves nothing behind", async () => {
    m(api.linkSession).mockRejectedValue(httpError(404));
    await expect(linkTv({ ...good, mode: "signup" })).rejects.toMatchObject({ field: "code" });
    expect(api.signUp).not.toHaveBeenCalled();
  });

  it("wrong password on sign-in points at the password", async () => {
    m(api.signIn).mockRejectedValue(httpError(401));
    await expect(linkTv(good)).rejects.toMatchObject({ field: "password", switchToSignin: false });
  });

  it("sign-up with an existing email switches to sign-in", async () => {
    m(api.signUp).mockRejectedValue(httpError(422));
    await expect(linkTv({ ...good, mode: "signup" })).rejects.toMatchObject({ switchToSignin: true });
  });

  it("sign-up needs 8 characters and a matching confirmation", async () => {
    await expect(linkTv({ ...good, mode: "signup", password: "short", confirm: "short" })).rejects.toMatchObject({ field: "password" });
    await expect(linkTv({ ...good, mode: "signup", confirm: "different" })).rejects.toMatchObject({ field: "confirm" });
  });

  it("if the code expires after the account was made, says so and switches to sign-in", async () => {
    m(api.linkApprove).mockRejectedValue(httpError(404));
    await expect(linkTv({ ...good, mode: "signup" })).rejects.toMatchObject({ accountCreated: true, switchToSignin: true });
  });

  it("a network failure is a LinkError with no field", async () => {
    m(api.linkSession).mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await linkTv(good).catch((e) => e);
    expect(error).toBeInstanceOf(LinkError);
    expect(error.field).toBeUndefined();
    expect(error.message).toMatch(/could not reach testcard/i);
  });
});
