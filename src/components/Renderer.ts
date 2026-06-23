import { isDeeplyEqual } from "@/deep-equal";
import type { BBox, Document, Shape } from "./Document";
import { useStore } from "./store";
import { TileManager, type ZoomPreviewCache, type ZoomPreviewCacheOptions } from "./TileManager";
import { Vec2 } from "./Vector";

// Mirrors FreehandTest.vue's ZOOM_PREVIEW_CACHE_PADDING_FACTOR: keeping this many tiles
// pre-rendered beyond the exact viewport means the padded preview snapshot built at the start
// of every pan/zoom gesture is just compositing tiles that already exist instead of needing to
// render anything new, and it's also why the page edge no longer looks cropped to wherever the
// viewport happened to end before the gesture started.
const TILE_BUFFER_PADDING_FACTOR = 0.4;

// Letting the buffer prewarm run synchronously inside render() made every gesture-end (and
// every other real render) noticeably more expensive, which showed up as stutter mid-zoom since
// a zoom gesture frequently ends/restarts on brief pauses between wheel ticks. Deferring it onto
// a timer keeps render() itself exactly as cheap as before the buffer was introduced.
const BUFFER_PREWARM_DELAY_MS = 50;

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
  private prevPageIndex: number = -1;
  private readonly mainCanvasElement: HTMLCanvasElement;

  private isRendering = false;
  private needsCleanupRender = false;
  private pendingBufferPrewarm: number | undefined;
  // Set by the component while an interactive pan/zoom gesture is in progress (see
  // FreehandTest.vue). The buffer prewarm renders a whole ring of tiles synchronously when it
  // fires - if that timer happened to land in the middle of an active gesture, it was a real
  // source of mid-zoom stutter even though it's "just" idle prep work. Checked right before
  // doing the work, rather than cancelled outright, so prep still happens as soon as the
  // gesture ends instead of being lost entirely.
  interactionActive = false;

  constructor(
    public doc: Document,
    mainCanvasElement: HTMLCanvasElement,
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
      : !isDeeplyEqual(this.dynamicShapes, this.prevDynamicShapes) ||
        !isDeeplyEqual(this.erasedShapes, this.prevErasedShapes);

    const selectedShapesChanged = hasForcedRender
      ? false
      : !isDeeplyEqual(this.selectedShapes, this.prevSelectedShapes);
    const selectionChanged = hasForcedRender ? false : !isDeeplyEqual(this.selectionPathPx, this.prevSelectionPath);
    const eraserChanged = hasForcedRender ? false : !isDeeplyEqual(this.eraserPosPx, this.prevEraserPos);
    const viewportSizePx = this.getViewportSizePx();
    const pageSizeChanged = !isDeeplyEqual(this.doc.size_mm, this.prevPageSizeMm);
    const zoomChanged = this.prevPageZoom !== this.doc.zoom_px_per_mm;
    // Tiles are keyed purely by grid position, not by which page they belong to, so flipping
    // pages without this would leave off-screen tiles (rendered against the previous page)
    // stale until something else (e.g. a zoom) happened to clear the whole tile cache.
    const pageIndexChanged = this.prevPageIndex !== this.doc.currentPageIndex;
    const pageGeometryChanged = pageSizeChanged || zoomChanged || pageIndexChanged;

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
    this.scheduleBufferPrewarm(viewportSizePx);

    if (!hasForcedRender || pageGeometryChanged) {
      this.prevStaticShapes = [...this.staticShapes];
      this.prevDynamicShapes = [...this.dynamicShapes];
      this.prevSelectedShapes = [...this.selectedShapes];
      this.prevPageSizeMm = new Vec2(this.doc.size_mm);
      this.prevEraserPos = this.eraserPosPx && new Vec2(this.eraserPosPx);
      this.prevSelectionPath = this.selectionPathPx && [...this.selectionPathPx];
      this.prevPageZoom = this.doc.zoom_px_per_mm;
      this.prevPageIndex = this.doc.currentPageIndex;
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

  private scheduleBufferPrewarm(viewportSizePx: Vec2) {
    if (this.pendingBufferPrewarm !== undefined) {
      window.clearTimeout(this.pendingBufferPrewarm);
    }
    this.pendingBufferPrewarm = window.setTimeout(() => {
      this.pendingBufferPrewarm = undefined;
      if (this.interactionActive) {
        this.scheduleBufferPrewarm(viewportSizePx);
        return;
      }
      const bufferPx = Math.max(viewportSizePx.x, viewportSizePx.y) * TILE_BUFFER_PADDING_FACTOR;
      this.tileManager.prewarmBufferTiles(
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
        bufferPx,
      );
    }, BUFFER_PREWARM_DELAY_MS);
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
