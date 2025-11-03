import { isDeeplyEqual } from "@/deep-equal";
import { getDocumentSizePx, type Document, type Shape } from "./Document";
import { RenderLayer } from "./RenderLayer";
import { assert, combineBBox, useStore } from "./store";
import { Vec2 } from "./Vector";

export class Renderer {
  mainRenderer: RenderLayer;
  preRenderer: RenderLayer;

  staticShapes: Shape[] = [];
  dynamicShapes: Shape[] = [];
  selectedShapes: Shape[] = [];
  selectionPathPx: undefined | Vec2[] = undefined;
  eraserPosPx: Vec2 | undefined = undefined;

  newlyInsertedShapes: Shape[] = [];

  private prevStaticShapes: Shape[] = [];
  private prevDynamicShapes: Shape[] = [];
  private prevSelectedShapes: Shape[] = [];
  private prevSelectionPath: undefined | Vec2[] = undefined;
  private prevEraserPos: Vec2 | undefined = undefined;
  private prevPageSizeMm: Vec2 = new Vec2();
  private prevPageZoom: number = 0;

  constructor(
    public doc: Document,
    mainCanvasElement: HTMLCanvasElement
  ) {
    const store = useStore();
    const size = store.pxToMm(this.pageSize);
    this.mainRenderer = new RenderLayer(size, doc, true, mainCanvasElement);
    this.preRenderer = new RenderLayer(size, doc, false);
  }

  async render() {
    const store = useStore();

    // Filter newly inserted shapes, because when a shape is inserted and rendered onto the prerender buffer,
    // we do not need to redraw it entirely, so the check must be skipped. However, when any other shape
    // changes at the same time as we insert a new one, we still want to redraw. So we can't simply skip the check,
    // we must exclude the new shape from the check.
    const staticWithoutNewlyInserted = this.staticShapes.filter((s) => !this.newlyInsertedShapes.includes(s));

    const staticChanged = !isDeeplyEqual(staticWithoutNewlyInserted, this.prevStaticShapes);
    const dynamicChanged = !isDeeplyEqual(this.dynamicShapes, this.prevDynamicShapes);

    const selectedShapesChanged = !isDeeplyEqual(this.selectedShapes, this.prevSelectedShapes);
    const selectionChanged = !isDeeplyEqual(this.selectionPathPx, this.prevSelectionPath);
    const eraserChanged = !isDeeplyEqual(this.eraserPosPx, this.prevEraserPos);
    const forceShallowRerender =
      !isDeeplyEqual(this.doc.size_mm, this.prevPageSizeMm) || this.prevPageZoom !== this.doc.zoom_px_per_mm;

    if (staticChanged || store.forceDeepRender) {
      await this.preRender();
      // console.log("Static render", staticChanged)
    }
    if (
      dynamicChanged ||
      selectionChanged ||
      eraserChanged ||
      forceShallowRerender ||
      store.forceDeepRender ||
      selectedShapesChanged ||
      store.forceShallowRender
    ) {
      await this.shallowRender();
      // console.log("dynamic render", dynamicChanged, selectionChanged, eraserChanged, forceShallowRerender, store.forceDeepRender, selectedShapesChanged)
    }
    this.prevStaticShapes = [...this.staticShapes];
    this.prevDynamicShapes = [...this.dynamicShapes];
    this.prevSelectedShapes = [...this.selectedShapes];
    this.prevPageSizeMm = new Vec2(this.doc.size_mm);
    this.prevEraserPos = this.eraserPosPx && new Vec2(this.eraserPosPx);
    this.prevSelectionPath = this.selectionPathPx && [...this.selectionPathPx];
    this.prevPageZoom = this.doc.zoom_px_per_mm;
    this.newlyInsertedShapes = [];
    store.triggerRender = false;
    store.forceDeepRender = false;
    store.forceShallowRender = false;
  }

  async renderNewShapeToPrerenderer(shape: Shape) {
    const store = useStore();
    this.newlyInsertedShapes.push(shape);
    this.preRenderer.drawShape(shape);
    store.forceShallowRender = true;
  }

  private async preRender() {
    const store = useStore();
    this.preRenderer.resizeAndClear(store.mmToPx(this.doc.size_mm));
    assert(store.paperTexture);
    this.preRenderer.drawImageCovering(store.paperTexture);
    this.preRenderer.drawGrid();

    for (const shape of this.staticShapes) {
      this.preRenderer.drawShape(shape);
    }
  }

  async shallowRender() {
    const store = useStore();
    this.mainRenderer.resizeAndClear(store.mmToPx(this.doc.size_mm));

    this.mainRenderer.drawRenderLayer(this.preRenderer);
    if (this.selectionPathPx) {
      this.mainRenderer.drawDashedPolygon(this.selectionPathPx);
    }

    for (const shape of this.dynamicShapes) {
      this.mainRenderer.drawShape(shape);
    }

    if (this.eraserPosPx) {
      this.mainRenderer.drawCircle(this.eraserPosPx, store.eraserSizePx / 2);
    }

    if (this.selectedShapes.length > 0) {
      let combinedBbox = this.selectedShapes[0].bbox;
      for (const shape of this.selectedShapes) {
        combinedBbox = combineBBox(combinedBbox, shape.bbox);
        this.mainRenderer.drawSelectionBbox(shape.bbox);
      }
      this.mainRenderer.drawSelectionBbox(combinedBbox);

      this.mainRenderer.drawResizeHandle(new Vec2(combinedBbox.right, combinedBbox.bottom));
    }
  }

  get page() {
    return this.doc.pages[this.doc.currentPageIndex];
  }

  get pageSize() {
    return getDocumentSizePx(this.doc);
  }
}
