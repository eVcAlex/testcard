import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import {
  createM3UAdapter,
  createXtreamAdapter,
  extractXtreamCredentials,
  importSource,
  probeXtream,
  searchChannels,
  listCountries,
  toggleFavourite,
  type Channel,
  type Source,
} from "@testcard/core";
import { IPC_CHANNEL, type TestcardApi } from "../shared/ipc.js";
import { getCredentials, saveCredentials } from "./credentials.js";
import { randomUUID } from "node:crypto";

/**
 * Single dispatcher keyed by "namespace.method" (e.g. "channels.search") rather than one
 * ipcMain.handle per method, so `TestcardApi` in shared/ipc.ts stays the one place the
 * surface is defined — main and preload both derive from it instead of duplicating a list
 * of channel-name string literals that could silently drift apart.
 */
export function registerIpcHandlers(db: Database.Database): void {
  const xtreamAdapter = createXtreamAdapter(getCredentials);
  const m3uAdapter = createM3UAdapter();

  const api: TestcardApi = {
    sources: {
      async list() {
        return db.prepare(`SELECT id, kind, name, base_url as baseUrl, playlist_url as playlistUrl, epg_url as epgUrl FROM sources`).all() as Source[];
      },

      async addXtream({ name, pastedUrl }) {
        const credentials = extractXtreamCredentials(pastedUrl);
        if (!credentials) {
          throw new Error("Could not find Xtream credentials in that URL. Check it was copied in full.");
        }
        const auth = await probeXtream(credentials);
        if (!auth.authenticated) {
          throw new Error("Those credentials didn't authenticate against the provider.");
        }

        const id = randomUUID();
        await saveCredentials(id, credentials);
        db.prepare(`INSERT INTO sources (id, kind, name, base_url, created_at) VALUES (?, 'xtream', ?, ?, ?)`).run(
          id,
          name,
          credentials.baseUrl,
          Date.now(),
        );

        const source: Source = { id, kind: "xtream", name, baseUrl: credentials.baseUrl };
        return source;
      },

      async refresh(sourceId) {
        const row = db.prepare(`SELECT id, kind, name, base_url as baseUrl, playlist_url as playlistUrl, epg_url as epgUrl FROM sources WHERE id = ?`).get(sourceId) as
          | (Source & { baseUrl?: string; playlistUrl?: string })
          | undefined;
        if (!row) throw new Error(`Unknown source: ${sourceId}`);

        const adapter = row.kind === "xtream" ? xtreamAdapter : m3uAdapter;
        return importSource(db, row, adapter);
      },

      async remove(sourceId) {
        db.prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId);
      },
    },

    channels: {
      async listByCategory(categoryId) {
        const rows = db
          .prepare(
            `SELECT id, source_id as sourceId, category_id as categoryId, normalised_name as normalisedName,
                    raw_name as rawName, country, logo_url as logoUrl, channel_number as channelNumber
             FROM channels WHERE category_id = ? ORDER BY channel_number IS NULL, channel_number, normalised_name`,
          )
          .all(categoryId) as (Omit<Channel, "variants" | "catchup" | "logoUrl" | "channelNumber" | "country"> & {
          logoUrl: string | null;
          channelNumber: number | null;
          country: string | null;
        })[];

        const variantsByChannel = db.prepare(
          `SELECT id, channel_id as channelId, provider_stream_id as providerStreamId, quality, is_offline as isOffline
           FROM channel_variants WHERE channel_id = ? ORDER BY sort_order`,
        );

        return rows.map((row) => ({
          ...row,
          logoUrl: row.logoUrl ?? undefined,
          channelNumber: row.channelNumber ?? undefined,
          country: row.country ?? undefined,
          variants: (variantsByChannel.all(row.id) as { id: string; channelId: string; providerStreamId: string; quality: string | null; isOffline: 0 | 1 }[]).map(
            (v) => ({ id: v.id, sourceId: row.sourceId, providerStreamId: v.providerStreamId, quality: v.quality ?? undefined, isOffline: v.isOffline === 1 }),
          ),
        })) as Channel[];
      },

      async countries(sourceId) {
        return listCountries(db, sourceId);
      },

      async search(query) {
        return searchChannels(db, query);
      },

      async toggleFavourite(channelId) {
        return toggleFavourite(db, channelId);
      },
    },

    playback: {
      async play(_channelId, _variantId) {
        // Wired up once the mpv bridge (src/main/mpv) lands — see ADR 0001 and the plan's
        // build-order step 5. Left as a stub so the IPC contract and renderer can be built
        // and exercised against a fake before the native process work is done.
        throw new Error("Playback is not wired up yet.");
      },
      async stop() {
        throw new Error("Playback is not wired up yet.");
      },
      async setSubtitleTrack(_trackId) {
        throw new Error("Playback is not wired up yet.");
      },
      async setAudioTrack(_trackId) {
        throw new Error("Playback is not wired up yet.");
      },
    },
  };

  ipcMain.handle(IPC_CHANNEL, async (_event, path: string, ...args: unknown[]) => {
    const [namespace, method] = path.split(".") as [keyof TestcardApi, string];
    const namespaceApi = api[namespace] as Record<string, (...a: unknown[]) => Promise<unknown>> | undefined;
    const fn = namespaceApi?.[method];
    if (!fn) throw new Error(`Unknown IPC call: ${path}`);
    return fn(...args);
  });
}
