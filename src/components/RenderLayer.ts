import { getDocumentSizePx, type BBox, type Document, type ImageShape, type LineShape, type Shape } from "./Document";
import { assert, RESIZE_HANDLE_SIZE, useStore } from "./store";
import { Vec2 } from "./Vector";

export class RenderLayer {
    public canvas: HTMLCanvasElement;

    constructor(size: Vec2, public doc: Document, public applyScale: boolean, canvasElement?: HTMLCanvasElement) {
        const scale = window.devicePixelRatio;
        this.canvas = canvasElement || document.createElement("canvas");
        this.canvas.width = size.x * scale;
        this.canvas.height = size.y * scale;
    }

    get ctx() {
        const ctx = this.canvas.getContext("2d");
        assert(ctx);
        return ctx;
    }

    resizeAndClear(size: Vec2) {
        const scale = window.devicePixelRatio;
        this.canvas.width = size.x * scale;
        this.canvas.height = size.y * scale;
        this.clear();
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawRenderLayer(layer: RenderLayer) {
        this.ctx.drawImage(layer.canvas, 0, 0, this.canvas.width, this.canvas.height);
    }

    drawShape(shape: Shape) {
        switch (shape.variant) {
            case "Line":
                this.drawLineShape(shape);
                break;

            case "Image":
                this.drawImageShape(shape);
                break;
        }
    }

    drawImageShape(shape: ImageShape) {
        this.ctx.save();
        this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = "high"; // optional: "low", "medium", "high"
        this.ctx.beginPath();

        this.ctx.drawImage(
            shape.image,
            shape.position.x * this.doc.zoom_px_per_mm,
            shape.position.y * this.doc.zoom_px_per_mm,
            shape.size.x * this.doc.zoom_px_per_mm,
            shape.size.y * this.doc.zoom_px_per_mm,
        );

        this.ctx.restore();
    }

    drawLineShape(shape: LineShape) {
        const store = useStore();
        const points = [...shape.points];

        const outline = store.getPath(shape.penThickness, points, "accurate");
        const scalingFactor = this.doc.zoom_px_per_mm;

        this.ctx.save();
        this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        this.ctx.beginPath();
        this.ctx.moveTo(outline[0][0] * scalingFactor, outline[0][1] * scalingFactor);

        for (let i = 1; i < outline.length - 1; i++) {
            const [x0, y0] = outline[i].map((v) => v * scalingFactor);
            const [x1, y1] = outline[i + 1].map((v) => v * scalingFactor);
            const mx = (x0 + x1) / 2;
            const my = (y0 + y1) / 2;
            this.ctx.quadraticCurveTo(x0, y0, mx, my);
        }

        this.ctx.closePath();
        this.ctx.fillStyle = shape.penColor;
        this.ctx.fill();

        this.ctx.restore();
    }

    drawSelectionBbox(bbox: BBox) {
        this.ctx.save();
        this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        this.ctx.lineWidth = 1;
        this.ctx.strokeStyle = "#e77b00";
        const posMm = new Vec2(bbox.left, bbox.top);
        const sizeMm = new Vec2(bbox.right - bbox.left, bbox.bottom - bbox.top);
        const posPx = posMm.mul(this.doc.zoom_px_per_mm);
        const sizePx = sizeMm.mul(this.doc.zoom_px_per_mm);
        this.ctx.strokeRect(posPx.x, posPx.y, sizePx.x, sizePx.y);
        this.ctx.restore();
    }

    drawResizeHandle(pos: Vec2) {
        this.ctx.save();
        this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        this.ctx.lineWidth = 1;
        this.ctx.strokeStyle = "black";
        this.ctx.fillStyle = "white";
        const posPx = pos.mul(this.doc.zoom_px_per_mm);
        this.ctx.fillRect(posPx.x - RESIZE_HANDLE_SIZE / 2, posPx.y - RESIZE_HANDLE_SIZE / 2, RESIZE_HANDLE_SIZE, RESIZE_HANDLE_SIZE);
        this.ctx.strokeRect(posPx.x - RESIZE_HANDLE_SIZE / 2, posPx.y - RESIZE_HANDLE_SIZE / 2, RESIZE_HANDLE_SIZE, RESIZE_HANDLE_SIZE);
        this.ctx.restore();
    }

    drawImageCovering(
        img: HTMLImageElement | ImageBitmap,
    ) {
        const iw = img.width;
        const ih = img.height;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        const ir = iw / ih;
        const cr = cw / ch;

        let sx = 0,
            sy = 0,
            sw = iw,
            sh = ih;

        if (ir > cr) {
            // Image is wider than canvas: crop sides
            sh = ih;
            sw = ih * cr;
            sx = (iw - sw) / 2;
        } else {
            // Image is taller than canvas: crop top/bottom
            sw = iw;
            sh = iw / cr;
            sy = (ih - sh) / 2;
        }

        this.ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
    }
    drawGrid() {
        const store = useStore();
        this.ctx.save();
        this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        this.ctx.lineWidth = store.mmToPx(store.gridLineThicknessMm);
        this.ctx.lineCap = "butt";
        this.ctx.strokeStyle = this.doc.gridColor;
        for (let y = 0; y < this.doc.size_mm.y; y += store.gridLineDistanceMm) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, store.mmToPx(y));
            this.ctx.lineTo(getDocumentSizePx(this.doc).x, store.mmToPx(y));
            this.ctx.stroke();
        }
        this.ctx.restore();
    }
    drawDashedPolygon(points: Vec2[]) {
        if (points.length < 2) return;

        this.ctx.save();
        this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        this.ctx.fillStyle = "rgba(0, 128, 255, 0.1)";
        this.ctx.strokeStyle = "black";
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([6, 4]);

        this.ctx.beginPath();
        this.ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            this.ctx.lineTo(points[i].x, points[i].y);
        }
        this.ctx.closePath();

        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.restore();
    }
    drawCircle(center: Vec2, radius: number) {
        this.ctx.save();
        this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        this.ctx.beginPath();
        this.ctx.arc(
            center.x,
            center.y,
            radius,
            0,
            Math.PI * 2,
        );
        this.ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        this.ctx.fill();
        this.ctx.lineWidth = 1;
        this.ctx.strokeStyle = "black";
        this.ctx.stroke();
        this.ctx.restore();
    }

}