/**
 * The typed contract between the renderer and main process, shared by `preload` (which
 * implements it against `ipcRenderer`) and `main` (which implements it against `ipcMain`).
 * Keeping this in one file makes it impossible for the two sides to drift silently.
 *
 * Deliberate omissions from this surface: no channel of this API ever returns a raw stream
 * URL or a credential. The renderer passes a channel id; the main process resolves the
 * playable URL and hands it straight to the mpv process (or to VLC), never through the
 * renderer.
 */
import type { CategoryRow, Channel, ChannelCountry, ChannelRow, CountryNode, Source } from "@testcard/core";

export interface AddSourceInput {
  readonly name: string;
  /**
   * Either a pasted Xtream `get.php` URL (credentials are extracted and probed, never echoed
   * back) or a direct M3U playlist URL. Main detects which and stores the right source kind.
   */
  readonly pastedUrl: string;
}

export interface RefreshResult {
  readonly categories: number;
  readonly channels: number;
  readonly variants: number;
  readonly durationMs: number;
}

/** A viewport-relative rectangle in CSS pixels — where the renderer wants the video. */
export interface VideoRegionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlaybackTrack {
  readonly id: number;
  /** "video" tracks are reported for the codec readout only — not offered as switchable. */
  readonly type: "video" | "audio" | "sub";
  /** Human label, e.g. "ENG · E-AC-3" or "Track 2". */
  readonly label: string;
  readonly codec?: string;
  readonly selected: boolean;
}

/**
 * Main-initiated playback lifecycle, pushed to the renderer via `events.onPlayback` (not the
 * request/response pattern the rest of this API uses — playback state changes on its own,
 * e.g. a stream dying after 10s with no frame).
 */
export type PlaybackEvent =
  | { readonly type: "loading"; readonly channelId: string; readonly channelName: string }
  | { readonly type: "playing"; readonly channelId: string }
  | { readonly type: "tracks"; readonly channelId: string; readonly tracks: readonly PlaybackTrack[] }
  | { readonly type: "timeout"; readonly channelId: string }
  | { readonly type: "error"; readonly channelId: string; readonly message: string }
  | { readonly type: "paused"; readonly paused: boolean }
  | { readonly type: "volume"; readonly volume: number }
  | { readonly type: "stopped" };

/**
 * A pull-on-mount view of playback state. The overlay window (and an HMR-reloaded renderer)
 * can start after playback is already running, so they read this once and then follow the
 * event stream.
 */
export interface PlaybackSnapshot {
  readonly status: "idle" | "loading" | "playing" | "dead";
  readonly channelId: string | null;
  readonly channelName: string | null;
  readonly tracks: readonly PlaybackTrack[];
  readonly paused: boolean;
  readonly volume: number;
}

export interface TestcardApi {
  sources: {
    list(): Promise<readonly Source[]>;
    /** Adds an Xtream or M3U source; the kind is detected from the pasted URL. */
    add(input: AddSourceInput): Promise<Source>;
    refresh(sourceId: string): Promise<RefreshResult>;
    remove(sourceId: string): Promise<void>;
  };
  channels: {
    listByCategory(categoryId: string): Promise<readonly Channel[]>;
    countries(sourceId: string): Promise<readonly CountryNode[]>;
    search(query: string): Promise<readonly ChannelRow[]>;
    /** The default grid: all channels, optionally one category or country, paginated. */
    browse(opts?: {
      categoryId?: string;
      country?: string;
      limit?: number;
      offset?: number;
    }): Promise<readonly ChannelRow[]>;
    recent(): Promise<readonly ChannelRow[]>;
    favourites(): Promise<readonly ChannelRow[]>;
    /** Every category (provider group-title) with channels, for the sidebar list. */
    categoryList(): Promise<readonly CategoryRow[]>;
    /** Distinct channel countries with counts, for the filter chips. */
    countryList(): Promise<readonly ChannelCountry[]>;
    toggleFavourite(channelId: string): Promise<boolean>;
  };
  playback: {
    /** Starts playback of a channel's best (or explicitly chosen) variant inside the mpv window. */
    play(channelId: string, variantId?: string): Promise<void>;
    stop(): Promise<void>;
    /** Current playback state, for a surface that mounts mid-stream (the overlay, an HMR reload). */
    snapshot(): Promise<PlaybackSnapshot>;
    /** Tells main where the picture well currently is, so the mpv window can be positioned over it. */
    setVideoRegion(rect: VideoRegionRect): Promise<void>;
    setVolume(volume: number): Promise<void>;
    setPaused(paused: boolean): Promise<void>;
    setSubtitleTrack(trackId: number | null): Promise<void>;
    setAudioTrack(trackId: number): Promise<void>;
    /** Opens the current channel's stream in VLC (for a channel mpv couldn't play). */
    openInVlc(): Promise<void>;
    /** Whether an "Open in VLC" action can succeed on this machine. */
    vlcAvailable(): Promise<boolean>;
  };
  events: {
    /** Subscribes to playback lifecycle events. Returns an unsubscribe function. */
    onPlayback(listener: (event: PlaybackEvent) => void): () => void;
  };
}

/** IPC channel name for request/response calls. */
export const IPC_CHANNEL = "testcard:invoke" as const;
/** IPC channel name for main-initiated events (webContents.send -> ipcRenderer.on). */
export const IPC_EVENT_CHANNEL = "testcard:event" as const;
