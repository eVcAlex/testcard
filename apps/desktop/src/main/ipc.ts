import { ipcMain, type BrowserWindow } from "electron";
import type Database from "better-sqlite3";
import {
  browseChannels,
  createM3UAdapter,
  createXtreamAdapter,
  extractXtreamCredentials,
  importEpg,
  importSource,
  listCategories,
  listChannelCountries,
  listFavouriteChannels,
  listRecentChannels,
  nowNextForChannels,
  probeXtream,
  programmesInWindow,
  searchChannels,
  listCountries,
  toggleFavourite,
  type Channel,
  type ProgrammeRow,
  type Source,
  type SourceAdapter,
} from "@testcard/core";
import {
  IPC_CHANNEL,
  IPC_TASK_CHANNEL,
  type NowNextLite,
  type ProgrammeLite,
  type TaskEvent,
  type TestcardApi,
} from "../shared/ipc.js";
import { getCredentials, saveCredentials } from "./credentials.js";
import { PlaybackController } from "./playbackController.js";
import { isVlcAvailable } from "./externalPlayer.js";
import { randomUUID } from "node:crypto";

let activeController: PlaybackController | null = null;

function toProgrammeLite(row: ProgrammeRow): ProgrammeLite {
  return {
    channelId: row.channel_id,
    title: row.title,
    ...(row.description !== null ? { description: row.description } : {}),
    startMs: row.start_at,
    endMs: row.end_at,
  };
}

/**
 * Fetches and imports the source's EPG. URL priority: an explicit user-supplied URL, else the
 * adapter's auto-detected one (`url-tvg` / `xmltv.php`). A credential-free discovered URL is
 * persisted so the UI can show it; Xtream's credential-bearing `xmltv.php` is re-derived every
 * refresh and never stored. Returns the programme count, or undefined when no EPG URL exists.
 * Throws on a fetch/parse failure — the caller downgrades that to a non-fatal task event.
 */
async function refreshEpg(
  db: Database.Database,
  source: Source,
  adapter: SourceAdapter,
  storedEpgUrl: string | null,
  emitTask: (event: TaskEvent) => void,
): Promise<number | undefined> {
  const stored = storedEpgUrl?.trim() ?? "";
  const epgUrl = stored !== "" ? stored : await adapter.probeEpgUrl?.(source);
  if (!epgUrl) return undefined;

  if (stored === "" && source.kind === "m3u") {
    db.prepare(`UPDATE sources SET epg_url = ? WHERE id = ?`).run(epgUrl, source.id);
  }

  emitTask({ type: "epg", sourceId: source.id, phase: "fetching" });
  const response = await fetch(epgUrl);
  if (!response.ok || response.body === null) {
    throw new Error(`The EPG URL responded with HTTP ${response.status}.`);
  }
  // Only decompress ourselves when the server did NOT — otherwise fetch already un-gzipped it.
  const gzipped = /\.gz($|\?)/i.test(epgUrl) && response.headers.get("content-encoding") === null;

  emitTask({ type: "epg", sourceId: source.id, phase: "parsing", programmes: 0 });
  const result = await importEpg(db, source.id, response.body, {
    gzipped,
    onProgress: (programmes) => emitTask({ type: "epg", sourceId: source.id, phase: "parsing", programmes }),
  });
  emitTask({ type: "epg", sourceId: source.id, phase: "done", programmes: result.programmes });
  return result.programmes;
}

/**
 * Single dispatcher keyed by "namespace.method" (e.g. "channels.search") rather than one
 * ipcMain.handle per method, so `TestcardApi` in shared/ipc.ts stays the one place the
 * surface is defined — main and preload both derive from it instead of duplicating a list
 * of channel-name string literals that could silently drift apart.
 */
export function registerIpcHandlers(db: Database.Database, mainWindow: BrowserWindow): void {
  const xtreamAdapter = createXtreamAdapter(getCredentials);
  const m3uAdapter = createM3UAdapter();

  activeController?.dispose();
  const playback = new PlaybackController(db, mainWindow, { xtream: xtreamAdapter, m3u: m3uAdapter });
  activeController = playback;
  mainWindow.on("closed", () => {
    if (activeController === playback) activeController = null;
    playback.dispose();
  });

  const emitTask = (event: TaskEvent): void => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_TASK_CHANNEL, event);
  };

  const api: Omit<TestcardApi, "events"> = {
    sources: {
      async list() {
        return db.prepare(`SELECT id, kind, name, base_url as baseUrl, playlist_url as playlistUrl, epg_url as epgUrl FROM sources`).all() as Source[];
      },

      async add({ name, pastedUrl, epgUrl }) {
        const url = pastedUrl.trim();
        const epg = epgUrl?.trim() ?? "";

        // Xtream if we can pull username/password out of the URL; a plain hosted playlist
        // otherwise. That's also the fallback the M3U adapter is designed for — see its doc.
        const credentials = extractXtreamCredentials(url);
        if (credentials) {
          const auth = await probeXtream(credentials);
          if (!auth.authenticated) {
            throw new Error("Those credentials didn't authenticate against the provider.");
          }

          const id = randomUUID();
          await saveCredentials(id, credentials);
          db.prepare(
            `INSERT INTO sources (id, kind, name, base_url, epg_url, created_at) VALUES (?, 'xtream', ?, ?, ?, ?)`,
          ).run(id, name, credentials.baseUrl, epg !== "" ? epg : null, Date.now());

          const source: Source = { id, kind: "xtream", name, baseUrl: credentials.baseUrl };
          return source;
        }

        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error("That's not an Xtream get.php URL or a valid playlist URL.");
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("A playlist URL must start with http:// or https://.");
        }

        // Confirm it's reachable before saving, mirroring the Xtream probe — but don't
        // download the whole playlist here; `refresh` streams and parses it.
        const probe = await fetch(url, { method: "GET" });
        void probe.body?.cancel();
        if (!probe.ok) {
          throw new Error(`The playlist URL responded with HTTP ${probe.status}.`);
        }

        const id = randomUUID();
        db.prepare(
          `INSERT INTO sources (id, kind, name, playlist_url, epg_url, created_at) VALUES (?, 'm3u', ?, ?, ?, ?)`,
        ).run(id, name, url, epg !== "" ? epg : null, Date.now());

        const source: Source = {
          id,
          kind: "m3u",
          name,
          playlistUrl: url,
          ...(epg !== "" ? { epgUrl: epg } : {}),
        };
        return source;
      },

      async refresh(sourceId) {
        const row = db.prepare(`SELECT id, kind, name, base_url as baseUrl, playlist_url as playlistUrl, epg_url as epgUrl FROM sources WHERE id = ?`).get(sourceId) as
          | (Source & { baseUrl?: string; playlistUrl?: string; epgUrl?: string | null })
          | undefined;
        if (!row) throw new Error(`Unknown source: ${sourceId}`);

        const adapter = row.kind === "xtream" ? xtreamAdapter : m3uAdapter;
        const result = await importSource(db, row, adapter);

        // EPG is best-effort: a bad or missing guide URL must not fail the playlist refresh.
        const programmes = await refreshEpg(db, row, adapter, row.epgUrl ?? null, emitTask).catch(
          (error: unknown) => {
            emitTask({
              type: "epg",
              sourceId,
              phase: "error",
              message: error instanceof Error ? error.message : "The guide could not be updated.",
            });
            return undefined;
          },
        );

        return programmes !== undefined ? { ...result, programmes } : result;
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

      async browse(opts) {
        return browseChannels(db, opts ?? {});
      },

      async recent() {
        return listRecentChannels(db);
      },

      async favourites() {
        return listFavouriteChannels(db);
      },

      async categoryList() {
        return listCategories(db);
      },

      async countryList() {
        return listChannelCountries(db);
      },

      async toggleFavourite(channelId) {
        return toggleFavourite(db, channelId);
      },
    },

    epg: {
      async nowNext(channelIds) {
        const out: Record<string, NowNextLite> = {};
        for (const [channelId, nn] of nowNextForChannels(db, channelIds)) {
          out[channelId] = {
            ...(nn.now !== undefined ? { now: toProgrammeLite(nn.now) } : {}),
            ...(nn.next !== undefined ? { next: toProgrammeLite(nn.next) } : {}),
          };
        }
        return out;
      },
      async window(channelIds, fromMs, toMs) {
        return programmesInWindow(db, channelIds, fromMs, toMs).map(toProgrammeLite);
      },
    },

    playback: {
      async play(channelId, variantId) {
        await playback.play(channelId, variantId);
      },
      async stop() {
        await playback.stop();
      },
      async snapshot() {
        return playback.snapshot();
      },
      async channelStep(delta) {
        playback.channelStep(delta as number);
      },
      async exitPlayer() {
        playback.exitPlayer();
      },
      async setVideoRegion(rect) {
        playback.setVideoRegion(rect);
      },
      async setVolume(volume) {
        await playback.setVolume(volume);
      },
      async setPaused(paused) {
        await playback.setPaused(paused);
      },
      async setAspect(mode) {
        await playback.setAspect(mode);
      },
      async setSubtitleTrack(trackId) {
        await playback.setSubtitleTrack(trackId);
      },
      async setAudioTrack(trackId) {
        await playback.setAudioTrack(trackId);
      },
      async openInVlc() {
        await playback.openInVlc();
      },
      async vlcAvailable() {
        return isVlcAvailable();
      },
    },

    view: {
      async toggleFullscreen() {
        playback.toggleFullscreen();
      },
      async isFullscreen() {
        return playback.isFullscreen();
      },
    },
  };

  ipcMain.removeHandler(IPC_CHANNEL);
  ipcMain.handle(IPC_CHANNEL, async (_event, path: string, ...args: unknown[]) => {
    const [namespace, method] = path.split(".") as [keyof typeof api, string];
    const namespaceApi = api[namespace] as Record<string, (...a: unknown[]) => Promise<unknown>> | undefined;
    const fn = namespaceApi?.[method];
    if (!fn) throw new Error(`Unknown IPC call: ${path}`);
    return fn(...args);
  });
}
