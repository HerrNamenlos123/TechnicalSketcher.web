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
  offset_px: Vec2;
  visibleCanvas?: HTMLCanvasElement;
  offscreenCanvas?: HTMLCanvasElement;
  pageIndex: number;
  shapes: Shape[];
}

export function getCtx(canvas: HTMLCanvasElement | undefined) {
  assert(canvas);
  return canvas.getContext("2d")!;
}

export const DEFAULT_GRID_COLOR = "#37e6cf98";
export const DEFAULT_PAGE_COLOR = "#FFF";
export const DEFAULT_ZOOM_PX_PER_MM = 5;
export const DEFAULT_PAGE_SIZE = new Vec2(210, 297);
export const DEFAULT_DOCUMENT_OFFSET = new Vec2(300, 100);

export type Document = {
  pages: Page[];
  pageColor: string;
  gridColor: string;
  gridType: "lines" | "dots";
  offset: Vec2;
  zoom_px_per_mm: number;
  fileHandle?: FSFileEntry;
  size_mm: Vec2;
}

export function getDocumentSizePx(doc: Document) {
  return doc.size_mm
    .mul(doc.zoom_px_per_mm)
    .round();
}
