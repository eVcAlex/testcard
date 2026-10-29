import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrateDatabase.js";
import { collectLocalChanges } from "../sync/localChanges.js";
import { decryptCredentials, generateSalt } from "../sync/credentialCrypto.js";

/**
 * After a password reset the server has cleared the account's sealed sources, and a device that signs in again starts from
 * cursor 0 (`SyncController.forgetSession`). Everything it still holds has to be sealed afresh under the new password.
 */
describe("a device signing in again after a password reset", () => {
  const credentials = async () => ({ baseUrl: "http://x", username: "alice", password: "provider-pass" });

  function device() {
    const db = migrateDatabase(new Database(":memory:"));
    db.prepare("INSERT INTO sources (id, kind, name, base_url, created_at, remote_key, sync_updated_at) VALUES ('s1', 'xtream', 'One', 'http://x', 1, 'key-1', 50)").run();
    db.prepare("INSERT INTO sources (id, kind, name, playlist_url, created_at, remote_key, sync_updated_at) VALUES ('s2', 'm3u', 'Two', 'http://p/l.m3u', 1, 'key-2', 60)").run();
    return db;
  }

  it("sends every source it holds from cursor 0, sealed so only the new password opens it", async () => {
    const salt = generateSalt();
    const push = await collectLocalChanges(device(), 0, "new-password-123", salt, credentials);
    expect(push.sources.map((source) => source.remoteKey).sort()).toEqual(["key-1", "key-2"]);

    for (const source of push.sources) {
      const sealed = { blob: source.credentialsBlob!, iv: source.credentialsIv! };
      await expect(decryptCredentials(sealed, "old-password-123", salt)).rejects.toThrow();
      await expect(decryptCredentials(sealed, "new-password-123", salt)).resolves.toBeTruthy();
    }
  });
});
