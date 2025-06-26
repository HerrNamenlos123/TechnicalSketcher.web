import type { FSFileEntry } from "@/types";
import { assert } from "./store";
import { Vec2 } from "./Vector";

export type Point = {
  x: number;
  y: number;
  pressure: number;
};

export type Shape = {
  points: Point[];
  lagCompensation?: boolean;
  penThickness: number;
  penColor: string;
};

export type Page = {
  previewShape?: Shape;
  pageIndex: number;
  shapes: Shape[];
}

export function getCtx(canvas: HTMLCanvasElement | undefined) {
  assert(canvas);
  return canvas.getContext("2d")!;
}

export const DEFAULT_GRID_COLOR = "#37e6cf98";
export const DEFAULT_PAGE_COLOR = "#D2B48C";
export const DEFAULT_ZOOM_PX_PER_MM = 5;
export const DEFAULT_PAGE_SIZE = new Vec2(148, 210);
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
}

export function getDocumentSizePx(doc: Document) {
  return doc.size_mm
    .mul(doc.zoom_px_per_mm)
    .round();
}
