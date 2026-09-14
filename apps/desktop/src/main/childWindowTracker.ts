import type { BrowserWindow } from "electron";
import type { VideoRegionRect } from "../shared/ipc.js";

/**
 * Keeps a frameless owned child window pinned to a rectangle inside its parent's content area.
 * Extracted from VideoRegionWindow so the video-region window and the (planned) overlay window
 * can each own one — see ADR 0002.
 *
 * The rect comes from the renderer in CSS pixels (PictureWell.tsx measures it); with the
 * renderer's zoomFactor pinned to 1, 1 CSS px == 1 DIP, so it maps straight through
 * getContentBounds() once offset by the parent's content origin.
 */
export class ChildWindowTracker {
  private rect: VideoRegionRect | null = null;
  private wantVisible = false;
  private resizeSettleTimer: NodeJS.Timeout | null = null;

  private readonly onBoundsChange = () => this.reposition();
  private readonly onWillResize = () => this.hideDuringResize();
  private readonly onParentHide = () => this.child.hide();
  private readonly onParentShow = () => {
    if (this.wantVisible) this.showNow();
    else this.reposition();
  };
  // Fullscreen resizes the parent without a `will-resize`; the content bounds settle a beat
  // after the event, so re-measure on the next tick as well as immediately.
  private readonly onFullscreenChange = () => {
    this.onParentShow();
    setTimeout(() => this.onParentShow(), 60);
  };

  constructor(
    private readonly parent: BrowserWindow,
    private readonly child: BrowserWindow,
  ) {
    parent.on("move", this.onBoundsChange);
    parent.on("resize", this.onBoundsChange);
    parent.on("will-resize", this.onWillResize);
    parent.on("maximize", this.onBoundsChange);
    parent.on("unmaximize", this.onBoundsChange);
    parent.on("restore", this.onParentShow);
    parent.on("minimize", this.onParentHide);
    parent.on("hide", this.onParentHide);
    parent.on("show", this.onParentShow);
    parent.on("enter-full-screen", this.onFullscreenChange);
    parent.on("leave-full-screen", this.onFullscreenChange);
  }

  /** The renderer's latest measured rect. Repositions but does not change visibility. */
  setRect(rect: VideoRegionRect): void {
    this.rect = rect;
    this.reposition();
  }

  /** Whether the child should be on screen. Survives a resize-settle cycle. */
  setVisible(visible: boolean): void {
    this.wantVisible = visible;
    if (visible) this.showNow();
    else this.child.hide();
  }

  reposition(): void {
    if (this.child.isDestroyed() || this.parent.isDestroyed() || !this.rect) return;
    if (!this.parent.isVisible() || this.parent.isMinimized()) return;

    const content = this.parent.getContentBounds();
    this.child.setBounds({
      x: Math.round(content.x + this.rect.x),
      y: Math.round(content.y + this.rect.y),
      width: Math.max(1, Math.round(this.rect.width)),
      height: Math.max(1, Math.round(this.rect.height)),
    });
  }

  private showNow(): void {
    if (this.child.isDestroyed() || !this.rect) return;
    this.reposition();
    this.child.showInactive(); // visible, never takes focus
  }

  private hideDuringResize(): void {
    // The child can't keep pixel-perfect pace with a live drag-resize; a brief black gap
    // reads better than a smeared rect. Hide now, re-show 120ms after the last will-resize.
    if (this.child.isDestroyed()) return;
    this.child.hide();
    if (this.resizeSettleTimer) clearTimeout(this.resizeSettleTimer);
    this.resizeSettleTimer = setTimeout(() => {
      this.resizeSettleTimer = null;
      if (this.wantVisible && !this.parent.isDestroyed() && this.parent.isVisible()) this.showNow();
    }, 120);
  }

  destroy(): void {
    if (this.resizeSettleTimer) clearTimeout(this.resizeSettleTimer);
    this.resizeSettleTimer = null;
    if (this.parent.isDestroyed()) return;
    this.parent.off("move", this.onBoundsChange);
    this.parent.off("resize", this.onBoundsChange);
    this.parent.off("will-resize", this.onWillResize);
    this.parent.off("maximize", this.onBoundsChange);
    this.parent.off("unmaximize", this.onBoundsChange);
    this.parent.off("restore", this.onParentShow);
    this.parent.off("minimize", this.onParentHide);
    this.parent.off("hide", this.onParentHide);
    this.parent.off("show", this.onParentShow);
    this.parent.off("enter-full-screen", this.onFullscreenChange);
    this.parent.off("leave-full-screen", this.onFullscreenChange);
  }
}
