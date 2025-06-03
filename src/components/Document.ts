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

export class Page {
  previewShape: Shape | undefined;
  size_px = new Vec2();
  offset_px = new Vec2();
  visibleCanvas?: HTMLCanvasElement;
  offscreenCanvas?: HTMLCanvasElement;

  get visibleCtx() {
    assert(this.visibleCanvas);
    return this.visibleCanvas.getContext("2d")!;
  }

  get offscreenCtx() {
    assert(this.offscreenCanvas);
    return this.offscreenCanvas.getContext("2d")!;
  }

  constructor(
    public pageIndex: number,
    public shapes: Shape[] = [],
    public size_mm = new Vec2(210, 297),
  ) {}
}

export class Document {
  constructor(
    public pages: Page[] = [],
    public pageColor: string = "#FFFFFF",
    public gridColor: string = "#37e6cf98",
    public gridType = "lines" as "lines" | "dots",
    public offset = new Vec2(0, 0),
    public zoom_px_per_mm = 5,
    public fileHandle?: FSFileEntry,
  ) {
    // this.gridColor = "#37e6cf98";
  }
}
