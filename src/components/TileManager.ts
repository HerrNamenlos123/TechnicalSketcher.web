import type { BBox, Document, Shape } from "./Document";
import { TILE_SIZE, Tile } from "./Tile";
import { combineBBox, useStore } from "./store";
import { Vec2 } from "./Vector";

function intersects(a: BBox, b: BBox) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function makeTileKey(tileX: number, tileY: number) {
  return `${tileX}_${tileY}`;
}

function getTileRange(minValue: number, maxValue: number, tileWorldSize: number) {
  const minTile = Math.floor(minValue / tileWorldSize);
  const maxTile = Math.ceil(maxValue / tileWorldSize) - 1;
  return { minTile, maxTile };
}

export type RenderState = {
  staticShapes: Shape[];
  dynamicShapes: Shape[];
  erasedShapes: Set<Shape>;
  selectedShapes: Shape[];
  selectionPathPx: Vec2[] | undefined;
  eraserPosPx: Vec2 | undefined;
  rerenderStaticTiles: boolean;
  rerenderDynamicTiles: boolean;
};

export type ZoomPreviewCache = {
  canvas: HTMLCanvasElement;
  rectLeftPx: number;
  rectTopPx: number;
  rectWidthPx: number;
  rectHeightPx: number;
  quality: number;
};

export type ZoomPreviewCacheOptions = {
  createMissingTiles?: boolean;
  refreshDirtyTiles?: boolean;
};

export class TileManager {
  tiles = new Map<string, Tile>();

  get tileWorldSizePx() {
    return TILE_SIZE / this.doc.zoom_px_per_mm;
  }

  constructor(
    private readonly doc: Document,
    private readonly compositorCanvas: HTMLCanvasElement,
  ) {}

  clearTiles() {
    this.tiles.clear();
  }

  private getViewportPageMm(viewportSizePx: Vec2): BBox {
    const z = this.doc.zoom_px_per_mm;
    return {
      left: -this.doc.offset.x / z,
      top: -this.doc.offset.y / z,
      right: (-this.doc.offset.x + viewportSizePx.x) / z,
      bottom: (-this.doc.offset.y + viewportSizePx.y) / z,
    };
  }

  private getViewportPageMmFromRect(leftPx: number, topPx: number, widthPx: number, heightPx: number): BBox {
    const z = this.doc.zoom_px_per_mm;
    return {
      left: (leftPx - this.doc.offset.x) / z,
      top: (topPx - this.doc.offset.y) / z,
      right: (leftPx + widthPx - this.doc.offset.x) / z,
      bottom: (topPx + heightPx - this.doc.offset.y) / z,
    };
  }

  private getPageBoundsMm(): BBox {
    return {
      left: 0,
      top: 0,
      right: this.doc.size_mm.x,
      bottom: this.doc.size_mm.y,
    };
  }

  private getTileFor(tileX: number, tileY: number) {
    const key = makeTileKey(tileX, tileY);
    let tile = this.tiles.get(key);
    if (!tile) {
      const world = this.tileWorldSizePx;
      const boundsPx: BBox = {
        left: tileX * world,
        top: tileY * world,
        right: tileX * world + world,
        bottom: tileY * world + world,
      };
      tile = new Tile(boundsPx, this.doc);
      this.tiles.set(key, tile);
    }
    return tile;
  }

  private getVisibleTiles(viewportPageMm: BBox, createMissingTiles = true) {
    const page = this.getPageBoundsMm();
    const clipped: BBox = {
      left: Math.max(viewportPageMm.left, page.left),
      top: Math.max(viewportPageMm.top, page.top),
      right: Math.min(viewportPageMm.right, page.right),
      bottom: Math.min(viewportPageMm.bottom, page.bottom),
    };

    if (clipped.right < clipped.left || clipped.bottom < clipped.top) {
      return [] as Tile[];
    }

    const world = this.tileWorldSizePx;
    const { minTile: minTileX, maxTile: maxTileX } = getTileRange(clipped.left, clipped.right, world);
    const { minTile: minTileY, maxTile: maxTileY } = getTileRange(clipped.top, clipped.bottom, world);

    const tiles: Tile[] = [];
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
        const key = makeTileKey(tileX, tileY);
        const existing = this.tiles.get(key);
        if (existing) {
          tiles.push(existing);
          continue;
        }
        if (createMissingTiles) {
          tiles.push(this.getTileFor(tileX, tileY));
        }
      }
    }
    return tiles;
  }

  private markTilesDirtyForBBox(bbox: BBox, staticLayer: boolean) {
    const world = this.tileWorldSizePx;
    const { minTile: minTileX, maxTile: maxTileX } = getTileRange(bbox.left, bbox.right, world);
    const { minTile: minTileY, maxTile: maxTileY } = getTileRange(bbox.top, bbox.bottom, world);

    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
        const tile = this.getTileFor(tileX, tileY);
        tile.dirtyDynamic = true;
        if (staticLayer) {
          tile.dirtyStatic = true;
        }
      }
    }
  }

  markShapeDeleted(shape: Shape) {
    this.markTilesDirtyForBBox(shape.bbox, true);
  }

  markShapeMoved(oldBBoxMm: BBox, newBBoxMm: BBox) {
    this.markTilesDirtyForBBox(oldBBoxMm, true);
    this.markTilesDirtyForBBox(newBBoxMm, true);
  }

  markShapeMovedDynamic(oldBBoxMm: BBox, newBBoxMm: BBox) {
    this.markTilesDirtyForBBox(oldBBoxMm, false);
    this.markTilesDirtyForBBox(newBBoxMm, false);
  }

  markShapeInserted(shape: Shape) {
    const bbox = shape.bbox;
    const world = this.tileWorldSizePx;
    const { minTile: minTileX, maxTile: maxTileX } = getTileRange(bbox.left, bbox.right, world);
    const { minTile: minTileY, maxTile: maxTileY } = getTileRange(bbox.top, bbox.bottom, world);

    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
        const tile = this.getTileFor(tileX, tileY);
        if (!intersects(tile.boundsPx, bbox)) {
          continue;
        }
        tile.preRenderer.setOrigin(new Vec2(tile.boundsPx.left, tile.boundsPx.top).mul(this.doc.zoom_px_per_mm));
        tile.preRenderer.drawShape(shape);
        tile.preRenderer.resetOrigin();
        tile.dirtyDynamic = true;
      }
    }
  }

  invalidateAllVisibleStaticTiles(viewportSizePx: Vec2) {
    const viewport = this.getViewportPageMm(viewportSizePx);
    for (const tile of this.getVisibleTiles(viewport)) {
      tile.dirtyStatic = true;
      tile.dirtyDynamic = true;
    }
  }

  private renderStaticTile(tile: Tile, staticShapes: Shape[]) {
    const store = useStore();

    tile.preRenderer.clear();
    tile.preRenderer.setOrigin(new Vec2(tile.boundsPx.left, tile.boundsPx.top).mul(this.doc.zoom_px_per_mm));

    if (store.paperTexture) {
      tile.preRenderer.drawImageCovering(store.paperTexture);
    }
    tile.preRenderer.drawGrid();

    for (const shape of staticShapes) {
      if (!intersects(tile.boundsPx, shape.bbox)) {
        continue;
      }
      tile.preRenderer.drawShape(shape);
    }

    tile.preRenderer.resetOrigin();
    tile.dirtyStatic = false;
    tile.dirtyDynamic = true;
  }

  private renderDynamicTile(tile: Tile, state: RenderState) {
    tile.mainRenderer.clear();
    tile.mainRenderer.drawRenderLayer(tile.preRenderer);
    tile.mainRenderer.setOrigin(new Vec2(tile.boundsPx.left, tile.boundsPx.top).mul(this.doc.zoom_px_per_mm));

    if (state.selectionPathPx) {
      tile.mainRenderer.drawDashedPolygon(state.selectionPathPx);
    }

    for (const shape of state.dynamicShapes) {
      if (!intersects(tile.boundsPx, shape.bbox)) {
        continue;
      }
      tile.mainRenderer.drawShape(shape);
    }

    for (const shape of state.erasedShapes) {
      if (!intersects(tile.boundsPx, shape.bbox)) {
        continue;
      }
      tile.mainRenderer.drawShape(shape, true);
    }

    if (state.eraserPosPx) {
      const store = useStore();
      const r = store.eraserSizePx / 2;
      const z = this.doc.zoom_px_per_mm;
      const eraserBox: BBox = {
        left: (state.eraserPosPx.x - r) / z,
        right: (state.eraserPosPx.x + r) / z,
        top: (state.eraserPosPx.y - r) / z,
        bottom: (state.eraserPosPx.y + r) / z,
      };
      if (intersects(tile.boundsPx, eraserBox)) {
        tile.mainRenderer.drawCircle(state.eraserPosPx, r);
      }
    }

    if (state.selectedShapes.length > 0) {
      let combinedBbox = state.selectedShapes[0].bbox;
      for (const shape of state.selectedShapes) {
        combinedBbox = combineBBox(combinedBbox, shape.bbox);
        if (!intersects(tile.boundsPx, shape.bbox)) {
          continue;
        }
        tile.mainRenderer.drawSelectionBbox(shape.bbox);
      }
      if (intersects(tile.boundsPx, combinedBbox)) {
        tile.mainRenderer.drawSelectionBbox(combinedBbox);
      }
      const handlePos = new Vec2(combinedBbox.right, combinedBbox.bottom);
      if (intersects(tile.boundsPx, {
        left: handlePos.x,
        right: handlePos.x,
        top: handlePos.y,
        bottom: handlePos.y,
      })) {
        tile.mainRenderer.drawResizeHandle(handlePos);
      }
    }

    tile.mainRenderer.resetOrigin();
    tile.dirtyDynamic = false;
    tile.hasRenderedDynamic = true;
  }

  private resizeCompositor(viewportSizePx: Vec2) {
    const dpr = window.devicePixelRatio;
    const targetWidth = Math.max(1, Math.round(viewportSizePx.x * dpr));
    const targetHeight = Math.max(1, Math.round(viewportSizePx.y * dpr));
    if (this.compositorCanvas.width !== targetWidth || this.compositorCanvas.height !== targetHeight) {
      this.compositorCanvas.width = targetWidth;
      this.compositorCanvas.height = targetHeight;
    }
  }

  renderAndComposite(viewportSizePx: Vec2, state: RenderState) {
    this.resizeCompositor(viewportSizePx);

    const viewportPageMm = this.getViewportPageMm(viewportSizePx);
    const visibleTiles = this.getVisibleTiles(viewportPageMm);

    for (const tile of visibleTiles) {
      if (state.rerenderStaticTiles || tile.dirtyStatic) {
        this.renderStaticTile(tile, state.staticShapes);
      }
      if (state.rerenderDynamicTiles || tile.dirtyDynamic) {
        this.renderDynamicTile(tile, state);
      }
    }

    const ctx = this.compositorCanvas.getContext("2d", { desynchronized: true });
    if (!ctx) return;

    const dpr = window.devicePixelRatio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.compositorCanvas.width, this.compositorCanvas.height);

    for (const tile of visibleTiles) {
      const screenX = tile.boundsPx.left * this.doc.zoom_px_per_mm + this.doc.offset.x;
      const screenY = tile.boundsPx.top * this.doc.zoom_px_per_mm + this.doc.offset.y;
      const dx = Math.round(screenX * dpr);
      const dy = Math.round(screenY * dpr);
      ctx.drawImage(tile.mainRenderer.canvas, dx, dy);
    }
  }

  buildZoomPreviewCache(
    viewportSizePx: Vec2,
    state: RenderState,
    paddingPx: number,
    quality: number,
    options?: ZoomPreviewCacheOptions,
  ): ZoomPreviewCache {
    const createMissingTiles = options?.createMissingTiles ?? true;
    const refreshDirtyTiles = options?.refreshDirtyTiles ?? true;
    const q = Math.max(0.25, Math.min(1, quality));
    const rectLeftPx = -paddingPx;
    const rectTopPx = -paddingPx;
    const rectWidthPx = viewportSizePx.x + paddingPx * 2;
    const rectHeightPx = viewportSizePx.y + paddingPx * 2;

    const viewportPageMm = this.getViewportPageMmFromRect(rectLeftPx, rectTopPx, rectWidthPx, rectHeightPx);
    const visibleTiles = this.getVisibleTiles(viewportPageMm, createMissingTiles);

    if (refreshDirtyTiles) {
      for (const tile of visibleTiles) {
        if (state.rerenderStaticTiles || tile.dirtyStatic) {
          this.renderStaticTile(tile, state.staticShapes);
        }
        if (state.rerenderDynamicTiles || tile.dirtyDynamic) {
          this.renderDynamicTile(tile, state);
        }
      }
    }

    const dpr = window.devicePixelRatio;
    const cacheCanvas = document.createElement("canvas");
    cacheCanvas.width = Math.max(1, Math.round(rectWidthPx * dpr * q));
    cacheCanvas.height = Math.max(1, Math.round(rectHeightPx * dpr * q));
    const cacheCtx = cacheCanvas.getContext("2d", { desynchronized: true });
    if (!cacheCtx) {
      return {
        canvas: cacheCanvas,
        rectLeftPx,
        rectTopPx,
        rectWidthPx,
        rectHeightPx,
        quality: q,
      };
    }

    cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
    cacheCtx.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height);

    for (const tile of visibleTiles) {
      if (!tile.hasRenderedDynamic) {
        continue;
      }
      const screenX = tile.boundsPx.left * this.doc.zoom_px_per_mm + this.doc.offset.x;
      const screenY = tile.boundsPx.top * this.doc.zoom_px_per_mm + this.doc.offset.y;

      const dx = Math.round((screenX - rectLeftPx) * dpr * q);
      const dy = Math.round((screenY - rectTopPx) * dpr * q);
      const dw = Math.round(tile.mainRenderer.canvas.width * q);
      const dh = Math.round(tile.mainRenderer.canvas.height * q);

      cacheCtx.drawImage(tile.mainRenderer.canvas, dx, dy, dw, dh);
    }

    return {
      canvas: cacheCanvas,
      rectLeftPx,
      rectTopPx,
      rectWidthPx,
      rectHeightPx,
      quality: q,
    };
  }
}
