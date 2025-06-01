import type { Point } from "./components/Document";

export type FSFileEntry = {
  type: "file";
  filename: string;
  handle: FileSystemFileHandle;
};

export type FSDirEntry = {
  type: "directory";
  dirname: string;
  children: (FSFileEntry | FSDirEntry)[];
  handle: FileSystemDirectoryHandle;
};

export type VaultFS = {
  filetree: (FSFileEntry | FSDirEntry)[];
  rootHandle: FileSystemDirectoryHandle;
};

export type TskFileFormat = {
  filetype: string;
  fileversion: 1;
  data: {
    pageColor: string;
    gridColor: string;
    gridType: "lines" | "dots";
    pages: {
      shapes: {
        points: Point[];
      }[];
    }[];
  };
};
