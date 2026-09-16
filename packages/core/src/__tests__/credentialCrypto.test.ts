import { describe, expect, it } from "vitest";
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
