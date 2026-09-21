import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { IPC_UPDATE_CHANNEL, type UpdateState } from "../shared/ipc.js";

/** How often a running app looks for a newer version. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** Let the app finish starting (and the first sync) before the first look. */
const FIRST_CHECK_AFTER_MS = 15_000;

let state: UpdateState = { status: app.isPackaged ? "idle" : "dev", current: app.getVersion() };

function publish(next: UpdateState): UpdateState {
  state = next;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_UPDATE_CHANNEL, state);
  }
  return state;
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// The installer comes from the sync worker's release bucket (electron-builder.yml `publish`), so no
// token or account is involved. Nothing downloads until the viewer asks: a running player must never
// be interrupted, and a large installer must never arrive uninvited.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

autoUpdater.on("update-available", (info) => publish({ ...state, status: "available", latest: info.version, checkedAt: Date.now() }));
autoUpdater.on("update-not-available", () => {
  const { latest: _latest, percent: _percent, message: _message, ...rest } = state;
  publish({ ...rest, status: "idle", checkedAt: Date.now() });
});
autoUpdater.on("download-progress", (progress) => publish({ ...state, status: "downloading", percent: Math.round(progress.percent) }));
autoUpdater.on("update-downloaded", (info) => publish({ ...state, status: "ready", latest: info.version, percent: 100 }));
autoUpdater.on("error", (error) => publish({ ...state, status: "error", message: describe(error), checkedAt: Date.now() }));

export function updateState(): UpdateState {
  return state;
}

export async function checkForUpdate(): Promise<UpdateState> {
  // A download or a finished download is not disturbed by a second look.
  if (state.status === "dev" || state.status === "checking" || state.status === "downloading" || state.status === "ready") return state;
  publish({ ...state, status: "checking" });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publish({ ...state, status: "error", message: describe(error), checkedAt: Date.now() });
  }
  return state;
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (state.status !== "available") return state;
  publish({ ...state, status: "downloading", percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    publish({ ...state, status: "error", message: describe(error) });
  }
  return state;
}

export function installUpdate(): void {
  if (state.status !== "ready") return;
  // Silent off, run after quit off: the installer shows its own window and the app reopens when it is done.
  autoUpdater.quitAndInstall(false, true);
}

/** Looks once shortly after launch and then every few hours. Does nothing in an unpackaged run. */
export function startUpdateChecks(): void {
  if (!app.isPackaged) return;
  setTimeout(() => void checkForUpdate(), FIRST_CHECK_AFTER_MS);
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
}
