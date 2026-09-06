import { BrowserWindow } from "electron";

/** A viewport-relative rectangle in CSS pixels, as measured by the renderer. */
export interface VideoRegionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * mpv's `--wid` fills the *entire* client area of whatever HWND it's handed, so it can't
 * target the main window (the transport bar and channel list need to sit outside the
 * picture). This owns a second, frameless, non-focusable child BrowserWindow whose only job
 * is to own an HWND that exactly covers the picture region of the main window's layout —
 * that handle is what gets passed to mpv.
 *
 * See ADR 0001. If child-window z-ordering against Chromium's own compositor turns out not
 * to hold up on Windows, the fallback is a libmpv N-API addon rendering into a <canvas>.
 */
export class VideoRegionWindow {
  private window: BrowserWindow | null = null;
  private lastRect: VideoRegionRect | null = null;
  private resizeSettleTimer: NodeJS.Timeout | null = null;
  private readonly onParentBoundsChange = () => this.reposition();
  private readonly onParentWillResize = () => this.hideDuringResize();
  private readonly onParentHide = () => this.window?.hide();
  private readonly onParentShow = () => {
    if (this.lastRect) this.reposition();
  };

  constructor(private readonly parent: BrowserWindow) {
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
      // the mpv sibling HWND shows through.
      transparent: true,
      backgroundColor: "#00000000",
      // No preload, no webPreferences of note — nothing is ever loaded into this window.
      // It exists purely as a native surface for mpv to render into.
      webPreferences: { zoomFactor: 1, sandbox: true, javascript: false, images: false },
    });

    // Load nothing. A blank window still has a valid HWND; keeping Chromium from painting
    // any document into it is the first mitigation against it occluding the mpv surface.

    parent.on("move", this.onParentBoundsChange);
    parent.on("resize", this.onParentBoundsChange);
    parent.on("will-resize", this.onParentWillResize);
    parent.on("maximize", this.onParentBoundsChange);
    parent.on("unmaximize", this.onParentBoundsChange);
    parent.on("restore", this.onParentShow);
    parent.on("minimize", this.onParentHide);
    parent.on("hide", this.onParentHide);
    parent.on("show", this.onParentShow);
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
    this.lastRect = rect;
    this.reposition();
  }

  show(): void {
    if (!this.window || !this.lastRect) return;
    this.reposition();
    this.window.showInactive(); // visible, but does not take focus
  }

  hide(): void {
    this.window?.hide();
  }

  private hideDuringResize(): void {
    // The child window can't keep pixel-perfect pace with a live drag-resize of the parent,
    // and a smeared video rect looks worse than a brief black gap. Hide now, settle after.
    this.window?.hide();
    if (this.resizeSettleTimer) clearTimeout(this.resizeSettleTimer);
    this.resizeSettleTimer = setTimeout(() => {
      this.resizeSettleTimer = null;
      if (this.parent.isVisible() && this.lastRect) {
        this.reposition();
        this.window?.showInactive();
      }
    }, 120);
  }

  private reposition(): void {
    if (!this.window || !this.lastRect || this.parent.isDestroyed()) return;
    if (!this.parent.isVisible() || this.parent.isMinimized()) return;

    // Electron window bounds and getContentBounds() are in DIPs; with zoomFactor pinned to 1
    // in the renderer, 1 CSS px == 1 DIP, so the renderer's measured rect maps straight
    // through once offset by the main window's content origin.
    const content = this.parent.getContentBounds();
    this.window.setBounds({
      x: Math.round(content.x + this.lastRect.x),
      y: Math.round(content.y + this.lastRect.y),
      width: Math.max(1, Math.round(this.lastRect.width)),
      height: Math.max(1, Math.round(this.lastRect.height)),
    });
  }

  destroy(): void {
    if (this.resizeSettleTimer) clearTimeout(this.resizeSettleTimer);
    if (!this.parent.isDestroyed()) {
      this.parent.off("move", this.onParentBoundsChange);
      this.parent.off("resize", this.onParentBoundsChange);
      this.parent.off("will-resize", this.onParentWillResize);
      this.parent.off("maximize", this.onParentBoundsChange);
      this.parent.off("unmaximize", this.onParentBoundsChange);
      this.parent.off("restore", this.onParentShow);
      this.parent.off("minimize", this.onParentHide);
      this.parent.off("hide", this.onParentHide);
      this.parent.off("show", this.onParentShow);
    }
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}
