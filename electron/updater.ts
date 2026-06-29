import { app, type BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Only meaningful for a packaged app published via electron-builder's GitHub provider - in dev
// there's no app-update.yml and electron-updater would just throw.
export function setupAutoUpdater(getWindow: () => BrowserWindow | undefined) {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-downloaded", () => {
    getWindow()?.webContents.send("updates:downloaded");
  });
  autoUpdater.on("error", (err) => {
    console.error("Auto-update error:", err);
  });

  ipcMain.on("updates:quitAndInstall", () => {
    autoUpdater.quitAndInstall();
  });

  // checkForUpdates() both emits 'error' (handled above) AND rejects its returned promise on the
  // same failure - without this .catch() that's an unhandled rejection on top of the logged error.
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  void check();
  setInterval(() => void check(), CHECK_INTERVAL_MS);
}
