import type Database from "better-sqlite3";
import { SyncController as CoreSyncController } from "@testcard/core";
import { getCredentials, saveCredentials } from "./credentials.js";
import { clearAccountPassword, loadAccountPassword, saveAccountPassword } from "./accountSecret.js";

const SYNC_WORKER_URL = process.env.TESTCARD_SYNC_URL ?? "https://testcard-sync.evcalex.workers.dev";

/**
 * The sync loop itself lives in `@testcard/core` (shared with the Android apps); this binds it to
 * Electron's keystore-backed credential and account-password storage.
 */
export class SyncController extends CoreSyncController {
  constructor(
    db: Database.Database,
    /** Called with the ids of sources that arrived from another device, so they can be refreshed (imported) right away. */
    onSourcesAdded: (sourceIds: readonly string[]) => void = () => undefined,
  ) {
    super(
      db,
      {
        baseUrl: SYNC_WORKER_URL,
        getCredentials,
        saveCredentials,
        loadAccountPassword,
        saveAccountPassword,
        clearAccountPassword,
        randomId: () => crypto.randomUUID(),
      },
      onSourcesAdded,
    );
  }
}
