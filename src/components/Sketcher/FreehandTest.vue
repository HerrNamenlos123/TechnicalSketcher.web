<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { getStroke } from "perfect-freehand";
import { Vec2 } from "../types/Vector";

const perfectFreehandAccuracyScaling = 10;
const penSizeMm = 0.3;
const pageGap = 1.03;
const gridColor = "#45b4a6";

const props = defineProps<{
  maxZoom: number;
  minZoom: number;
  zoomSensitivity: number;
}>();

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
  lagCompensation?: boolean;
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
  zoom_px_per_mm = 5;
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
const viewport = ref<HTMLDivElement | null>(null);

const getPath = (points: Point[], mode: "fast" | "accurate") =>
  getStroke(points, {
    size: penSizeMm * perfectFreehandAccuracyScaling,
    smoothing: 1,
    streamline: mode === "fast" ? 0.6 : 0.6,
    thinning: 0.1,
    // smoothing: 0,
    // streamline: 0,
    // thinning: 0,
  });

const drawShape = (
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  mode: "fast" | "accurate",
) => {
  const points = [...shape.points];

  if (shape.lagCompensation) {
    if (shape.points.length >= 3) {
      // This compensates for lag by taking the last 3 points,
      // fitting a polynomial of degree 2 through these points,
      // and then finding the most likely next point by taking
      // a point along that parabola, using an also approximated
      // value for t.
      const x0 = shape.points[shape.points.length - 3].x;
      const y0 = shape.points[shape.points.length - 3].y;
      const x1 = shape.points[shape.points.length - 2].x;
      const y1 = shape.points[shape.points.length - 2].y;
      const x2 = shape.points[shape.points.length - 1].x;
      const y2 = shape.points[shape.points.length - 1].y;

      const aX = (x2 - 2 * x1 + x0) / 2;
      const bX = x1 - aX - x0;
      const cX = x0;

      const aY = (y2 - 2 * y1 + y0) / 2;
      const bY = y1 - aY - y0;
      const cY = y0;

      // The way this is set up, t=0 is the first point, t=2 the third, and t=3
      // would be the next predicted point if they were equally spaced.
      // const t = mouse.x / 300;
      const t = 3;

      const predicted = new Vec2(
        aX * t * t + bX * t + cX,
        aY * t * t + bY * t + cY,
      );

      points.push({
        x: predicted.x,
        y: predicted.y,
        pressure: 0.5,
      });
    }
  }

  const outline = getPath(points, mode);

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
    currentOffsetY += page.size_px.y * pageGap;

    // Render page
    renderPage(page);
  }
  // requestAnimationFrame(render);
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

const performZoom = (ratio: number, center: Vec2) => {
  if (currentDocument.value.zoom_px_per_mm * ratio > props.maxZoom) {
    ratio = props.maxZoom / currentDocument.value.zoom_px_per_mm;
  }
  if (currentDocument.value.zoom_px_per_mm * ratio < props.minZoom) {
    ratio = props.minZoom / currentDocument.value.zoom_px_per_mm;
  }

  const centerToOrigin = currentDocument.value.offset.sub(center);
  currentDocument.value.offset = center.add(centerToOrigin.mul(ratio));
  currentDocument.value.zoom_px_per_mm *= ratio;
};

const handleWheel = (e: WheelEvent) => {
  if (!viewport.value) return;
  e.preventDefault();
  if (e.ctrlKey) {
    const delta = e.deltaX + e.deltaY + e.deltaZ;
    let ratio = 1 - delta * props.zoomSensitivity;
    const center = new Vec2(
      e.clientX - viewport.value.getBoundingClientRect().left,
      e.clientY - viewport.value.getBoundingClientRect().top,
    );
    performZoom(ratio, center);
  } else if (e.shiftKey) {
    currentDocument.value.offset = currentDocument.value.offset.add(
      new Vec2(-e.deltaY, -e.deltaX),
    );
  } else {
    currentDocument.value.offset = currentDocument.value.offset.add(
      new Vec2(-e.deltaX, -e.deltaY),
    );
  }
  render();
};

const pointerEvents = ref<PointerEvent[]>([]);
const isZooming = ref(false);
const lastZoomFingerDistance = ref(0);
const lastZoomCenter = ref(new Vec2());

const updateZoomingPointers = () => {
  if (!viewport.value) return;
  const numberOfFingers = pointerEvents.value.length;
  if (numberOfFingers === 1) {
    currentDocument.value.offset = currentDocument.value.offset.add(
      new Vec2(
        pointerEvents.value[0].movementX,
        pointerEvents.value[0].movementY,
      ),
    );
  } else if (numberOfFingers === 2) {
    const finger1 = new Vec2(
      pointerEvents.value[0].clientX -
        viewport.value.getBoundingClientRect().left,
      pointerEvents.value[0].clientY -
        viewport.value.getBoundingClientRect().top,
    );
    const finger2 = new Vec2(
      pointerEvents.value[1].clientX -
        viewport.value.getBoundingClientRect().left,
      pointerEvents.value[1].clientY -
        viewport.value.getBoundingClientRect().top,
    );
    const center = finger1.add(finger2).div(2);
    const distance = finger2.sub(finger1).mag();

    if (!isZooming.value) {
      isZooming.value = true;
      lastZoomCenter.value = center;
      lastZoomFingerDistance.value = distance;
      return;
    }

    currentDocument.value.offset = currentDocument.value.offset.add(
      center.sub(lastZoomCenter.value),
    );
    performZoom(distance / lastZoomFingerDistance.value, center);
    lastZoomFingerDistance.value = distance;
    lastZoomCenter.value = center;
  } else {
    isZooming.value = false;
  }
};

const findPage = (offsetX: number, offsetY: number) => {
  let currentOffsetY = currentDocument.value.offset.y;
  for (const page of currentDocument.value.pages) {
    page.offset_px = new Vec2(currentDocument.value.offset.x, currentOffsetY);
    page.size_px = page.size_mm
      .mul(currentDocument.value.zoom_px_per_mm)
      .round();
    currentOffsetY += page.size_px.y * pageGap;

    if (
      offsetX > page.offset_px.x &&
      offsetX < page.offset_px.x + page.size_px.x &&
      offsetY > page.offset_px.y &&
      offsetY < page.offset_px.y + page.size_px.y
    ) {
      return page;
    }
  }
  return undefined;
};

const pointerDownHandler = (e: PointerEvent) => {
  if (!viewport.value) return;
  if (e.pointerType == "touch") {
    pointerEvents.value.push(e);
    updateZoomingPointers();
  } else if (e.pointerType == "mouse") {
  } else if (e.pointerType == "pen") {
    e.preventDefault();
    const page = findPage(e.offsetX, e.offsetY);
    if (page) {
      const mousePosPx = new Vec2(
        e.offsetX - page.offset_px.x,
        e.offsetY - page.offset_px.y,
      );
      const mousePosMm = mousePosPx.div(currentDocument.value.zoom_px_per_mm);
      page.previewShape = {
        points: [
          {
            x: mousePosMm.x * perfectFreehandAccuracyScaling,
            y: mousePosMm.y * perfectFreehandAccuracyScaling,
            pressure: 0.5,
          },
        ],
        lagCompensation: true,
      };
    }
  }
  render();
};

const pointerMoveHandler = (e: PointerEvent) => {
  if (!viewport.value) return;
  if (e.pointerType == "touch") {
    const index = pointerEvents.value.findIndex(
      (cachedEv) => cachedEv.pointerId === e.pointerId,
    );
    pointerEvents.value[index] = e;
    updateZoomingPointers();
  } else if (e.pointerType == "mouse") {
  } else if (e.pointerType == "pen") {
    const page = findPage(e.offsetX, e.offsetY);
    if (!page?.previewShape) return;
    if (e.movementX === 0 && e.movementY === 0) return;
    const mousePosPx = new Vec2(
      e.offsetX - page.offset_px.x,
      e.offsetY - page.offset_px.y,
    );
    const mousePosMm = mousePosPx.div(currentDocument.value.zoom_px_per_mm);
    page.previewShape.points.push({
      x: mousePosMm.x * perfectFreehandAccuracyScaling,
      y: mousePosMm.y * perfectFreehandAccuracyScaling,
      pressure: 0.5,
    });
  }
  render();
};

const pointerUpHandler = (e: PointerEvent) => {
  if (!viewport.value) return;
  if (e.pointerType == "touch") {
    const index = pointerEvents.value.findIndex(
      (cachedEv) => cachedEv.pointerId === e.pointerId,
    );
    if (index !== -1) {
      pointerEvents.value.splice(index, 1);
    }
    updateZoomingPointers();
  } else if (e.pointerType == "mouse") {
  } else if (e.pointerType == "pen") {
    const page = findPage(e.offsetX, e.offsetY);
    if (!page?.previewShape) return;
    const mousePosPx = new Vec2(
      e.offsetX - page.offset_px.x,
      e.offsetY - page.offset_px.y,
    );
    const mousePosMm = mousePosPx.div(currentDocument.value.zoom_px_per_mm);
    page.previewShape.points.push({
      x: mousePosMm.x * perfectFreehandAccuracyScaling,
      y: mousePosMm.y * perfectFreehandAccuracyScaling,
      pressure: 0.5,
    });

    drawShape(page.offscreenCtx, page.previewShape, "accurate");
    page.shapes.push({ points: page.previewShape.points });
    page.previewShape = undefined;
  }
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
  <div
    ref="viewport"
    class="relative w-full h-full overflow-hidden bg-black"
    @pointercancel="pointerUpHandler($event)"
    @pointerdown="pointerDownHandler($event)"
    @pointerleave="pointerUpHandler($event)"
    @pointermove="pointerMoveHandler($event)"
    @pointerover="pointerUpHandler($event)"
    @pointerup="pointerUpHandler($event)"
    @wheel="handleWheel"
  >
    <canvas
      v-for="page in currentDocument.pages"
      :key="page.pageNumber"
      ref="pageCanvas"
      class="absolute bg-white pointer-events-none"
      :style="{
        left: page.offset_px.x + 'px',
        top: page.offset_px.y + 'px',
      }"
    />
  </div>
</template>
