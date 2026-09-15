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
import type {
  CategoryRow,
  Channel,
  ChannelCountry,
  ChannelRow,
  CountryNode,
  MovieCategoryRow,
  MovieRow,
  PlaybackProgressRow,
  SeriesCategoryRow,
  SeriesDetail,
  SeriesRow,
  Source,
} from "@testcard/core";

/**
 * How the user entered the source — not the same thing as the resulting `Source["kind"]`. A
 * `"url"` paste that turns out to be a `get.php` link still produces an Xtream source (main
 * detects that from the URL, as it always has); `"xtream"` is the form's own tab for a provider
 * that only gave a host/username/password, so there's nothing to hand-assemble into a URL for.
 */
export type AddSourceInput = {
  readonly name: string;
  /**
   * Optional explicit XMLTV/EPG URL. When absent, main auto-detects one on refresh (the M3U
   * `url-tvg` header, or Xtream `xmltv.php`).
   */
  readonly epgUrl?: string;
  /** Hours between automatic refreshes. Absent (or `undefined`) means manual refresh only. */
  readonly refreshIntervalHours?: number;
} & (
  | {
      readonly via: "url";
      /**
       * Either a pasted Xtream `get.php` URL (credentials are extracted and probed, never
       * echoed back) or a direct M3U playlist URL. Main detects which and stores the right
       * source kind.
       */
      readonly pastedUrl: string;
    }
  | {
      readonly via: "xtream";
      readonly baseUrl: string;
      readonly username: string;
      readonly password: string;
    }
);

/**
 * A source edit. `kind` cannot change here — the edit form has no kind toggle, so the shape of
 * the patch itself picks a lane: `playlistUrl` only makes sense for an M3U source, `xtream`
 * only for an Xtream one. Main rejects the wrong one for a given source's stored kind.
 */
export interface UpdateSourceInput {
  readonly name: string;
  /** Omit to leave unchanged; `""` clears the stored EPG URL. */
  readonly epgUrl?: string;
  /** M3U only: a replacement playlist URL. Omit to keep the current one. */
  readonly playlistUrl?: string;
  /**
   * Xtream only: omit any field to keep its current value. `password` sent blank (or omitted)
   * means "unchanged" — the stored password is never sent to the renderer to prefill, so this
   * is the only way an edit form can represent "leave it alone."
   */
  readonly xtream?: {
    readonly baseUrl?: string;
    readonly username?: string;
    readonly password?: string;
  };
  /** Omit to leave unchanged; `null` turns auto-refresh off (manual only). */
  readonly refreshIntervalHours?: number | null;
}

/** A source as listed in the sidebar — the domain `Source` plus desktop-only bookkeeping. */
export type SourceListItem = Source & {
  readonly createdAt: number;
  readonly lastRefreshedAt?: number;
  readonly refreshIntervalHours?: number;
};

export interface RefreshResult {
  readonly categories: number;
  readonly channels: number;
  readonly variants: number;
  readonly durationMs: number;
  /** Programme rows imported from EPG, when a guide URL was available. */
  readonly programmes?: number;
  /** Movies imported, when the source is Xtream (design spec "Import strategy"). */
  readonly movies?: number;
  /** Series imported, when the source is Xtream. */
  readonly series?: number;
}

/** A programme as it crosses IPC — unix ms, never a `Date` (which doesn't survive every path). */
export interface ProgrammeLite {
  readonly channelId: string;
  readonly title: string;
  readonly description?: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface NowNextLite {
  readonly now?: ProgrammeLite;
  readonly next?: ProgrammeLite;
}

/** Background-task progress, pushed on `IPC_TASK_CHANNEL` (kept off the playback event stream). */
export type TaskEvent =
  | {
      readonly type: "epg";
      readonly sourceId: string;
      readonly phase: "fetching" | "parsing" | "done" | "error";
      readonly programmes?: number;
      readonly message?: string;
    }
  | {
      readonly type: "vod";
      readonly sourceId: string;
      readonly phase: "fetching" | "done" | "error";
      readonly movies?: number;
      readonly message?: string;
    }
  | {
      readonly type: "series";
      readonly sourceId: string;
      readonly phase: "fetching" | "done" | "error";
      readonly series?: number;
      readonly message?: string;
    };

/** A viewport-relative rectangle in CSS pixels — where the renderer wants the video. */
export interface VideoRegionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How mpv should fit the video into the picture. `fit` letterboxes; `fill` zoom-crops. */
export type AspectMode = "fit" | "fill" | "16:9" | "4:3";

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
  | { readonly type: "aspect"; readonly aspect: AspectMode }
  | { readonly type: "fullscreen"; readonly fullscreen: boolean }
  // Requested from the overlay window (which has no channel-list context); the main window
  // acts on these — step to the next/previous channel in the current browse list, or leave the
  // player. Sent only to the main window, never the overlay.
  | { readonly type: "channel-step"; readonly delta: number }
  | { readonly type: "exit-player" }
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
  readonly aspect: AspectMode;
  readonly fullscreen: boolean;
}

export interface TestcardApi {
  sources: {
    list(): Promise<readonly SourceListItem[]>;
    /** Adds an Xtream or M3U source — see `AddSourceInput["via"]` for the two entry paths. */
    add(input: AddSourceInput): Promise<Source>;
    /** Edits a source in place — same id, so favourites/recents survive. Kind cannot change. */
    update(sourceId: string, patch: UpdateSourceInput): Promise<Source>;
    refresh(sourceId: string): Promise<RefreshResult>;
    /** Deletes a source, its credentials, and any favourites/recents left orphaned by it. */
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
  epg: {
    /** Now + next per channel, for the visible grid. Channels with no EPG are omitted. */
    nowNext(channelIds: readonly string[]): Promise<Record<string, NowNextLite>>;
    /** Every programme overlapping `[fromMs, toMs]` for the given channels — the guide grid. */
    window(channelIds: readonly string[], fromMs: number, toMs: number): Promise<readonly ProgrammeLite[]>;
  };
  movies: {
    /** Every movie category that still has movies, for MoviesView's category tree. */
    categoryList(): Promise<readonly MovieCategoryRow[]>;
    /** The default poster grid: all movies, optionally one category, paginated. */
    browse(opts?: { categoryId?: string; limit?: number; offset?: number }): Promise<readonly MovieRow[]>;
    search(query: string): Promise<readonly MovieRow[]>;
    favourites(): Promise<readonly MovieRow[]>;
    recent(): Promise<readonly MovieRow[]>;
    toggleFavourite(movieId: string): Promise<boolean>;
    /** Triggers the lazy plot/duration (get_vod_info) fetch if not already cached, then returns the row. */
    details(movieId: string): Promise<MovieRow>;
  };
  series: {
    categoryList(): Promise<readonly SeriesCategoryRow[]>;
    browse(opts?: { categoryId?: string; limit?: number; offset?: number }): Promise<readonly SeriesRow[]>;
    search(query: string): Promise<readonly SeriesRow[]>;
    favourites(): Promise<readonly SeriesRow[]>;
    recent(): Promise<readonly SeriesRow[]>;
    toggleFavourite(seriesId: string): Promise<boolean>;
    /** Lazy-fetches (or returns cached) seasons/episodes for a series. */
    episodes(seriesId: string): Promise<SeriesDetail>;
  };
  progress: {
    get(itemType: "movie" | "episode", itemId: string): Promise<PlaybackProgressRow | undefined>;
    set(itemType: "movie" | "episode", itemId: string, positionSecs: number, durationSecs?: number): Promise<void>;
  };
  playback: {
    /** Starts playback of a channel's best (or explicitly chosen) variant inside the mpv window. */
    play(channelId: string, variantId?: string): Promise<void>;
    /** Starts a movie, resolving container_extension (lazily, if missing) then building its URL. */
    playMovie(movieId: string, opts?: { resume?: boolean }): Promise<void>;
    /** Starts an episode. */
    playEpisode(episodeId: string, opts?: { resume?: boolean }): Promise<void>;
    stop(): Promise<void>;
    /** Current playback state, for a surface that mounts mid-stream (the overlay, an HMR reload). */
    snapshot(): Promise<PlaybackSnapshot>;
    /** Overlay → main window: step channel in the current browse list (+1 / -1). */
    channelStep(delta: number): Promise<void>;
    /** Overlay → main window: leave the player and stop playback. */
    exitPlayer(): Promise<void>;
    /** Tells main where the picture well currently is, so the mpv window can be positioned over it. */
    setVideoRegion(rect: VideoRegionRect): Promise<void>;
    setVolume(volume: number): Promise<void>;
    setPaused(paused: boolean): Promise<void>;
    /** Sets how the video fits the picture. Persisted, re-applied on the next channel. */
    setAspect(mode: AspectMode): Promise<void>;
    setSubtitleTrack(trackId: number | null): Promise<void>;
    setAudioTrack(trackId: number): Promise<void>;
    /** Opens the current channel's stream in VLC (for a channel mpv couldn't play). */
    openInVlc(): Promise<void>;
    /** Whether an "Open in VLC" action can succeed on this machine. */
    vlcAvailable(): Promise<boolean>;
  };
  view: {
    /** Toggles OS fullscreen on the main window. State changes arrive as a `fullscreen` event. */
    toggleFullscreen(): Promise<void>;
    isFullscreen(): Promise<boolean>;
  };
  events: {
    /** Subscribes to playback lifecycle events. Returns an unsubscribe function. */
    onPlayback(listener: (event: PlaybackEvent) => void): () => void;
    /** Subscribes to background-task progress (EPG import). Returns an unsubscribe function. */
    onTask(listener: (event: TaskEvent) => void): () => void;
  };
}

/** IPC channel name for request/response calls. */
export const IPC_CHANNEL = "testcard:invoke" as const;
/** IPC channel name for main-initiated playback events (webContents.send -> ipcRenderer.on). */
export const IPC_EVENT_CHANNEL = "testcard:event" as const;
/** IPC channel name for main-initiated background-task progress. */
export const IPC_TASK_CHANNEL = "testcard:task" as const;
