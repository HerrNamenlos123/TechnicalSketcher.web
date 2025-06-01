<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { getStroke } from "perfect-freehand";
import { Vec2 } from "../types/Vector";

const perfectFreehandAccuracyScaling = 10;
const penSizeMm = 0.3;
const gridColor = "#45b4a6";

function assert<T>(
  value: T | null | undefined,
  message?: string,
): asserts value is T {
  if (!value) throw new Error(message ?? "Assertion failed");
}

type Point = {
  x: number;
  y: number;
  pressure: number;
};

type Shape = {
  points: Point[];
};

class Page {
  shapes: Shape[] = [];
  previewShape: Shape | undefined;
  pageNumber: number;
  size_mm = new Vec2(210, 297);
  size_px = new Vec2();
  offset_px = new Vec2();
  visibleCanvas: HTMLCanvasElement | null = null;
  offscreenCanvas: HTMLCanvasElement | null = null;

  get visibleCtx() {
    assert(this.visibleCanvas);
    return this.visibleCanvas.getContext("2d")!;
  }

  get offscreenCtx() {
    assert(this.offscreenCanvas);
    return this.offscreenCanvas.getContext("2d")!;
  }

  constructor(pageNumber: number) {
    this.pageNumber = pageNumber;
  }
}

class Document {
  pages: Page[] = [];
  zoom_px_per_mm = 3;
  offset = new Vec2(0, 0);

  constructor() {}
}

const currentDocument = ref<Document>(new Document());
onMounted(() => {
  currentDocument.value.offset = new Vec2(300, 100);
  currentDocument.value.pages.push(new Page(0));
  currentDocument.value.pages.push(new Page(1));
});

const pageCanvas = ref<HTMLCanvasElement[] | null>(null);
const viewport = ref<HTMLDivElement[] | null>(null);

const getPath = (points: Point[], mode: "fast" | "accurate") =>
  getStroke(points, {
    size: penSizeMm * perfectFreehandAccuracyScaling,
    smoothing: 1,
    streamline: mode === "fast" ? 0.6 : 0.6,
    thinning: 0.1,
  });

const drawShape = (
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  mode: "fast" | "accurate",
) => {
  const outline = getPath(shape.points, mode);

  const scalingFactor =
    currentDocument.value.zoom_px_per_mm / perfectFreehandAccuracyScaling;

  ctx.beginPath();
  ctx.moveTo(outline[0][0] * scalingFactor, outline[0][1] * scalingFactor);
  for (let i = 1; i < outline.length; i++) {
    ctx.lineTo(outline[i][0] * scalingFactor, outline[i][1] * scalingFactor);
  }
  ctx.closePath();
  ctx.fillStyle = "black";
  ctx.fill();
};

const render = () => {
  let currentOffsetY = currentDocument.value.offset.y;
  for (const page of currentDocument.value.pages) {
    // Setup page
    assert(page.visibleCanvas);
    page.offset_px = new Vec2(currentDocument.value.offset.x, currentOffsetY);
    page.size_px = page.size_mm
      .mul(currentDocument.value.zoom_px_per_mm)
      .round();
    currentOffsetY += page.size_px.y * 1.03;

    // Render page
    renderPage(page);
  }
  // requestAnimationFrame(render);
};

const start = (e: PointerEvent, page: Page) => {
  if (e.pointerType !== "pen") return;
  const mousePosPx = new Vec2(e.offsetX, e.offsetY);
  const mousePosMm = mousePosPx.div(currentDocument.value.zoom_px_per_mm);
  page.previewShape = {
    points: [
      {
        x: mousePosMm.x * perfectFreehandAccuracyScaling,
        y: mousePosMm.y * perfectFreehandAccuracyScaling,
        pressure: 0.5,
      },
    ],
  };
  render();
};

const draw = (e: PointerEvent, page: Page) => {
  if (e.pointerType !== "pen") return;
  if (!page.previewShape) return;
  if (e.movementX === 0 && e.movementY === 0) return;
  const mousePosPx = new Vec2(e.offsetX, e.offsetY);
  const mousePosMm = mousePosPx.div(currentDocument.value.zoom_px_per_mm);
  page.previewShape.points.push({
    x: mousePosMm.x * perfectFreehandAccuracyScaling,
    y: mousePosMm.y * perfectFreehandAccuracyScaling,
    pressure: 0.5,
  });
  render();
};

const end = (e: PointerEvent, page: Page) => {
  if (e.pointerType !== "pen") return;
  if (!page.previewShape) return;
  const mousePosPx = new Vec2(e.offsetX, e.offsetY);
  const mousePosMm = mousePosPx.div(currentDocument.value.zoom_px_per_mm);
  page.previewShape.points.push({
    x: mousePosMm.x * perfectFreehandAccuracyScaling,
    y: mousePosMm.y * perfectFreehandAccuracyScaling,
    pressure: 0.5,
  });

  drawShape(page.offscreenCtx, page.previewShape, "accurate");
  page.shapes.push(page.previewShape);
  page.previewShape = undefined;
  render();
};

const renderPage = (page: Page) => {
  assert(page.visibleCanvas);
  assert(page.offscreenCanvas);

  // Offscreen canvas
  if (
    page.offscreenCanvas.width !== page.size_px.x ||
    page.offscreenCanvas.height !== page.size_px.y
  ) {
    page.offscreenCanvas.width = page.size_px.x;
    page.offscreenCanvas.height = page.size_px.y;
    // This clears the canvas automatically

    const ctx = page.offscreenCtx;
    const lineWidthMm = 0.3;
    const lineDistanceMm = 10;
    ctx.lineWidth = lineWidthMm * currentDocument.value.zoom_px_per_mm;
    ctx.lineCap = "butt";
    ctx.strokeStyle = gridColor;
    for (let y = 0; y < page.size_mm.y; y += lineDistanceMm) {
      ctx.beginPath();
      ctx.moveTo(0, y * currentDocument.value.zoom_px_per_mm);
      ctx.lineTo(page.size_px.x, y * currentDocument.value.zoom_px_per_mm);
      ctx.stroke();
    }

    for (const page of currentDocument.value.pages) {
      for (const shape of page.shapes) {
        drawShape(page.offscreenCtx, shape, "accurate");
      }
    }
  }

  // Normal canvas
  if (
    page.visibleCanvas.width !== page.size_px.x ||
    page.visibleCanvas.height !== page.size_px.y
  ) {
    page.visibleCanvas.width = page.size_px.x;
    page.visibleCanvas.height = page.size_px.y;
    // This clears the canvas automatically
  }
  // Clear it every frame
  page.visibleCtx.clearRect(0, 0, page.size_px.x, page.size_px.y);

  page.visibleCtx.drawImage(page.offscreenCanvas, 0, 0);

  if (page.previewShape) {
    drawShape(page.visibleCtx, page.previewShape, "fast");
  }
};

const zoom = (e: WheelEvent) => {
  const zoomSpeed = 0.001;
  const ratio = 1 - zoomSpeed * (e.deltaX + e.deltaY + e.deltaZ);
  currentDocument.value.zoom_px_per_mm *= ratio;
  render();
};

const makeOffscreenCanvas = (size: Vec2) => {
  const offscreen = document.createElement("canvas");
  offscreen.width = size.x;
  offscreen.height = size.y;
  return offscreen;
};

onMounted(async () => {
  await nextTick();
  if (!pageCanvas.value) throw new Error("Canvas ref not available");
  for (let i = 0; i < currentDocument.value.pages.length; i++) {
    const page = currentDocument.value.pages[i];
    page.visibleCanvas = pageCanvas.value[i];
    page.offscreenCanvas = makeOffscreenCanvas(new Vec2(0, 0));
  }
  render();
});
</script>

<template>
  <div ref="viewport" class="relative w-full h-full bg-black" @wheel="zoom">
    <canvas
      v-for="page in currentDocument.pages"
      :key="page.pageNumber"
      ref="pageCanvas"
      class="absolute bg-white"
      :style="{
        left: page.offset_px.x + 'px',
        top: page.offset_px.y + 'px',
      }"
      @pointercancel="end($event, page)"
      @pointerdown="start($event, page)"
      @pointermove="draw($event, page)"
      @pointerover="end($event, page)"
      @pointerup="end($event, page)"
    />
  </div>
</template>
