import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerVaultIpc } from "./vaultFsMain";
import { setupAutoUpdater } from "./updater";
import { integrateLinuxDesktopEntry } from "./desktopIntegration";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set by vite-plugin-electron in dev; absent in a packaged build, where we load the built files.
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const distDir = path.join(__dirname, "../dist");
const publicDir = devServerUrl ? path.join(__dirname, "../public") : distDir;
const iconPath = path.join(publicDir, "icon.png");

let win: BrowserWindow | undefined;

// Windows/Linux pass the double-clicked file's path as a CLI arg (NSIS/deb file associations,
// configured in electron-builder.yml). App.vue already knows how to open a vault-relative path
// passed as a `?file=` query string (used for shareable links in the web build), so the initial
// launch just reuses that; a second-instance launch happens after the window already exists, so
// that path goes over an IPC channel instead (see app:openFile below).
function extractTskPathFromArgv(argv: string[]): string | undefined {
  return argv.find((arg) => arg.toLowerCase().endsWith(".tsk"));
}

function createWindow() {
  win = new BrowserWindow({
    title: "TechnicalSketcher",
    icon: iconPath,
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const initialFilePath = extractTskPathFromArgv(process.argv);
  const search = initialFilePath ? `?file=${encodeURIComponent(initialFilePath)}` : undefined;

  if (devServerUrl) {
    void win.loadURL(devServerUrl + (search ?? ""));
  } else {
    void win.loadFile(path.join(distDir, "index.html"), search ? { search } : undefined);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const filePath = extractTskPathFromArgv(argv);
    if (filePath) win.webContents.send("app:openFile", filePath);
  });

  app.whenReady().then(() => {
    createWindow();
    registerVaultIpc(() => win);
    setupAutoUpdater(() => win);
    void integrateLinuxDesktopEntry(iconPath);
  });

  app.on("window-all-closed", () => {
    win = undefined;
    app.quit();
  });
}
