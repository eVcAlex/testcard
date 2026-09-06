# ADR 0002: A frameless child window for the mpv video region

## Status

Accepted (overlay-window section provisional — see Consequences)

## Context

ADR 0001 commits to mpv rendering into the app via `--wid=<HWND>`. mpv fills the **entire
client area** of whatever HWND it is handed, so it cannot be pointed at the main window — the
sidebar, channel grid and control strip have to sit outside the picture. Something has to own an
HWND that covers only the picture rect.

The first attempt handed mpv a child HWND created inside the main window. Video decoded (the log
showed `d3d11va` hardware decode and the correct `Window size`) but **nothing was visible** —
audio only. Chromium on Windows composites its own output through DirectComposition, and DWM
paints that surface over the full client area regardless of where a foreign child HWND sits in
the z-order. The mpv window was behind Chromium's compositor output the whole time.

## Decision

Run the video region as a **second, frameless, non-focusable child `BrowserWindow`**
(`VideoRegionWindow`), created with `parent: mainWindow`. Nothing is ever loaded into it — it
exists purely as a native surface. mpv's HWND is `SetParent`'d into it by `--wid`. The renderer
measures the picture-well rect (`PictureWell.tsx`, one `ResizeObserver`) and the main process
keeps the child window's bounds matched to it, offset by the main window's content origin.

Two flags carry the fix:

- **`transparent: true`** (+ `backgroundColor: "#00000000"`). This is load-bearing, not
  cosmetic. It forces Chromium off DirectComposition onto a layered-window software-composite
  path, so there is no DWM surface painted over the whole client area, and the mpv sibling HWND
  shows through. Removing it brings the occlusion back.
- **`parent:`**. On Windows, Electron's `parent` is an *owned top-level window* (not a
  `WS_CHILD`): always above its owner, minimises/restores/moves with it, never a separate
  taskbar or alt-tab entry (`skipTaskbar: true` as well). `focusable: false` keeps keyboard
  focus in the main window.

`VideoRegionWindow` listens to nine parent events (`move`, `resize`, `will-resize`, `maximize`,
`unmaximize`, `restore`, `minimize`, `hide`, `show`) to track the rect. During a live
drag-resize it hides the child and re-shows it 120 ms after the last `will-resize` — a brief
black gap reads better than a smeared video rect trying to chase the drag.

### Three window background colours, on purpose

| Value | Where | Why |
|---|---|---|
| `#171a1e` | `main/index.ts` `backgroundColor` | the resize-gutter colour — must equal `--surface-1`, the app background |
| `#000000` | `--picture` token, the well | true black hides any 1 px mismatch between the CSS rect and the HWND bounds |
| `#00000000` | `VideoRegionWindow` (and any future overlay) | load-bearing transparency, per above |

They are not redundant and "cleaning them up" to one value reintroduces a bug.

## Consequences

- HTML still cannot be composited on the video surface (ADR 0001). Transient overlays need
  either mpv's OSD or a **third** owned window — a transparent sibling of the video-region
  window, kept above it with `moveTop()`. That overlay window is planned but not yet built; its
  z-order behaviour across maximize / monitor changes / alt-tab is the open risk, and this ADR
  will be amended once the spike settles. The always-present control strip in the player view is
  the accessible surface regardless of that outcome (an overlay would be `focusable: false`, so
  invisible to keyboard and AT).
- Rect-tracking maths depends on `zoomFactor: 1` in every renderer, so 1 CSS px == 1 DIP and the
  measured rect maps straight through `getContentBounds()`.
- Second-monitor / DPI changes: `getContentBounds()` is in DIPs and survives, but Chromium can
  fire `resize` before the renderer re-measures — `screen.on("display-metrics-changed")` forces
  a re-measure round trip.
- If child-window compositing regresses on a future Electron or Windows build, ADR 0001's
  fallback stands: a libmpv N-API addon rendering into a `<canvas>`.
