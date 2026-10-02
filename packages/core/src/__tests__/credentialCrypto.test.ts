import { describe, expect, it, vi } from "vitest";
import { decryptCredentials, encryptCredentials, generateSalt } from "../sync/credentialCrypto.js";

describe("credentialCrypto", () => {
  it("round-trips a credentials payload through encrypt/decrypt", async () => {
    const salt = generateSalt();
    const payload = { host: "http://example.com", username: "alex", password: "hunter2" };
    const encrypted = await encryptCredentials(payload, "correct horse battery staple", salt);
    const decrypted = await decryptCredentials(encrypted, "correct horse battery staple", salt);
    expect(decrypted).toEqual(payload);
  });

  it("produces a different ciphertext each time (random IV)", async () => {
    const salt = generateSalt();
    const payload = { host: "http://example.com", username: "alex", password: "hunter2" };
    const first = await encryptCredentials(payload, "pw", salt);
    const second = await encryptCredentials(payload, "pw", salt);
    expect(first.blob).not.toBe(second.blob);
  });

  it("fails to decrypt with the wrong password", async () => {
    const salt = generateSalt();
    const encrypted = await encryptCredentials({ host: "http://example.com", username: "alex", password: "hunter2" }, "right-password", salt);
    await expect(decryptCredentials(encrypted, "wrong-password", salt)).rejects.toThrow();
  });
});

describe("credentialCrypto key cache", () => {
  it("derives the key once for the same password and salt, and again when either changes", async () => {
    const derive = vi.spyOn(crypto.subtle, "deriveKey");
    const salt = generateSalt();
    const payload = { host: "http://example.com", username: "alex", password: "hunter2" };
    await encryptCredentials(payload, "cache-pw", salt);
    await encryptCredentials(payload, "cache-pw", salt);
    const sealed = await encryptCredentials(payload, "cache-pw", salt);
    await decryptCredentials(sealed, "cache-pw", salt);
    expect(derive).toHaveBeenCalledTimes(1);
    await encryptCredentials(payload, "other-pw", salt);
    expect(derive).toHaveBeenCalledTimes(2);
    derive.mockRestore();
  });
});
