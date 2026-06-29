import type { BBox, Point } from "./components/Document";

// The subset of the Web File System Access API that store.ts actually uses. Native
// FileSystemFileHandle/FileSystemDirectoryHandle structurally satisfy these already, so the web
// build keeps working unchanged. The Electron build implements these same interfaces on top of
// Node fs via IPC (see src/vault/electronHandle.ts) instead of the browser API.
export type VaultWritable = {
  write(data: string | Uint8Array | ArrayBuffer): Promise<void>;
  close(): Promise<void>;
};

export type VaultFileHandle = {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<VaultWritable>;
};

export type VaultDirHandle = {
  readonly kind: "directory";
  readonly name: string;
  entries(): AsyncIterableIterator<[string, VaultFileHandle | VaultDirHandle]>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<VaultDirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<VaultFileHandle>;
  queryPermission?(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
};

export type FSFileEntry = {
  type: "file";
  filename: string;
  handle: VaultFileHandle;
  fullPath: string;
};

export type FSDirEntry = {
  type: "directory";
  dirname: string;
  children: (FSFileEntry | FSDirEntry)[];
  handle: VaultDirHandle;
  fullPath: string;
};

export type VaultFS = {
  filetree: (FSFileEntry | FSDirEntry)[];
  rootHandle: VaultDirHandle;
};

export type LineShapeFileFormat = {
  variant: "Line";
  points: Point[];
  penColor: string;
  penThickness: number;
  // Cached outline + bbox for this stroke, so reopening the file doesn't have to redo the
  // perfect-freehand computation. Optional for backward compatibility with older files.
  bbox?: BBox;
  cachedOutline?: number[][];
};

export type ImageShapeFileFormat = {
  variant: "Image";
  position: {
    x: number;
    y: number;
  };
  base64ImageData: string;
  size: {
    x: number;
    y: number;
  };
};

export type TextblockShapeFileFormat = {
  variant: "Textblock";
  position: {
    x: number;
    y: number;
  };
  size: {
    x: number;
    y: number;
  };
  rawText: string;
};

export type ShapesInClipboard = {
  type: "technicalsketcher";
  shapes: (
    | LineShapeFileFormat
    | ImageShapeFileFormat
    | TextblockShapeFileFormat
  )[];
};

export type TskFileFormat = {
  filetype: string;
  fileversion: 1;
  data: {
    pageColor: string;
    gridColor: string;
    gridType: "lines" | "dots";
    pages: {
      shapes: (
        | LineShapeFileFormat
        | ImageShapeFileFormat
        | TextblockShapeFileFormat
      )[];
    }[];
    pageWidthMm: number;
    pageHeightMm: number;
    currentPageIndex: number;
    viewport?: {
      offsetX: number;
      offsetY: number;
      zoomPxPerMm: number;
    };
  };
};
