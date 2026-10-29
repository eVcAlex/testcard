import { describe, expect, it } from "vitest";
import type { SetupProfilePayload } from "@testcard/sync-schema";
import { formatSetupFragment, generateSetupLink, openSetupProfile, parseSetupFragment, sealSetupProfile, setupProof } from "../sync/setupCrypto.js";

const payload: SetupProfilePayload = {
  v: 1,
  name: "Living room",
  source: { host: "http://tv.example.com:8080", username: "alice", password: "s3cret-pass" },
};

describe("setup link crypto", () => {
  it("seals a source and opens it with the same link", async () => {
    const link = generateSetupLink();
    const sealed = await sealSetupProfile(payload, link);
    expect(await openSetupProfile(sealed, link)).toEqual(payload);
  });

  it("does not put the password or host in what is sealed or in the link", async () => {
    const link = generateSetupLink();
    const sealed = await sealSetupProfile(payload, link);
    const visible = JSON.stringify(sealed) + formatSetupFragment(link);
    expect(visible).not.toContain("s3cret-pass");
    expect(visible).not.toContain("alice");
    expect(visible).not.toContain("tv.example.com");
  });

  it("cannot be opened with another link's secret, or moved to another id", async () => {
    const link = generateSetupLink();
    const sealed = await sealSetupProfile(payload, link);
    await expect(openSetupProfile(sealed, { ...link, secret: generateSetupLink().secret })).rejects.toThrow();
    await expect(openSetupProfile(sealed, { ...link, id: generateSetupLink().id })).rejects.toThrow();
  });

  it("refuses to seal anything but a plain source", async () => {
    const link = generateSetupLink();
    await expect(sealSetupProfile({ ...payload, source: { ...payload.source, pins: [] } } as never, link)).rejects.toThrow();
    await expect(sealSetupProfile({ ...payload, source: { playlistUrl: "file:///etc/passwd" } } as never, link)).rejects.toThrow();
    await expect(sealSetupProfile({ ...payload, source: { playlistUrl: "javascript:alert(1)" } } as never, link)).rejects.toThrow();
  });

  it("gives the same proof for the same secret, and none that reveals the secret", async () => {
    const link = generateSetupLink();
    const first = await setupProof(link.secret);
    expect(await setupProof(link.secret)).toEqual(first);
    expect(first.proof).not.toContain(link.secret);
    expect(first.claimHash).not.toBe(first.proof);
    expect((await setupProof(generateSetupLink().secret)).proof).not.toBe(first.proof);
  });

  it("round-trips the fragment and rejects anything else", () => {
    const link = generateSetupLink();
    expect(parseSetupFragment(`#${formatSetupFragment(link)}`)).toEqual(link);
    expect(parseSetupFragment("#nonsense")).toBeNull();
    expect(parseSetupFragment("")).toBeNull();
  });
});
