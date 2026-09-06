import { BrowserWindow } from "electron";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { ChildWindowTracker } from "./childWindowTracker.js";
import type { VideoRegionRect } from "../shared/ipc.js";

/**
 * A transparent, non-focusable, owned sibling of the video-region window that carries the
 * on-video transport controls (mockup study 04). It covers the *whole* picture rect — it needs
 * the full area to detect pointer movement — and is click-through by default
 * (`setIgnoreMouseEvents(true, { forward: true })`), flipping interactive only while the
 * pointer is over a control. See ADR 0002 for the z-order model.
 *
 * The accessible transport surface is the docked control strip in the player view; this
 * overlay is a pointer mirror (`focusable: false` => invisible to keyboard and AT).
 */
export class OverlayWindow {
  private window: BrowserWindow | null = null;
  private tracker: ChildWindowTracker | null = null;

  constructor(private readonly parent: BrowserWindow) {
    this.window = new BrowserWindow({
      parent,
      show: false,
      frame: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      thickFrame: false,
      acceptFirstMouse: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      transparent: true,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        sandbox: false,
        zoomFactor: 1,
        // Mandatory: an unfocused window otherwise throttles timers to ~1Hz and the
        // auto-hide animation becomes a slideshow.
        backgroundThrottling: false,
      },
    });

    // Click-through, but keep mousemove flowing so the renderer knows where the pointer is.
    this.window.setIgnoreMouseEvents(true, { forward: true });

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      void this.window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/overlay.html`);
    } else {
      void this.window.loadFile(join(__dirname, "../renderer/overlay.html"));
    }

    this.tracker = new ChildWindowTracker(parent, this.window);

    parent.on("focus", this.raise);
    parent.on("restore", this.raise);
    parent.on("unmaximize", this.raise);
    parent.on("closed", this.onParentClosed);
  }

  private readonly raise = (): void => {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.window.moveTop(); // not setAlwaysOnTop — that floats over other apps and breaks alt-tab
    }
  };

  private readonly onParentClosed = (): void => this.destroy();

  setRegion(rect: VideoRegionRect): void {
    this.tracker?.setRect(rect);
  }

  show(): void {
    this.tracker?.setVisible(true);
    this.raise();
  }

  hide(): void {
    this.tracker?.setVisible(false);
  }

  setInteractive(interactive: boolean): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.setIgnoreMouseEvents(!interactive, interactive ? { forward: false } : { forward: true });
  }

  /** For PlaybackController to fan playback events to this window's renderer. */
  get webContents() {
    return this.window && !this.window.isDestroyed() ? this.window.webContents : null;
  }

  destroy(): void {
    this.tracker?.destroy();
    this.tracker = null;
    if (!this.parent.isDestroyed()) {
      this.parent.off("focus", this.raise);
      this.parent.off("restore", this.raise);
      this.parent.off("unmaximize", this.raise);
      this.parent.off("closed", this.onParentClosed);
    }
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}
