import { type BrowserWindow, dialog, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { getLastVaultPath, setLastVaultPath } from "./config";

let watcher: FSWatcher | undefined;
let watchedRoot: string | undefined;

function toPosixRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

// Registers the IPC surface that src/vault/electronHandle.ts calls into. Mirrors the subset of
// the Web File System Access API that store.ts actually uses (see types.ts VaultFileHandle /
// VaultDirHandle) - filtering of which entries belong in the vault tree (.tsk files, hidden
// folders) stays in store.ts's processEntries, shared by both backends, so this just hands back
// raw directory listings.
export function registerVaultIpc(getWindow: () => BrowserWindow | undefined) {
  ipcMain.handle("vault:pickDirectory", async () => {
    const win = getWindow();
    const result = await (win
      ? dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] })
      : dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] }));
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("vault:getLastPath", () => getLastVaultPath());
  ipcMain.handle("vault:setLastPath", (_event, vaultPath: string) => setLastVaultPath(vaultPath));

  ipcMain.handle("vault:exists", async (_event, targetPath: string) => {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("vault:readDir", async (_event, dirPath: string) => {
    const dirents = await fs.readdir(dirPath, { withFileTypes: true });
    return dirents.map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
    }));
  });

  ipcMain.handle("vault:readTextFile", (_event, filePath: string) => fs.readFile(filePath, "utf-8"));

  ipcMain.handle("vault:writeFile", async (_event, filePath: string, data: string | Uint8Array) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  });

  ipcMain.handle("vault:ensureDir", (_event, dirPath: string) => fs.mkdir(dirPath, { recursive: true }));

  ipcMain.handle("vault:ensureFile", async (_event, filePath: string) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const handle = await fs.open(filePath, "a");
    await handle.close();
  });

  ipcMain.handle("vault:watch", (_event, rootPath: string) => {
    void watcher?.close();
    watchedRoot = rootPath;
    watcher = chokidar.watch(rootPath, { ignoreInitial: true, depth: 32 });

    const notify = (changedPath: string) => {
      const win = getWindow();
      if (!win || !watchedRoot) return;
      win.webContents.send("vault:changed", toPosixRelative(watchedRoot, changedPath));
    };

    watcher.on("add", notify).on("change", notify).on("unlink", notify).on("addDir", notify).on("unlinkDir", notify);
  });
}
