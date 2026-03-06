import { isDeeplyEqual } from "@/deep-equal";
import type { BBox, Document, Shape } from "./Document";
import { useStore } from "./store";
import { TileManager, type ZoomPreviewCache, type ZoomPreviewCacheOptions } from "./TileManager";
import { Vec2 } from "./Vector";

export class Renderer {
  tileManager: TileManager;
  dirtyDynamicOnly = false;

  staticShapes: Shape[] = [];
  dynamicShapes: Shape[] = [];
  erasedShapes: Set<Shape> = new Set();
  selectedShapes: Shape[] = [];
  selectionPathPx: undefined | Vec2[] = undefined;
  eraserPosPx: Vec2 | undefined = undefined;

  newlyInsertedShapes: Shape[] = [];

  private prevStaticShapes: Shape[] = [];
  private prevDynamicShapes: Shape[] = [];
  private prevErasedShapes: Set<Shape> = new Set();
  private prevSelectedShapes: Shape[] = [];
  private prevSelectionPath: undefined | Vec2[] = undefined;
  private prevEraserPos: Vec2 | undefined = undefined;
  private prevPageSizeMm: Vec2 = new Vec2();
  private prevPageZoom: number = 0;
  private readonly mainCanvasElement: HTMLCanvasElement;

  private isRendering = false;
  private needsCleanupRender = false;

  constructor(
    public doc: Document,
    mainCanvasElement: HTMLCanvasElement
  ) {
    this.mainCanvasElement = mainCanvasElement;
    this.tileManager = new TileManager(doc, mainCanvasElement);
  }

  private getViewportSizePx() {
    const rect = this.mainCanvasElement.getBoundingClientRect();
    const width = this.mainCanvasElement.clientWidth || rect.width;
    const height = this.mainCanvasElement.clientHeight || rect.height;
    return new Vec2(width, height);
  }

  async render() {
    if (this.isRendering) {
      this.needsCleanupRender = true;
      return;
    }

    const store = useStore();

    this.isRendering = true;

    const hasForcedRender = store.forceDeepRender || store.forceShallowRender;

    // Filter newly inserted shapes, because when a shape is inserted and rendered onto the prerender buffer,
    // we do not need to redraw it entirely, so the check must be skipped. However, when any other shape
    // changes at the same time as we insert a new one, we still want to redraw. So we can't simply skip the check,
    // we must exclude the new shape from the check.
    const staticWithoutNewlyInserted = hasForcedRender
      ? []
      : this.staticShapes.filter((s) => !this.newlyInsertedShapes.includes(s));

    const staticChanged = hasForcedRender ? false : !isDeeplyEqual(staticWithoutNewlyInserted, this.prevStaticShapes);
    const dynamicChanged = hasForcedRender
      ? false
      : !isDeeplyEqual(this.dynamicShapes, this.prevDynamicShapes) || !isDeeplyEqual(this.erasedShapes, this.prevErasedShapes);

    const selectedShapesChanged = hasForcedRender ? false : !isDeeplyEqual(this.selectedShapes, this.prevSelectedShapes);
    const selectionChanged = hasForcedRender ? false : !isDeeplyEqual(this.selectionPathPx, this.prevSelectionPath);
    const eraserChanged = hasForcedRender ? false : !isDeeplyEqual(this.eraserPosPx, this.prevEraserPos);
    const viewportSizePx = this.getViewportSizePx();
    const pageSizeChanged = !isDeeplyEqual(this.doc.size_mm, this.prevPageSizeMm);
    const zoomChanged = this.prevPageZoom !== this.doc.zoom_px_per_mm;
    const pageGeometryChanged = pageSizeChanged || zoomChanged;

    if (pageGeometryChanged) {
      this.tileManager.clearTiles();
    }

    if (staticChanged || store.forceDeepRender || pageGeometryChanged) {
      this.tileManager.invalidateAllVisibleStaticTiles(viewportSizePx);
    }

    const rerenderDynamicTiles = this.dirtyDynamicOnly
      ? false
      : dynamicChanged ||
        selectionChanged ||
        eraserChanged ||
        pageGeometryChanged ||
        store.forceDeepRender ||
        selectedShapesChanged ||
        store.forceShallowRender;

    this.tileManager.renderAndComposite(viewportSizePx, {
      staticShapes: this.staticShapes,
      dynamicShapes: this.dynamicShapes,
      erasedShapes: this.erasedShapes,
      selectedShapes: this.selectedShapes,
      selectionPathPx: this.selectionPathPx,
      eraserPosPx: this.eraserPosPx,
      rerenderStaticTiles: false,
      rerenderDynamicTiles,
    });

    if (!hasForcedRender || pageGeometryChanged) {
      this.prevStaticShapes = [...this.staticShapes];
      this.prevDynamicShapes = [...this.dynamicShapes];
      this.prevSelectedShapes = [...this.selectedShapes];
      this.prevPageSizeMm = new Vec2(this.doc.size_mm);
      this.prevEraserPos = this.eraserPosPx && new Vec2(this.eraserPosPx);
      this.prevSelectionPath = this.selectionPathPx && [...this.selectionPathPx];
      this.prevPageZoom = this.doc.zoom_px_per_mm;
    }
    this.newlyInsertedShapes = [];
    store.triggerRender = false;
    store.forceDeepRender = false;
    store.forceShallowRender = false;

    this.isRendering = false;

    if (this.needsCleanupRender) {
      this.needsCleanupRender = false;

      this.render();
    }
  }

  async renderNewShapeToPrerenderer(shape: Shape) {
    const store = useStore();
    this.newlyInsertedShapes.push(shape);
    this.tileManager.markShapeInserted(shape);
    store.forceShallowRender = true;
  }

  markShapeDeleted(shape: Shape) {
    this.tileManager.markShapeDeleted(shape);
  }

  markShapeMoved(oldBBoxMm: BBox, newBBoxMm: BBox) {
    this.tileManager.markShapeMoved(oldBBoxMm, newBBoxMm);
  }

  markShapeMovedDynamic(oldBBoxMm: BBox, newBBoxMm: BBox) {
    this.tileManager.markShapeMovedDynamic(oldBBoxMm, newBBoxMm);
  }

  buildZoomPreviewCache(
    viewportSizePx: Vec2,
    paddingPx: number,
    quality: number,
    options?: ZoomPreviewCacheOptions,
  ): ZoomPreviewCache {
    return this.tileManager.buildZoomPreviewCache(
      viewportSizePx,
      {
        staticShapes: this.staticShapes,
        dynamicShapes: this.dynamicShapes,
        erasedShapes: this.erasedShapes,
        selectedShapes: this.selectedShapes,
        selectionPathPx: this.selectionPathPx,
        eraserPosPx: this.eraserPosPx,
        rerenderStaticTiles: false,
        rerenderDynamicTiles: false,
      },
      paddingPx,
      quality,
      options,
    );
  }
}
