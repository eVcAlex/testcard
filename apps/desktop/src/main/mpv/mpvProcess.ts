import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { app } from "electron";
import { MpvIpcClient } from "./mpvIpc.js";

/** How long to wait for the first video frame before treating a stream as dead. See ADR 0001 / CONTEXT.md "Dead channel". */
export const PLAYBACK_TIMEOUT_MS = 10_000;

export type MpvEvent =
  | { readonly type: "playing" }
  | { readonly type: "timeout" }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "exited"; readonly code: number | null };

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
        "--no-osc",
        "--no-input-default-bindings",
        "--idle=yes",
        "--force-window=yes",
        "--hwdec=auto-safe",
        "--profile=low-latency",
        "--cache=yes",
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

    await ipc.observeProperty("core-idle");
    let resolved = false;
    const unsubscribe = ipc.onPropertyChange("core-idle", (idle) => {
      if (idle === false && !resolved) {
        resolved = true;
        if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
        this.emit("event", { type: "playing" });
      }
    });

    this.timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsubscribe();
        this.emit("event", { type: "timeout" });
      }
    }, PLAYBACK_TIMEOUT_MS);

    await ipc.command(["loadfile", streamUrl, "replace"]);
  }

  async setSubtitleTrack(trackId: number | null): Promise<void> {
    await this.ipc?.setProperty("sid", trackId ?? false);
  }

  async setAudioTrack(trackId: number): Promise<void> {
    await this.ipc?.setProperty("aid", trackId);
  }

  /** Repositions the mpv window to match the video region of the app window on resize/move. */
  async setBounds(_bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
    // mpv's --wid surface tracks the parent HWND's client area automatically once embedded;
    // this hook exists for the case (a floating/PiP mode, or a transparent overlay window
    // per ADR 0001) where bounds need to be pushed explicitly. No-op until that lands.
  }

  async stop(): Promise<void> {
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
