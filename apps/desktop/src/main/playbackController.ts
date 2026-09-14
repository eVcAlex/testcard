import type { BrowserWindow } from "electron";
import type Database from "better-sqlite3";
import { Conf } from "electron-conf/main";
import { getPlaybackTarget, recordRecent, type PlaybackTarget, type SourceAdapter } from "@testcard/core";
import {
  IPC_EVENT_CHANNEL,
  type AspectMode,
  type PlaybackEvent,
  type PlaybackSnapshot,
  type PlaybackTrack,
  type VideoRegionRect,
} from "../shared/ipc.js";
import { MpvPlayer, type MpvEvent, type MpvTrack } from "./mpv/mpvProcess.js";
import { resolveMpvPath } from "./mpv/mpvPath.js";
import { VideoRegionWindow } from "./videoRegionWindow.js";
import { OverlayWindow } from "./overlayWindow.js";
import { openInVlc as spawnVlc } from "./externalPlayer.js";

interface Adapters {
  readonly xtream: SourceAdapter;
  readonly m3u: SourceAdapter;
}

/**
 * Bridges the renderer's `playback.*` IPC calls to the embedded mpv process. Owns the mpv
 * child, the frameless child window it renders into, and the playback state (channel, tracks,
 * paused, volume) that both the main window and — later — the overlay window read. Kept
 * separate from ipc.ts so that file stays a thin dispatcher.
 *
 * paused/volume live here, not in the renderer: the overlay is a second view of the same
 * state, and keeping `paused` here also fixes it silently surviving a channel change.
 */
export class PlaybackController {
  private mpv: MpvPlayer | null = null;
  private region: VideoRegionWindow | null = null;
  private overlay: OverlayWindow | null = null;
  private lastRegionRect: VideoRegionRect | null = null;
  private current: { target: PlaybackTarget; streamUrl: string } | null = null;

  private status: PlaybackSnapshot["status"] = "idle";
  private tracks: PlaybackTrack[] = [];
  private paused = false;
  private volume: number;
  private aspect: AspectMode;
  private readonly conf = new Conf<{ volume: number; aspect: AspectMode }>();

  private fullscreen = false;
  private readonly onEnterFullscreen = () => this.setFullscreen(true);
  private readonly onLeaveFullscreen = () => this.setFullscreen(false);

  constructor(
    private readonly db: Database.Database,
    private readonly mainWindow: BrowserWindow,
    private readonly adapters: Adapters,
  ) {
    this.volume = clampVolume(this.conf.get("volume", 100));
    this.aspect = this.conf.get("aspect", "fit");
    this.fullscreen = mainWindow.isFullScreen();
    mainWindow.on("enter-full-screen", this.onEnterFullscreen);
    mainWindow.on("leave-full-screen", this.onLeaveFullscreen);
  }

  private setFullscreen(fullscreen: boolean): void {
    this.fullscreen = fullscreen;
    this.emit({ type: "fullscreen", fullscreen });
    this.syncOverlay();
  }

  /**
   * The transport controls are an on-video overlay in both windowed and fullscreen mode — HTML
   * can't composite over the mpv window, so it's a transparent child window over the video
   * (ADR 0002). Shown whenever a channel is tuning or playing.
   */
  private syncOverlay(): void {
    const wanted = this.status === "playing" || this.status === "loading";
    if (wanted) {
      if (!this.overlay) {
        this.overlay = new OverlayWindow(this.mainWindow);
        if (this.lastRegionRect) this.overlay.setRegion(this.lastRegionRect);
      }
      this.overlay.show();
    } else if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
    }
  }

  async play(channelId: string, variantId?: string): Promise<void> {
    const target = getPlaybackTarget(this.db, channelId, variantId);
    if (!target) throw new Error("That channel could not be found.");

    const adapter = target.source.kind === "xtream" ? this.adapters.xtream : this.adapters.m3u;
    const streamUrl = await adapter.buildStreamUrl(target.source, target.variant);
    this.current = { target, streamUrl };
    this.tracks = [];

    // A fresh channel always starts unpaused; the renderer no longer has to track this.
    this.paused = false;
    this.emit({ type: "paused", paused: false });

    await this.ensureStarted();
    this.status = "loading";
    this.syncOverlay();
    this.emit({ type: "loading", channelId, channelName: target.channelName });
    await this.mpv!.setVolume(this.volume);
    await this.mpv!.setPaused(false);
    await this.mpv!.setAspect(this.aspect);
    await this.mpv!.play(streamUrl);
  }

  async stop(): Promise<void> {
    this.current = null;
    this.tracks = [];
    this.status = "idle";
    this.syncOverlay();
    this.region?.hide();
    await this.mpv?.stop();
    this.mpv = null;
    this.emit({ type: "stopped" });
  }

  setVideoRegion(rect: VideoRegionRect): void {
    this.lastRegionRect = rect;
    this.region?.setRegion(rect);
    this.overlay?.setRegion(rect);
  }

  async setVolume(volume: number): Promise<void> {
    this.volume = clampVolume(volume);
    this.conf.set("volume", this.volume);
    await this.mpv?.setVolume(this.volume);
    this.emit({ type: "volume", volume: this.volume });
  }

  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
    await this.mpv?.setPaused(paused);
    this.emit({ type: "paused", paused });
  }

  async setAspect(aspect: AspectMode): Promise<void> {
    this.aspect = aspect;
    this.conf.set("aspect", aspect);
    await this.mpv?.setAspect(aspect);
    this.emit({ type: "aspect", aspect });
  }

  async setSubtitleTrack(trackId: number | null): Promise<void> {
    await this.mpv?.setSubtitleTrack(trackId);
  }

  async setAudioTrack(trackId: number): Promise<void> {
    await this.mpv?.setAudioTrack(trackId);
  }

  async openInVlc(): Promise<void> {
    if (!this.current) throw new Error("No channel is selected.");
    await spawnVlc(this.current.streamUrl);
  }

  snapshot(): PlaybackSnapshot {
    return {
      status: this.status,
      channelId: this.current?.target.channelId ?? null,
      channelName: this.current?.target.channelName ?? null,
      tracks: this.tracks,
      paused: this.paused,
      volume: this.volume,
      aspect: this.aspect,
      fullscreen: this.mainWindow.isFullScreen(),
    };
  }

  /** Overlay → main window. The main window owns the browse list, so it does the stepping. */
  channelStep(delta: number): void {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_EVENT_CHANNEL, { type: "channel-step", delta });
    }
  }

  exitPlayer(): void {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_EVENT_CHANNEL, { type: "exit-player" });
    }
  }

  dispose(): void {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.off("enter-full-screen", this.onEnterFullscreen);
      this.mainWindow.off("leave-full-screen", this.onLeaveFullscreen);
    }
    void this.mpv?.stop();
    this.mpv = null;
    // Overlay before region: no frame with the bar sitting over bare bezel.
    this.overlay?.destroy();
    this.overlay = null;
    this.region?.destroy();
    this.region = null;
  }

  isFullscreen(): boolean {
    return this.mainWindow.isFullScreen();
  }

  toggleFullscreen(): void {
    this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
  }

  private async ensureStarted(): Promise<void> {
    if (!this.region) {
      this.region = new VideoRegionWindow(this.mainWindow);
      if (this.lastRegionRect) this.region.setRegion(this.lastRegionRect);
    }
    if (!this.mpv) {
      this.mpv = new MpvPlayer(resolveMpvPath());
      this.mpv.on("event", (event) => this.onMpvEvent(event));
      await this.mpv.start(this.region.nativeHandle());
    }
  }

  private onMpvEvent(event: MpvEvent): void {
    const channelId = this.current?.target.channelId;

    switch (event.type) {
      case "playing":
        if (!channelId) return;
        this.status = "playing";
        recordRecent(this.db, channelId);
        this.region?.show();
        this.syncOverlay();
        this.emit({ type: "playing", channelId });
        break;
      case "tracks":
        if (!channelId) return;
        this.tracks = toPlaybackTracks(event.tracks);
        this.emit({ type: "tracks", channelId, tracks: this.tracks });
        break;
      case "timeout":
        if (!channelId) return;
        this.status = "dead";
        this.syncOverlay();
        this.region?.hide();
        this.emit({ type: "timeout", channelId });
        break;
      case "error":
        if (!channelId) return;
        this.status = "dead";
        this.syncOverlay();
        this.region?.hide();
        this.emit({ type: "error", channelId, message: event.message });
        break;
      case "exited":
        this.status = "dead";
        this.syncOverlay();
        this.region?.hide();
        this.mpv = null;
        if (channelId) this.emit({ type: "error", channelId, message: "The player stopped unexpectedly." });
        break;
      case "loading":
        break;
    }
  }

  private emit(event: PlaybackEvent): void {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_EVENT_CHANNEL, event);
    }
    this.overlay?.webContents?.send(IPC_EVENT_CHANNEL, event);
  }
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(130, Math.round(value)));
}

function toPlaybackTracks(tracks: readonly MpvTrack[]): PlaybackTrack[] {
  return tracks.map((track) => ({
    id: track.id,
    type: track.type,
    label: trackLabel(track),
    ...(track.codec !== undefined ? { codec: track.codec.toUpperCase() } : {}),
    selected: track.selected,
  }));
}

function trackLabel(track: MpvTrack): string {
  const parts: string[] = [];
  if (track.lang) parts.push(track.lang.toUpperCase());
  if (track.title) parts.push(track.title);
  if (track.codec) parts.push(track.codec.toUpperCase());
  return parts.length > 0 ? parts.join(" · ") : `Track ${track.id}`;
}
