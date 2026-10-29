import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { registerIpcHandlers, stopActiveRefreshScheduler } from "./ipc.js";
import { IPC_SETUP_CHANNEL } from "../shared/ipc.js";
import { receiveSetupLink } from "./setupLinks.js";
import { getDatabase } from "./database.js";
import { registerLogoProtocol, registerLogoScheme } from "./logoCache.js";
import { startUpdateChecks } from "./updater.js";

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
    // Packaged builds take the icon from the executable (build/icon.ico); dev runs need it set here.
    ...(is.dev ? { icon: join(app.getAppPath(), "build", "icon.png") } : {}),
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

// `testcard://s#...` opens a setup link (docs/adr/0019-setup-links.md). The text is hostile until proven otherwise: it is only ever
// handed to `receiveSetupLink`, which accepts nothing but our own link shape and asks the person before anything is added.
const SETUP_SCHEME = "testcard";
if (process.defaultApp) {
  if (process.argv[1] !== undefined) app.setAsDefaultProtocolClient(SETUP_SCHEME, process.execPath, [join(process.cwd(), process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(SETUP_SCHEME);
}

const linkIn = (argv: readonly string[]): string | undefined => argv.find((arg) => arg.toLowerCase().startsWith(`${SETUP_SCHEME}:`));

/** Reads the link and tells the window there is something to show; the window also asks on start-up, so neither order is missed. */
async function openSetupLink(text: string): Promise<void> {
  await receiveSetupLink(text);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_SETUP_CHANNEL);
  }
}

// One copy of the app: a second launch (Windows opens a new process for a link) hands its link to the first and exits.
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) app.quit();

app.on("second-instance", (_event, argv) => {
  const [window] = BrowserWindow.getAllWindows();
  if (window !== undefined) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
  const link = linkIn(argv);
  if (link !== undefined) void openSetupLink(link);
});

void app.whenReady().then(() => {
  if (!isFirstInstance) return;
  registerLogoProtocol();
  const db = getDatabase();
  const mainWindow = createMainWindow();
  registerIpcHandlers(db, mainWindow);
  startUpdateChecks();
  const launchLink = linkIn(process.argv);
  if (launchLink !== undefined) void openSetupLink(launchLink);

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
