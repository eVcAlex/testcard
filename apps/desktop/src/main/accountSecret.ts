import { app, safeStorage } from "electron";
import { join } from "node:path";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

/**
 * The sync account password, encrypted at rest with `safeStorage` (DPAPI on Windows) — the same
 * protection the IPTV credentials get in credentials.ts. It has to be recoverable because it's the
 * input to the key that encrypts synced provider credentials, and we don't want to ask for it on
 * every launch. Synchronous on purpose: SyncController reads it in its constructor.
 */
function secretPath(): string {
  return join(app.getPath("userData"), "sync-account.enc");
}

export function saveAccountPassword(password: string): void {
  if (!safeStorage.isEncryptionAvailable()) return; // fall back to asking again next launch
  writeFileSync(secretPath(), safeStorage.encryptString(password), { mode: 0o600 });
}

export function loadAccountPassword(): string | undefined {
  try {
    if (!existsSync(secretPath()) || !safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.decryptString(readFileSync(secretPath()));
  } catch {
    return undefined;
  }
}

export function clearAccountPassword(): void {
  rmSync(secretPath(), { force: true });
}
