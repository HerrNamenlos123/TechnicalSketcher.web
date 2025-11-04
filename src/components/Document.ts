import type { FSFileEntry } from "@/types";
import { assert } from "./store";
import { Vec2 } from "./Vector";

export type Point = {
  x: number;
  y: number;
  pressure: number;
};

export type BBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type LineShape = {
  variant: "Line";
  points: Point[];
  bbox: BBox;
  penThickness: number;
  penColor: string;
};

export type ImageShape = {
  variant: "Image";
  position: {
    x: number;
    y: number;
  };
  bbox: BBox;
  base64ImageData: string;
  image: HTMLImageElement;
  size: Vec2;
};

export type TextblockShape = {
  variant: "Textblock";
  position: {
    x: number;
    y: number;
  };
  bbox: BBox;
  size: Vec2;
  rawText: string;
};

export type Shape = ImageShape | LineShape | TextblockShape;

export type Page = {
  previewLine?: LineShape;
  oldPreviewLineLength?: number;
  pageIndex: number;
  shapes: Shape[];
};

export function getCtx(canvas: HTMLCanvasElement | undefined) {
  assert(canvas);
  return canvas.getContext("2d", { desynchronized: true })!;
}

// export const DEFAULT_GRID_COLOR = "#37e6cf98";
export const DEFAULT_GRID_COLOR = "#5252524f";
export const DEFAULT_PAGE_COLOR = "#ffffff";
export const DEFAULT_ZOOM_PX_PER_MM = 5;
export const DEFAULT_PAGE_SIZE = new Vec2(210, 297);
export const DEFAULT_DOCUMENT_OFFSET = new Vec2(200, 10);

export type Document = {
  pages: Page[];
  pageColor: string;
  gridColor: string;
  gridType: "lines" | "dots";
  offset: Vec2;
  zoom_px_per_mm: number;
  fileHandle?: FSFileEntry;
  size_mm: Vec2;
  currentPageIndex: number;
};

export function getDocumentSizePx(doc: Document) {
  return doc.size_mm.mul(doc.zoom_px_per_mm).round();
}
