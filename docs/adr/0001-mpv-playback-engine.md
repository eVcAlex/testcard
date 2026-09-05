# ADR 0001: Embedded mpv over Chromium `<video>` for playback

## Status

Accepted

## Context

Electron's renderer is Chromium, so the obvious playback path is a `<video>` element fed by
`mpegts.js` (transmuxing the provider's raw MPEG-TS to fMP4 in JS, no native code at all).

We probed the actual provider this app targets. Two sampled channels were H.264 + AAC, which
`mpegts.js` handles fine. But the provider's flagship UHD channel (`TNT Sports Ultimate ᵁᴴᴰ ᴴᴰᴿ`)
is **HEVC video + E-AC-3 5.1 audio at 2160p50** — confirmed by parsing the MPEG-TS PMT table
directly off the wire.

Electron's bundled Chromium ships without AC-3/E-AC-3 decoding by default (needs the
`enable_platform_ac3_eac3_audio` build flag — see electron/electron#48819, open as of this
writing) and HEVC decoding on Windows is conditional on a hardware decoder even when available.
Practically: **the channel that matters most would have no audio, ever**, under a
Chromium-only architecture. "Open in VLC" would have been the real product.

Subtitle tracks and audio-track switching (DVB subtitles embedded in the MPEG-TS) are also
invisible to Chromium's demuxer but are exposed natively by mpv.

## Decision

Ship `mpv.exe` as a bundled resource. Launch it as a child process rendering into the app
window via `--wid=<HWND>`, controlled over mpv's JSON IPC (a named pipe) for play/pause/volume/
subtitle-track/audio-track/seek. No native C/C++ addon, no custom Electron build.

## Consequences

- Full codec coverage (HEVC, E-AC-3, whatever mpv supports) with hardware decoding, for the
  cost of shipping and version-pinning an mpv binary.
- HTML cannot be composited on top of the mpv video surface — transient overlays (stream-info
  chips, centre play/pause) need mpv's own OSD or a tracked transparent child window; the
  bottom control bar sits outside the video rect and is unaffected.
- If `--wid` compositing proves unworkable in practice, the fallback is a libmpv N-API addon
  rendering decoded frames into a `<canvas>` (what IPTVnator's `embedded_mpv_win32.cc` does) —
  more implementation cost, full HTML overlay freedom. Not the starting point.
