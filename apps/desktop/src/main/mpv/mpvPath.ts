import { app } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolves the bundled `mpv.exe`. In dev it lives in the repo at
 * `apps/desktop/resources/mpv/`; when packaged, electron-builder's `extraResources` copies
 * that directory to `<app>/resources/mpv/` (see electron-builder.yml). It is fetched
 * manually, once — see `scripts/fetch-mpv.md` — and never committed.
 */
export function resolveMpvPath(): string {
  const candidate = app.isPackaged
    ? join(process.resourcesPath, "mpv", "mpv.exe")
    : join(app.getAppPath(), "resources", "mpv", "mpv.exe");

  if (!existsSync(candidate)) {
    throw new Error(
      `mpv.exe not found at ${candidate}. Follow scripts/fetch-mpv.md to download it into apps/desktop/resources/mpv/.`,
    );
  }
  return candidate;
}
