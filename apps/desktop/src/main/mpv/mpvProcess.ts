import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { app } from "electron";
import { MpvIpcClient } from "./mpvIpc.js";

/** How long to wait for the first video frame before treating a stream as dead. See ADR 0001 / CONTEXT.md "Dead channel". */
export const PLAYBACK_TIMEOUT_MS = 10_000;

export interface MpvTrack {
  readonly id: number;
  readonly type: "video" | "audio" | "sub";
  readonly title?: string;
  readonly lang?: string;
  readonly codec?: string;
  readonly selected: boolean;
}

export type MpvEvent =
  | { readonly type: "loading" }
  | { readonly type: "playing" }
  | { readonly type: "tracks"; readonly tracks: readonly MpvTrack[] }
  | { readonly type: "timeout" }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "exited"; readonly code: number | null }
  | { readonly type: "time-pos"; readonly seconds: number }
  | { readonly type: "end-file"; readonly reason: string };

interface RawMpvTrack {
  readonly id: number;
  readonly type: string;
  readonly title?: string;
  readonly lang?: string;
  readonly codec?: string;
  readonly selected?: boolean;
}

/**
 * Owns one embedded mpv child process rendering into a given native window handle (`--wid`).
 * See ADR 0001 for why mpv over Chromium `<video>`, and its "Known limitation" note: HTML
 * cannot be composited on top of this surface, so the caller is responsible for sizing a
 * dedicated child region (not overlapping renderer chrome that needs to sit on top).
 */
export class MpvPlayer extends EventEmitter<{ event: [MpvEvent] }> {
  private process: ChildProcessWithoutNullStreams | null = null;
  private ipc: MpvIpcClient | null = null;
  private timeoutHandle: NodeJS.Timeout | null = null;
  /** Bumped on every play() so listeners from a superseded load can detect they're stale. */
  private loadGeneration = 0;
  private disposeListeners: (() => void)[] = [];

  constructor(private readonly mpvExecutablePath: string) {
    super();
  }

  async start(wid: number): Promise<void> {
    await this.stop();

    const pipeName = `\\\\.\\pipe\\testcard-mpv-${process.pid}-${Date.now()}`;

    this.process = spawn(
      this.mpvExecutablePath,
      [
        `--wid=${wid}`,
        `--input-ipc-server=${pipeName}`,
        "--no-config", // a stray global mpv.conf must not change how the app behaves
        "--no-osc",
        "--no-input-default-bindings",
        "--idle=yes",
        "--force-window=yes",
        "--keep-open=no",
        "--hwdec=auto-safe",
        // NOTE: deliberately not --profile=low-latency here. That profile sets cache=no,
        // which stutters on the 2160p50 HEVC channel this whole architecture exists to
        // play (ADR 0001). A modest demuxer cache is the right default; tune later.
        "--cache=yes",
        "--demuxer-max-bytes=64MiB",
        "--msg-level=all=warn",
        `--log-file=${join(app.getPath("logs"), "mpv.log")}`,
      ],
      { windowsHide: true },
    );

    this.process.on("exit", (code) => this.emit("event", { type: "exited", code }));
    this.process.on("error", (error) => this.emit("event", { type: "error", message: error.message }));

    this.ipc = new MpvIpcClient(pipeName);
    // mpv creates the pipe once the process is up; a short retry loop covers the startup race
    // rather than an arbitrary fixed delay.
    await this.connectWithRetry(this.ipc);

    // Observed once for the life of the process; play() (re)attaches per-load listeners for
    // core-idle / video-params / end-file.
    await this.ipc.observeProperty("core-idle");
    await this.ipc.observeProperty("video-params");
    await this.ipc.observeProperty("track-list");
    await this.ipc.observeProperty("time-pos");

    // track-list is process-lifetime, not per-load: the list first populates a beat before
    // the first frame decodes (so before a load "settles"), and it also changes afterwards
    // when the user switches audio/subtitle track. A per-load listener would miss both.
    this.ipc.onPropertyChange("track-list", (value) => {
      this.emit("event", { type: "tracks", tracks: mapTracks(value) });
    });

    // Process-lifetime, not per-load (mirrors track-list above) — drives PlaybackController's
    // playback_progress persistence for movies/episodes; live channels ignore this event.
    this.ipc.onPropertyChange("time-pos", (value) => {
      if (typeof value === "number") this.emit("event", { type: "time-pos", seconds: value });
    });
    // Also process-lifetime: play()'s own end-file listener below is per-load and only cares
    // whether a stream failed to *start*. This one tells the controller a title actually
    // finished (or was replaced), for progress persistence and watched-marking.
    this.ipc.onEvent("end-file", (message) => {
      this.emit("event", { type: "end-file", reason: String(message["reason"] ?? "unknown") });
    });
  }

  private async connectWithRetry(ipc: MpvIpcClient, attemptsLeft = 20): Promise<void> {
    try {
      await ipc.connect();
    } catch (error) {
      if (attemptsLeft <= 0) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return this.connectWithRetry(ipc, attemptsLeft - 1);
    }
  }

  async play(streamUrl: string): Promise<void> {
    if (!this.ipc) throw new Error("mpv is not started");
    const ipc = this.ipc;

    this.clearLoadListeners();
    const generation = ++this.loadGeneration;
    const isStale = () => generation !== this.loadGeneration;
    let settled = false;

    const finish = (event: MpvEvent) => {
      if (settled || isStale()) return;
      settled = true;
      if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
      this.clearLoadListeners();
      this.emit("event", event);
    };

    this.emit("event", { type: "loading" });

    this.disposeListeners.push(
      // "playing" means a frame actually decoded — video-params goes from null to an object
      // with real dimensions. core-idle alone flips false while mpv is still probing.
      ipc.onPropertyChange("video-params", (value) => {
        if (isDecodedVideoParams(value)) finish({ type: "playing" });
      }),
      // A stream that 404s or has no playable track ends almost immediately — surface that
      // now instead of making the user wait out the full timeout.
      ipc.onEvent("end-file", (message) => {
        const reason = String(message["reason"] ?? "");
        if (reason === "stop" || reason === "redirect") return; // superseded by our own next loadfile
        finish(
          reason === "error"
            ? { type: "error", message: String(message["file_error"] ?? "The stream could not be opened.") }
            : { type: "timeout" },
        );
      }),
    );

    this.timeoutHandle = setTimeout(() => finish({ type: "timeout" }), PLAYBACK_TIMEOUT_MS);

    await ipc.command(["loadfile", streamUrl, "replace"]);
  }

  async setSubtitleTrack(trackId: number | null): Promise<void> {
    await this.ipc?.setProperty("sid", trackId ?? "no");
  }

  async setAudioTrack(trackId: number): Promise<void> {
    await this.ipc?.setProperty("aid", trackId);
  }

  async setVolume(volume: number): Promise<void> {
    await this.ipc?.setProperty("volume", Math.max(0, Math.min(130, Math.round(volume))));
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.ipc?.setProperty("pause", paused);
  }

  /**
   * `fit` = default letterbox; `fill` = zoom until the picture is covered, cropping overflow
   * (`panscan`); `16:9` / `4:3` force the display aspect regardless of the stream's own.
   */
  async setAspect(mode: "fit" | "fill" | "16:9" | "4:3"): Promise<void> {
    if (!this.ipc) return;
    await this.ipc.setProperty("video-aspect-override", mode === "16:9" || mode === "4:3" ? mode : "-1");
    await this.ipc.setProperty("panscan", mode === "fill" ? 1 : 0);
  }

  /** Absolute seek, used to resume a movie/episode at its saved `playback_progress` position. */
  async seek(seconds: number): Promise<void> {
    await this.ipc?.command(["seek", seconds, "absolute"]);
  }

  /**
   * Hook for pushing an explicit video rectangle to mpv. With the child-BrowserWindow
   * approach (see main/videoRegionWindow.ts) the *window* mpv is embedded in is resized
   * instead, and mpv fills its client area automatically — so this stays a no-op unless a
   * future floating/PiP mode needs mpv positioned independently of its host window.
   */
  async setBounds(_bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
    // intentionally empty — see doc comment
  }

  private clearLoadListeners(): void {
    for (const dispose of this.disposeListeners) dispose();
    this.disposeListeners = [];
  }

  async stop(): Promise<void> {
    this.loadGeneration += 1; // invalidate any in-flight load
    this.clearLoadListeners();
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.ipc?.close();
    this.ipc = null;
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
  }
}

function isDecodedVideoParams(value: unknown): boolean {
  return typeof value === "object" && value !== null && typeof (value as { w?: unknown }).w === "number" && (value as { w: number }).w > 0;
}

function mapTracks(value: unknown): MpvTrack[] {
  if (!Array.isArray(value)) return [];
  const tracks: MpvTrack[] = [];
  for (const raw of value as RawMpvTrack[]) {
    if (raw.type !== "video" && raw.type !== "audio" && raw.type !== "sub") continue;
    tracks.push({
      id: raw.id,
      type: raw.type,
      ...(raw.title !== undefined ? { title: raw.title } : {}),
      ...(raw.lang !== undefined ? { lang: raw.lang } : {}),
      ...(raw.codec !== undefined ? { codec: raw.codec } : {}),
      selected: raw.selected === true,
    });
  }
  return tracks;
}
