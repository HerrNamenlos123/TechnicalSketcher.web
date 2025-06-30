import type { Point } from "./components/Document";

export type FSFileEntry = {
  type: "file";
  filename: string;
  handle: FileSystemFileHandle;
  fullPath: string;
};

export type FSDirEntry = {
  type: "directory";
  dirname: string;
  children: (FSFileEntry | FSDirEntry)[];
  handle: FileSystemDirectoryHandle;
  fullPath: string;
};

export type VaultFS = {
  filetree: (FSFileEntry | FSDirEntry)[];
  rootHandle: FileSystemDirectoryHandle;
};

export type LineShapeFileFormat = {
  variant: "Line";
  points: Point[];
  penColor: string;
  penThickness: number;
};

export type ImageShapeFileFormat = {
  variant: "Image",
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

export type ShapesInClipboard = {
  type: "technicalsketcher";
  shapes: (LineShapeFileFormat | ImageShapeFileFormat)[];
}

export type TskFileFormat = {
  filetype: string;
  fileversion: 1;
  data: {
    pageColor: string;
    gridColor: string;
    gridType: "lines" | "dots";
    pages: {
      shapes: (LineShapeFileFormat | ImageShapeFileFormat)[];
    }[];
    pageWidthMm: number;
    pageHeightMm: number;
    currentPageIndex: number;
  };
};
