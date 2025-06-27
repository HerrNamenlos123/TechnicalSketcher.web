import type { Point } from "./components/Document";
import type { Vec2 } from "./components/Vector";

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

export type ImageShapeFileFormat = {
  position: {
    x: number;
    y: number;
  };
  base64ImageData: string;
  size: Vec2;
};

export type TskFileFormat = {
  filetype: string;
  fileversion: 1;
  data: {
    pageColor: string;
    gridColor: string;
    gridType: "lines" | "dots";
    pages: {
      shapes: ({
        variant: "Line";
        points: Point[];
        penColor: string;
        penThickness: number;
      } | {
        variant: "Image",
        position: {
          x: number;
          y: number;
        };
        base64ImageData: string;
        size: Vec2;
      })[];
    }[];
    pageWidthMm: number;
    pageHeightMm: number;
    currentPageIndex: number;
  };
};
