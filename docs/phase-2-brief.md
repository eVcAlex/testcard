# Phase 2 brief

Paste this to a new agent/session to continue Testcard.

---

Continue work on Testcard (Documents/GitHub/testcard, github.com/eVcAlex/testcard — private).
This is Phase 2. Phase 1 (repo scaffold, core parsing/DB layer, Electron shell, typed IPC,
credential storage) is done and pushed to main.

FIRST, READ (in this order):
1. CONTEXT.md — domain glossary
2. docs/adr/0001-mpv-playback-engine.md — why mpv over Chromium, and its "Known limitation"
   note on HTML not compositing over the mpv surface
3. README.md — current status and the better-sqlite3 ABI gotcha
4. apps/desktop/src/main/mpv/mpvProcess.ts and mpvIpc.ts — already written, not yet wired up
5. apps/desktop/src/main/ipc.ts — playback.* methods are stubs throwing "not wired up yet"

GOAL: get a real channel from Alex's Xtream provider playing, video + audio, inside the app
window — specifically "TNT Sports Ultimate" (HEVC + E-AC-3, 2160p50), since that's the
channel that validates the whole mpv-over-Chromium architecture decision (see ADR 0001).
A channel that's dead/times out (e.g. anything that hangs >10s) should show a "didn't
respond" state with Retry and Open-in-VLC, not hang the UI.

PREREQUISITE (manual, ask Alex to do this before you start, don't script it yourself):
follow scripts/fetch-mpv.md — download mpv.exe into apps/desktop/resources/mpv/.

TASK 1 — solve the video-region embedding problem (do this first; it may reshape the rest)
mpv's --wid fills the ENTIRE client area of whatever HWND it's given. The main window has
HTML controls that need to sit outside the video (bottom bar, per the reference screenshot
in this project's history), so mpv can't just target the main window's handle.
Recommended approach to try first — pure Electron APIs, no native addon or raw Win32 child
windows: create a second `BrowserWindow` with `{ parent: mainWindow, frame: false }`, sized
and positioned to exactly cover the video region of the main window's layout, and pass ITS
`getNativeWindowHandle()` to mpv's --wid instead of the main window's. Keep it synced to the
main window's 'move'/'resize' events (and to layout changes like a sidebar collapsing).
Validate this actually works on Windows (child BrowserWindow z-ordering, focus stealing,
whether it visually reads as "docked" rather than "a separate window") before building
anything else on top of it. If it doesn't hold up, the fallback is a native addon doing raw
Win32 child-window creation + SetWindowPos — significantly more work, so it's worth real
effort to make the BrowserWindow approach work first.

TASK 2 — wire src/main/ipc.ts's playback.* methods to MpvPlayer
- On first play(), instantiate MpvPlayer with the resolved mpv.exe path and start() it
  against the video-region window handle from Task 1.
- play(channelId, variantId?): resolve the channel/variant from SQLite, get the stream URL
  via the source adapter's buildStreamUrl (credentials never leave main — see
  credentials.ts), call MpvPlayer.play(url).
- Listen for MpvPlayer's "timeout" event and surface it to the renderer (a new IPC
  event/callback, not just the request/response pattern the rest of the API uses — you'll
  need ipcMain -> webContents.send for this, since it's main-initiated).
- setSubtitleTrack / setAudioTrack: straightforward passthrough to MpvPlayer.

TASK 3 — minimal playback UI
Doesn't need to be the full channel grid (that's Phase 3 / plan step 6) — just enough to
exercise the above: pick a channel from the existing AddSourceForm-adjacent list, a play
button, the docked video region from Task 1, a control bar below it (play/pause, volume,
subtitle/audio track dropdowns once mpv reports available tracks), and the dead-channel
state (10s timeout -> "Channel didn't respond" + Retry + Open in VLC, per CONTEXT.md).

VERIFICATION (this is the real test, not a formality):
- TNT Sports Ultimate (ᵁᴴᴰ ᴴᴰᴿ, HEVC + E-AC-3 5.1 @ 2160p50) plays with BOTH video and
  audio, hardware-decoded. If this fails, the mpv architecture itself needs revisiting —
  don't paper over it.
- Subtitle and audio track switching works on a channel that has them.
- A known-dead channel (anything that hangs) fails within ~10s with Retry / Open in VLC,
  and never freezes the rest of the UI.
- `pnpm --filter @testcard/desktop typecheck`, `npx oxlint .` from repo root, and
  `pnpm --filter @testcard/desktop build` all still pass before calling this done.

Do NOT start on the full channel-grid/sidebar UI (country tree, quality-variant picker in
the list, search) — that's Phase 3, deliberately sequenced after playback because it's the
higher-risk piece per the plan (C:\Users\Administrator\.claude\plans\
hey-i-essensially-want-splendid-garden.md has the full rationale if wanted).
