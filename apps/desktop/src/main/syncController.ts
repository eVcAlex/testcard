import type { SyncPlatform } from "@testcard/core";
import { deleteCredentials, getCredentials, saveCredentials } from "./credentials.js";
import { clearAccountPassword, loadAccountPassword, saveAccountPassword } from "./accountSecret.js";

/**
 * The sync loop itself lives in `@testcard/core` (shared with the Android apps); this binds it to
 * Electron's keystore-backed credential and account-password storage.
 */
export const syncPlatform: SyncPlatform = {
  baseUrl: process.env.TESTCARD_SYNC_URL ?? "https://testcard-sync.evcalex.workers.dev",
  getCredentials,
  saveCredentials,
  deleteCredentials,
  loadAccountPassword,
  saveAccountPassword,
  clearAccountPassword,
  randomId: () => crypto.randomUUID(),
};
