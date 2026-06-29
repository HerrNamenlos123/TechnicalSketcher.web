import type { VaultDirHandle, VaultFileHandle, VaultWritable } from "@/types";

// Bridge exposed by electron/preload.ts via contextBridge. Only present when running inside the
// Electron shell - the web build (GitHub Pages) never sets this, and isElectron() below is the
// single switch store.ts uses to pick a vault backend.
export type VaultDirEntryInfo = { name: string; kind: "file" | "directory" };

export type ElectronAPI = {
  isElectron: true;
  vault: {
    pickDirectory(): Promise<string | null>;
    getLastPath(): Promise<string | null>;
    setLastPath(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    readDir(path: string): Promise<VaultDirEntryInfo[]>;
    readTextFile(path: string): Promise<string>;
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
    ensureDir(path: string): Promise<void>;
    ensureFile(path: string): Promise<void>;
    watch(rootPath: string): Promise<void>;
    onChanged(cb: (path: string) => void): () => void;
  };
  updates: {
    onDownloaded(cb: () => void): () => void;
    quitAndInstall(): void;
  };
  app: {
    onOpenFile(cb: (path: string) => void): () => void;
  };
};

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function isElectron(): boolean {
  return !!window.electronAPI?.isElectron;
}

function api(): ElectronAPI {
  if (!window.electronAPI) throw new Error("electronAPI is not available outside Electron");
  return window.electronAPI;
}

function joinPath(base: string, name: string): string {
  return base.endsWith("/") || base.endsWith("\\") ? base + name : `${base}/${name}`;
}

function deriveName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export class ElectronFileHandle implements VaultFileHandle {
  readonly kind = "file" as const;
  readonly name: string;

  constructor(readonly path: string, name?: string) {
    this.name = name ?? deriveName(path);
  }

  async getFile() {
    const path = this.path;
    return { text: () => api().vault.readTextFile(path) };
  }

  async createWritable(): Promise<VaultWritable> {
    const path = this.path;
    // Every call site does exactly one write() followed by close() - no streaming writers - so
    // buffering the single chunk and flushing on close matches actual usage.
    let pending: string | Uint8Array = "";
    return {
      write: async (data) => {
        pending = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
      },
      close: async () => {
        await api().vault.writeFile(path, pending);
      },
    };
  }
}

export class ElectronDirHandle implements VaultDirHandle {
  readonly kind = "directory" as const;
  readonly name: string;

  constructor(readonly path: string, name?: string) {
    this.name = name ?? deriveName(path);
  }

  async *entries(): AsyncIterableIterator<[string, VaultFileHandle | VaultDirHandle]> {
    const entries = await api().vault.readDir(this.path);
    for (const entry of entries) {
      const childPath = joinPath(this.path, entry.name);
      yield [
        entry.name,
        entry.kind === "file"
          ? new ElectronFileHandle(childPath, entry.name)
          : new ElectronDirHandle(childPath, entry.name),
      ];
    }
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<VaultDirHandle> {
    const childPath = joinPath(this.path, name);
    if (!(await api().vault.exists(childPath))) {
      if (!options?.create) {
        throw new DOMException(`Directory not found: ${childPath}`, "NotFoundError");
      }
      await api().vault.ensureDir(childPath);
    }
    return new ElectronDirHandle(childPath, name);
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<VaultFileHandle> {
    const childPath = joinPath(this.path, name);
    if (!(await api().vault.exists(childPath))) {
      if (!options?.create) {
        throw new DOMException(`File not found: ${childPath}`, "NotFoundError");
      }
      await api().vault.ensureFile(childPath);
    }
    return new ElectronFileHandle(childPath, name);
  }

  // Node fs has no browser-style permission model - access was already granted by the user
  // picking this folder via the native dialog.
  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async requestPermission(): Promise<PermissionState> {
    return "granted";
  }
}
