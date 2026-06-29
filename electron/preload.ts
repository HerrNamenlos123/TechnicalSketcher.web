import { contextBridge, ipcRenderer } from "electron";

const vault = {
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("vault:pickDirectory"),
  getLastPath: (): Promise<string | null> => ipcRenderer.invoke("vault:getLastPath"),
  setLastPath: (path: string): Promise<void> => ipcRenderer.invoke("vault:setLastPath", path),
  exists: (path: string): Promise<boolean> => ipcRenderer.invoke("vault:exists", path),
  readDir: (path: string) => ipcRenderer.invoke("vault:readDir", path),
  readTextFile: (path: string): Promise<string> => ipcRenderer.invoke("vault:readTextFile", path),
  writeFile: (path: string, data: string | Uint8Array): Promise<void> =>
    ipcRenderer.invoke("vault:writeFile", path, data),
  ensureDir: (path: string): Promise<void> => ipcRenderer.invoke("vault:ensureDir", path),
  ensureFile: (path: string): Promise<void> => ipcRenderer.invoke("vault:ensureFile", path),
  watch: (rootPath: string): Promise<void> => ipcRenderer.invoke("vault:watch", rootPath),
  onChanged: (cb: (relativePath: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, relativePath: string) => cb(relativePath);
    ipcRenderer.on("vault:changed", listener);
    return () => ipcRenderer.off("vault:changed", listener);
  },
};

const updates = {
  onDownloaded: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("updates:downloaded", listener);
    return () => ipcRenderer.off("updates:downloaded", listener);
  },
  quitAndInstall: (): void => ipcRenderer.send("updates:quitAndInstall"),
};

const app = {
  onOpenFile: (cb: (path: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, path: string) => cb(path);
    ipcRenderer.on("app:openFile", listener);
    return () => ipcRenderer.off("app:openFile", listener);
  },
};

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  vault,
  updates,
  app,
});
