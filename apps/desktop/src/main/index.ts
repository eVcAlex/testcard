import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { registerIpcHandlers, stopActiveRefreshScheduler } from "./ipc.js";
import { getDatabase } from "./database.js";
import { registerLogoProtocol, registerLogoScheme } from "./logoCache.js";

// Privileged schemes must be declared before the app is ready.
registerLogoScheme();

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    // The resize-gutter colour: what shows for a frame when the window grows before the
    // renderer paints. Must equal --background (styles/tokens.css). Not --picture #000000
    // (that's the video hole only) and not the child windows' #00000000 (load-bearing
    // transparency, see ADR 0002). Dark literal here on purpose — main has no token system.
    backgroundColor: "#14171a",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      zoomFactor: 1, // keep 1 CSS px == 1 DIP so the mpv video region maths stays valid
    },
  });

  window.on("ready-to-show", () => window.show());

  // Open any target="_blank" link (e.g. a "what's this provider" help link) in the OS
  // browser rather than a second Electron window.
  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

void app.whenReady().then(() => {
  registerLogoProtocol();
  const db = getDatabase();
  const mainWindow = createMainWindow();
  registerIpcHandlers(db, mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const next = createMainWindow();
      registerIpcHandlers(db, next);
    }
  });
});

app.on("window-all-closed", () => {
  stopActiveRefreshScheduler();
  if (process.platform !== "darwin") app.quit();
});
