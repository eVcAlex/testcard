/**
 * The typed contract between the renderer and main process, shared by `preload` (which
 * implements it against `ipcRenderer`) and `main` (which implements it against `ipcMain`).
 * Keeping this in one file makes it impossible for the two sides to drift silently.
 *
 * Deliberate omissions from this surface: no channel of this API ever returns a raw stream
 * URL or a credential. The renderer passes a channel id; the main process resolves the
 * playable URL and hands it straight to the mpv process, never through the renderer.
 */
import type { Channel, ChannelRow, CountryNode, Source } from "@testcard/core";

export interface AddXtreamSourceInput {
  readonly name: string;
  /** A pasted M3U or get.php URL; credentials are extracted and probed, never echoed back. */
  readonly pastedUrl: string;
}

export interface RefreshResult {
  readonly categories: number;
  readonly channels: number;
  readonly variants: number;
  readonly durationMs: number;
}

export interface TestcardApi {
  sources: {
    list(): Promise<readonly Source[]>;
    addXtream(input: AddXtreamSourceInput): Promise<Source>;
    refresh(sourceId: string): Promise<RefreshResult>;
    remove(sourceId: string): Promise<void>;
  };
  channels: {
    listByCategory(categoryId: string): Promise<readonly Channel[]>;
    countries(sourceId: string): Promise<readonly CountryNode[]>;
    search(query: string): Promise<readonly ChannelRow[]>;
    toggleFavourite(channelId: string): Promise<boolean>;
  };
  playback: {
    /** Starts playback of a channel's best (or explicitly chosen) variant inside the mpv window. */
    play(channelId: string, variantId?: string): Promise<void>;
    stop(): Promise<void>;
    setSubtitleTrack(trackId: number | null): Promise<void>;
    setAudioTrack(trackId: number): Promise<void>;
  };
}

/** IPC channel name prefix, so main/preload literals can't drift from each other by typo. */
export const IPC_CHANNEL = "testcard:invoke" as const;
