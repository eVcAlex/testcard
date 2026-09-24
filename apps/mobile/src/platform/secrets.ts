import * as SecureStore from "expo-secure-store";
import type { SyncPlatform } from "@testcard/core/src/sync/syncController.js";
import type { XtreamCredentials } from "@testcard/core/src/source/xtream/detect.js";

/**
 * Secrets live in the Android keystore through expo-secure-store, never in the SQLite file. The
 * same layout as desktop: one entry per source for its provider login, one for the account password.
 */
const ACCOUNT_PASSWORD_KEY = "testcard.account-password";
const credentialKey = (sourceId: string) => `testcard.source.${sourceId}`;

/** The login as stored: its server is the source's main address. What sync sends, and what the source's form shows. */
export async function getStoredCredentials(sourceId: string): Promise<XtreamCredentials> {
  const raw = await SecureStore.getItemAsync(credentialKey(sourceId));
  if (raw === null) throw new Error(`No stored credentials for source ${sourceId}`);
  return JSON.parse(raw) as XtreamCredentials;
}

/** Another of the source's addresses to use instead of its main one, while that one is down (see state/hosts.ts). */
const serverInUse = new Map<string, string>();
export function setServerInUse(sourceId: string, baseUrl: string | null): void {
  if (baseUrl === null) serverInUse.delete(sourceId);
  else serverInUse.set(sourceId, baseUrl);
}
export const serverFor = (sourceId: string): string | undefined => serverInUse.get(sourceId);

/** The login to talk to the provider with: on the backup server in use, if the main one is down. */
export async function getCredentials(sourceId: string): Promise<XtreamCredentials> {
  const stored = await getStoredCredentials(sourceId);
  const server = serverInUse.get(sourceId);
  return server !== undefined ? { ...stored, baseUrl: server } : stored;
}

export async function saveCredentials(sourceId: string, credentials: XtreamCredentials): Promise<void> {
  await SecureStore.setItemAsync(credentialKey(sourceId), JSON.stringify(credentials));
}

export async function deleteCredentials(sourceId: string): Promise<void> {
  await SecureStore.deleteItemAsync(credentialKey(sourceId));
}

const SYNC_WORKER_URL = "https://testcard-sync.evcalex.workers.dev";

export const syncPlatform: SyncPlatform = {
  baseUrl: SYNC_WORKER_URL,
  getCredentials: getStoredCredentials,
  saveCredentials,
  deleteCredentials,
  loadAccountPassword: () => SecureStore.getItem(ACCOUNT_PASSWORD_KEY) ?? undefined,
  saveAccountPassword: (password) => SecureStore.setItem(ACCOUNT_PASSWORD_KEY, password),
  clearAccountPassword: () => {
    void SecureStore.deleteItemAsync(ACCOUNT_PASSWORD_KEY);
  },
  randomId: () => globalThis.crypto.randomUUID(),
};
