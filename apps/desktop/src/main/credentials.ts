import { app, safeStorage } from "electron";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { XtreamCredentials } from "@testcard/core";

/**
 * Credential storage. `safeStorage` (DPAPI on Windows) encrypts each blob at rest under the
 * logged-in Windows user; the encrypted bytes are the only thing that ever touches disk.
 *
 * This file is the *only* place in the app that should read a raw username/password —
 * everything else (the renderer, logs, crash reports) must only ever see a Source id.
 * See the security note in CONTEXT.md / the plan: credentials must never appear in the repo,
 * logs, or crash reports.
 */

function credentialsFilePath(): string {
  return join(app.getPath("userData"), "credentials.enc.json");
}

async function readStore(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(credentialsFilePath(), "utf-8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeStore(store: Record<string, string>): Promise<void> {
  await writeFile(credentialsFilePath(), JSON.stringify(store), { mode: 0o600 });
}

export async function saveCredentials(sourceId: string, credentials: XtreamCredentials): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level credential encryption is unavailable on this machine.");
  }
  const store = await readStore();
  store[sourceId] = safeStorage.encryptString(JSON.stringify(credentials)).toString("base64");
  await writeStore(store);
}

export async function getCredentials(sourceId: string): Promise<XtreamCredentials> {
  const store = await readStore();
  const encoded = store[sourceId];
  if (encoded === undefined) throw new Error(`No stored credentials for source ${sourceId}`);
  const decrypted = safeStorage.decryptString(Buffer.from(encoded, "base64"));
  return JSON.parse(decrypted) as XtreamCredentials;
}

export async function deleteCredentials(sourceId: string): Promise<void> {
  const store = await readStore();
  delete store[sourceId];
  await writeStore(store);
}
