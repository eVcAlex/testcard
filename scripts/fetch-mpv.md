# Fetching the mpv runtime (manual, one-time)

Not automated or run by any install script — you should fetch and verify this yourself rather
than have a script silently pull and execute a third-party binary.

1. Download a Windows mpv build from https://sourceforge.net/projects/mpv-player-windows/files/
   (the "64bit" release builds are the ones to use).
2. Verify the download (checksum on the release page).
3. Unzip it, and copy at least `mpv.exe` into `apps/desktop/resources/mpv/`.
4. `apps/desktop/resources/mpv/` is gitignored — it is never committed; `electron-builder`'s
   `extraResources` config picks it up at package time from that path, and `dev` mode will
   point `MpvPlayer` at the same location (see `apps/desktop/src/main/mpv/`).

Once it's in place, `pnpm dev` can exercise real playback end to end — that's the first real
test of ADR 0001's `--wid` approach, and per the plan it should happen before the full channel
grid UI is built.
