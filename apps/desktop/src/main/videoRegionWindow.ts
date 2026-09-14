import { BrowserWindow } from "electron";
import { ChildWindowTracker } from "./childWindowTracker.js";
import type { VideoRegionRect } from "../shared/ipc.js";

/**
 * mpv's `--wid` fills the *entire* client area of whatever HWND it's handed, so it can't
 * target the main window (the sidebar, channel grid and control strip need to sit outside the
 * picture). This owns a second, frameless, non-focusable child BrowserWindow whose only job
 * is to own an HWND that exactly covers the picture region of the main window's layout —
 * that handle is what gets passed to mpv. A ChildWindowTracker keeps it aligned; see ADR 0002.
 */
export class VideoRegionWindow {
  private window: BrowserWindow | null = null;
  private tracker: ChildWindowTracker | null = null;

  constructor(parent: BrowserWindow) {
    this.window = new BrowserWindow({
      parent,
      show: false,
      frame: false,
      focusable: false, // must never steal keyboard focus from the main window
      skipTaskbar: true, // not a separate entry in the taskbar / alt-tab
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      // `transparent` is load-bearing, not cosmetic: it forces Chromium onto a layered-window
      // software-composite path instead of DirectComposition. DirectComposition's surface is
      // composited by DWM over the whole client area regardless of child-HWND z-order, which
      // would paint over the mpv window SetParent'd in here. With nothing ever loaded into
      // this window there's no web content to actually be transparent — it's purely a hole
      // the mpv sibling HWND shows through. See ADR 0002.
      transparent: true,
      backgroundColor: "#00000000",
      // No preload, nothing is ever loaded into this window. It exists purely as a native
      // surface for mpv to render into.
      webPreferences: { zoomFactor: 1, sandbox: true, javascript: false, images: false },
    });

    this.tracker = new ChildWindowTracker(parent, this.window);
    parent.on("closed", () => this.destroy());
  }

  /** The native window handle to hand to mpv's `--wid`. */
  nativeHandle(): number {
    if (!this.window) throw new Error("video region window has been destroyed");
    const buffer = this.window.getNativeWindowHandle();
    // win32 x64: HWND is a 64-bit pointer. Older/32-bit: 4 bytes.
    return buffer.length === 8 ? Number(buffer.readBigUInt64LE(0)) : buffer.readUInt32LE(0);
  }

  /** Called with the renderer's measured picture-well rect (viewport CSS px). */
  setRegion(rect: VideoRegionRect): void {
    this.tracker?.setRect(rect);
  }

  show(): void {
    this.tracker?.setVisible(true);
  }

  hide(): void {
    this.tracker?.setVisible(false);
  }

  destroy(): void {
    this.tracker?.destroy();
    this.tracker = null;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}
