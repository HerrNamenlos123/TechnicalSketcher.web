import { isDeeplyEqual } from "@/deep-equal";
import { getDocumentSizePx, type Document, type Shape } from "./Document";
import { RenderLayer } from "./RenderLayer";
import { assert, useStore } from "./store";
import { Vec2 } from "./Vector";

export class Renderer {
    mainRenderer: RenderLayer;
    preRenderer: RenderLayer;

    staticShapes: Shape[] = [];
    dynamicShapes: Shape[] = [];
    selectionPathPx: undefined | Vec2[] = undefined;
    eraserPosPx: Vec2 | undefined = undefined;

    private prevStaticShapes: Shape[] = [];
    private prevDynamicShapes: Shape[] = [];
    private prevSelectionPath: undefined | Vec2[] = undefined;
    private prevEraserPos: Vec2 | undefined = undefined;
    private prevPageSizeMm: Vec2 = new Vec2();
    private prevPageZoom: number = 0;

    constructor(public doc: Document, mainCanvasElement: HTMLCanvasElement) {
        const store = useStore();
        const size = store.pxToMm(this.pageSize);
        this.mainRenderer = new RenderLayer(size, doc, mainCanvasElement);
        this.preRenderer = new RenderLayer(size, doc);
    }

    async render() {
        const store = useStore();

        const staticChanged = !isDeeplyEqual(this.staticShapes, this.prevStaticShapes);
        const dynamicChanged = !isDeeplyEqual(this.dynamicShapes, this.prevDynamicShapes);

        const selectionChanged = !isDeeplyEqual(this.selectionPathPx, this.prevSelectionPath);
        const eraserChanged = !isDeeplyEqual(this.eraserPosPx, this.prevEraserPos);
        const forceShallowRerender = !isDeeplyEqual(this.doc.size_mm, this.prevPageSizeMm) || this.prevPageZoom !== this.doc.zoom_px_per_mm;

        if (staticChanged || store.deepRender) {
            await this.preRender();
            console.log("Static render", staticChanged)
        }
        if (dynamicChanged || selectionChanged || eraserChanged || forceShallowRerender || store.deepRender) {
            await this.shallowRender();
            console.log("dynamic render")
        }
        this.prevStaticShapes = [...this.staticShapes];
        this.prevDynamicShapes = [...this.dynamicShapes];
        this.prevPageSizeMm = new Vec2(this.doc.size_mm);
        this.prevEraserPos = this.eraserPosPx && new Vec2(this.eraserPosPx);
        this.prevSelectionPath = this.selectionPathPx && [...this.selectionPathPx];
        this.prevPageZoom = this.doc.zoom_px_per_mm;
        store.triggerRender = false;
        store.deepRender = false;
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

        if (this.page.previewLine) {
            this.mainRenderer.drawShape(this.page.previewLine);
        }

        if (this.eraserPosPx) {
            this.mainRenderer.drawCircle(this.eraserPosPx, store.eraserSizePx / 2);
        }

        // for (const shape of selectedLineShapes.value) {
        //     const bbox = buildShapeBBox(shape);
        //     viewCtx.lineWidth = 1;
        //     viewCtx.strokeStyle = "#e77b00";
        //     const posMm = new Vec2(bbox.left, bbox.top);
        //     const sizeMm = new Vec2(bbox.right - bbox.left, bbox.bottom - bbox.top);
        //     const posPx = posMm.mul(currentDocument.value.zoom_px_per_mm);
        //     const sizePx = sizeMm.mul(currentDocument.value.zoom_px_per_mm);
        //     viewCtx.strokeRect(posPx.x, posPx.y, sizePx.x, sizePx.y);
        // }

        // for (const image of selectedImageShapes.value) {
        //     viewCtx.lineWidth = 1;
        //     viewCtx.strokeStyle = "#e77b00";
        //     viewCtx.strokeRect(
        //         image.position.x * currentDocument.value.zoom_px_per_mm,
        //         image.position.y * currentDocument.value.zoom_px_per_mm,
        //         image.size.x * currentDocument.value.zoom_px_per_mm,
        //         image.size.y * currentDocument.value.zoom_px_per_mm,
        //     );
        // }
    }

    get page() {
        return this.doc.pages[this.doc.currentPageIndex];
    }

    get pageSize() {
        return getDocumentSizePx(this.doc);
    }

}