import { describe, expect, it } from "vitest";
import { LINK_ALPHABET, LINK_ITERATIONS, LINK_LOOKUP_SALT, deriveLinkLookup, formatLinkCode, generateLinkCode, generateLinkSalt, isValidLinkCode, normaliseLinkCode, openLinkSecrets, sealLinkSecrets } from "../sync/linkCrypto.js";

describe("link codes", () => {
  it("makes 8 characters from the alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateLinkCode();
      expect(isValidLinkCode(code)).toBe(true);
      expect([...code].every((char) => LINK_ALPHABET.includes(char))).toBe(true);
    }
  });

  it("leaves out characters that look alike", () => {
    expect(LINK_ALPHABET).not.toMatch(/[01OI]/);
    expect(LINK_ALPHABET.length).toBe(32);
  });

  it("cleans what was typed and shows it with a dash", () => {
    expect(normaliseLinkCode("k7m4 - qx2p")).toBe("K7M4QX2P");
    expect(formatLinkCode("K7M4QX2P")).toBe("K7M4-QX2P");
    expect(isValidLinkCode("K7M4QX2")).toBe(false);
    expect(isValidLinkCode("K7M4QX20")).toBe(false);
  });
});

describe("sealing a sign-in under a code", () => {
  it("opens with the same code and salt", async () => {
    const salt = generateLinkSalt();
    const sealed = await sealLinkSecrets({ email: "a@b.co", password: "correct horse" }, "K7M4QX2P", salt);
    expect(await openLinkSecrets(sealed, "K7M4QX2P", salt)).toEqual({ email: "a@b.co", password: "correct horse" });
  });

  it("does not open with another code, another salt, or an altered blob", async () => {
    const salt = generateLinkSalt();
    const sealed = await sealLinkSecrets({ email: "a@b.co", password: "pw" }, "K7M4QX2P", salt);
    await expect(openLinkSecrets(sealed, "K7M4QX2Q", salt)).rejects.toThrow();
    await expect(openLinkSecrets(sealed, "K7M4QX2P", generateLinkSalt())).rejects.toThrow();
    await expect(openLinkSecrets({ ...sealed, blob: sealed.blob.slice(0, -4) + "AAAA" }, "K7M4QX2P", salt)).rejects.toThrow();
  });

  it("keeps the password out of the sealed blob", async () => {
    const sealed = await sealLinkSecrets({ email: "a@b.co", password: "correct horse" }, "K7M4QX2P", generateLinkSalt());
    expect(atob(sealed.blob)).not.toContain("correct horse");
  });
});

describe("lookup", () => {
  it("is the same for the same code and different for another", async () => {
    expect(await deriveLinkLookup("K7M4QX2P")).toBe(await deriveLinkLookup("K7M4QX2P"));
    expect(await deriveLinkLookup("K7M4QX2P")).not.toBe(await deriveLinkLookup("K7M4QX2Q"));
  });

  it("does not reveal the code", async () => {
    expect(await deriveLinkLookup("K7M4QX2P")).not.toContain("K7M4QX2P");
  });

  it("holds the contract the web page repeats", () => {
    expect(LINK_LOOKUP_SALT).toBe("testcard-link-lookup-v1");
    expect(LINK_ITERATIONS).toBe(210_000);
  });
});
