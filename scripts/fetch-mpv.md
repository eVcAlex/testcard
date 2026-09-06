# Fetching the mpv runtime (manual, one-time)

Not automated or run by any install script — you should fetch and verify this yourself rather
than have a script silently pull and execute a third-party binary.

1. Open the latest shinchiro Windows build release:
   https://github.com/shinchiro/mpv-winbuild-cmake/releases/latest
   (this is the build linked from mpv.io's install page; SourceForge is no longer listed).
2. Download the asset named `mpv-x86_64-<date>-git-<sha>.7z`.
   - **Not** `mpv-dev-*` — that's the libmpv SDK and has no `mpv.exe`.
   - **Not** `mpv-x86_64-v3-*` unless you know your CPU supports AVX2 (the `v3` build
     crashes on older processors).
   - `aarch64` / `i686` builds are for other architectures — ignore them.
3. Verify the download against the `sha256:` value printed next to the asset on the release
   page (`Get-FileHash <file> -Algorithm SHA256` in PowerShell).
4. Extract the `.7z` and copy `mpv.exe` (from the archive root) into
   `apps/desktop/resources/mpv/` so you have `apps/desktop/resources/mpv/mpv.exe`.
5. Optional sanity check: `apps\desktop\resources\mpv\mpv.exe --version`.

`apps/desktop/resources/mpv/` is gitignored — it is never committed. `electron-builder`'s
`extraResources` config picks it up at package time from that path, and `dev` mode points
`MpvPlayer` at the same location (see `apps/desktop/src/main/mpv/mpvPath.ts`).

Once it's in place, `pnpm dev` can exercise real playback end to end — that's the first real
test of ADR 0001's `--wid` approach, and per the plan it should happen before the full channel
grid UI is built.
