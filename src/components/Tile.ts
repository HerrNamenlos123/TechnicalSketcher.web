import type { BBox, Document } from "./Document";
import { RenderLayer } from "./RenderLayer";
import { Vec2 } from "./Vector";

export const TILE_SIZE = 512;

export class Tile {
  preRenderer: RenderLayer;
  mainRenderer: RenderLayer;
  dirtyStatic = true;
  dirtyDynamic = true;
  hasRenderedDynamic = false;

  constructor(
    public readonly boundsPx: BBox,
    doc: Document,
  ) {
    const size = new Vec2(TILE_SIZE, TILE_SIZE);
    this.preRenderer = new RenderLayer(size, doc, false);
    this.mainRenderer = new RenderLayer(size, doc, false);
  }
}
