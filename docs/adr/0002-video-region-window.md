# ADR 0002: A frameless child window for the mpv video region

## Status

Accepted. The overlay window is built (`main/overlayWindow.ts`); its cross-transition z-order
still needs a manual pass on real hardware — see Consequences.

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

- HTML cannot be composited on the video surface (ADR 0001), so **all** transport controls
  live in a **third** owned window (`OverlayWindow`) — an auto-hiding on-video bar, in both
  windowed and fullscreen mode. It is a transparent sibling of the video-region window
  covering the full picture rect, kept above the mpv HWND with `moveTop()` (on show, twice more
  on a timer, and on parent `focus` / `restore` / `unmaximize`). `PlaybackController`
  creates/destroys it as `status` enters/leaves `loading`/`playing`.
  - The window is interactive; the *page* is the click-through layer — `.ov-root` is a
    transparent catch layer that reveals the bar on movement, and clicks land on the controls
    or on dead space (mpv has no click bindings). This avoids
    `setIgnoreMouseEvents(…, { forward: true })`, whose `mousemove` forwarding to a transparent
    non-focusable child window did not deliver reliably. `backgroundThrottling: false` is
    mandatory or the auto-hide timer runs at ~1 Hz while the window is unfocused.
  - The overlay is `focusable: false`, so keyboard/AT can't reach it. `PlayerView` in the main
    window owns the keyboard shortcuts (Space, ↑/↓ channel, ←/→ volume, F, Esc) as the
    accessible path. Prev/next channel and "back" go overlay → main → a `channel-step` /
    `exit-player` event the main window acts on (it owns the browse list, the overlay doesn't).
  - **Open risk:** `moveTop()` holding the overlay above the mpv HWND across every transition
    (maximize, unmaximize, restore-from-minimise, alt-tab, drag to a second monitor at a
    different DPI) is unverified on real hardware. If a transition defeats it, the fallback is
    `setAlwaysOnTop(true, "normal")` + hiding the overlay on parent `blur`; if that also fails,
    the docked strip is the whole surface and this section records the attempt.
  - The always-present control strip in the player view stays the **accessible** surface
    regardless — the overlay is `focusable: false`, so invisible to keyboard and AT, and every
    overlay action also exists there. paused/volume live in `PlaybackController` so both windows
    are views of one state.
- Rect-tracking maths depends on `zoomFactor: 1` in every renderer, so 1 CSS px == 1 DIP and the
  measured rect maps straight through `getContentBounds()`.
- Second-monitor / DPI changes: `getContentBounds()` is in DIPs and survives, but Chromium can
  fire `resize` before the renderer re-measures — `screen.on("display-metrics-changed")` forces
  a re-measure round trip.
- If child-window compositing regresses on a future Electron or Windows build, ADR 0001's
  fallback stands: a libmpv N-API addon rendering into a `<canvas>`.
