<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Vec2 } from "./Vector";
import {
  getCtx,
  getDocumentSizePx,
  type Document,
  type Page,
  type Shape,
} from "./Document";
import { useStore } from "./store";

const store = useStore();

const currentDocument = defineModel<Document>("document", { required: true });

const props = defineProps<{
  maxZoom: number;
  minZoom: number;
  zoomSensitivity: number;
}>();

const mainCanvas = ref<HTMLCanvasElement>();
const viewport = ref<HTMLDivElement>();

const drawShape = async (
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  document: Document,
  mode: "fast" | "accurate",
) => {
  const points = [...shape.points];
  if (!viewport.value) return;

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

  const outline = store.getPath(shape.penThickness, points, mode);

  const scalingFactor =
    currentDocument.value.zoom_px_per_mm / store.perfectFreehandAccuracyScaling;

  const topLeft = new Vec2(
    currentDocument.value.offset.x,
    currentDocument.value.offset.y,
  );
  const bottomRight = topLeft.add(getDocumentSizePx(document));

  if (topLeft.x < 0) {
    topLeft.x = 0;
  }
  if (topLeft.y < 0) {
    topLeft.y = 0;
  }
  if (bottomRight.x > viewport.value.getBoundingClientRect().width) {
    bottomRight.x = viewport.value.getBoundingClientRect().width;
  }
  if (bottomRight.y > viewport.value.getBoundingClientRect().height) {
    bottomRight.y = viewport.value.getBoundingClientRect().height;
  }

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high"; // optional: "low", "medium", "high"
  ctx.beginPath();
  ctx.moveTo(outline[0][0] * scalingFactor, outline[0][1] * scalingFactor);

  for (let i = 1; i < outline.length - 1; i++) {
    const [x0, y0] = outline[i].map((v) => v * scalingFactor);
    const [x1, y1] = outline[i + 1].map((v) => v * scalingFactor);
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    ctx.quadraticCurveTo(x0, y0, mx, my);
  }

  ctx.closePath();
  ctx.fillStyle = shape.penColor;
  ctx.fill();

  ctx.restore();
};

const createCanvas = () => {
  const canvas = document.createElement("canvas");
  const pageSize = getDocumentSizePx(currentDocument.value);
  canvas.width = pageSize.x;
  canvas.height = pageSize.y;
  return canvas;
};

// const getCanvasFromPool = (pageIndex: number) => {
//   // First invalidate out of range pages
//   for (const entry of store.canvasPool) {
//     if (
//       entry.pageIndex &&
//       (entry.pageIndex > pageIndex + 4 || entry.pageIndex < pageIndex - 4)
//     ) {
//       entry.pageIndex = undefined;
//     }
//   }
//   // Reuse page if already exists
//   for (const entry of store.canvasPool) {
//     if (entry.pageIndex === pageIndex) {
//       return entry.canvas;
//     }
//   }
//   // Use unused canvas if any exist
//   for (const entry of store.canvasPool) {
//     if (entry.pageIndex === undefined) {
//       entry.pageIndex = pageIndex;
//       return entry.canvas;
//     }
//   }
//   // If all are used, create a new one
//   const canvas = createCanvas();
//   store.canvasPool.push({
//     canvas: canvas,
//     pageIndex: pageIndex,
//   });
//   return canvas;
// };

const render = async () => {
  if (!currentDocument.value || !store.currentPageCanvas) return;
  const pageIndex = currentDocument.value.currentPageIndex;
  if (pageIndex >= 0 && pageIndex < currentDocument.value?.pages.length) {
    const page = currentDocument.value.pages[pageIndex];

    // const canvas = getCanvasFromPool(pageIndex);
    await renderPage(store.currentPageCanvas, page, currentDocument.value);
  }
  // requestAnimationFrame(render);
};

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | ImageBitmap,
  canvasWidth: number,
  canvasHeight: number,
) {
  const iw = img.width;
  const ih = img.height;
  const cw = canvasWidth;
  const ch = canvasHeight;

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

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
}

const renderPage = async (
  offCanvas: HTMLCanvasElement,
  page: Page,
  doc: Document,
) => {
  const pageSize = getDocumentSizePx(doc);
  let offCtx = getCtx(offCanvas);
  const viewCtx = getCtx(mainCanvas.value);

  // Offscreen canvas
  if (
    !isZooming.value &&
    (offCanvas.width !== pageSize.x ||
      offCanvas.height !== pageSize.y ||
      store.flushCanvas)
  ) {
    offCanvas.width = pageSize.x;
    offCanvas.height = pageSize.y;
    store.flushCanvas = false;
    // This clears the canvas automatically
    offCtx = getCtx(offCanvas);

    if (store.paperTexture) {
      drawImageCover(offCtx, store.paperTexture, pageSize.x, pageSize.y);
    }

    console.log("Rerendering offscreen canvas");

    await store.drawGridCanvas(offCtx, currentDocument.value);

    for (const shape of page.shapes) {
      await drawShape(offCtx, shape, currentDocument.value, "accurate");
    }
  }

  // Normal canvas
  if (!mainCanvas.value) {
    return;
  }
  if (
    mainCanvas.value.width !== pageSize.x ||
    mainCanvas.value.height !== pageSize.y
  ) {
    mainCanvas.value.width = pageSize.x;
    mainCanvas.value.height = pageSize.y;
    // This clears the canvas automatically
  }
  // Clear it every frame
  viewCtx.clearRect(0, 0, pageSize.x, pageSize.y);

  viewCtx.drawImage(offCanvas, 0, 0, pageSize.x, pageSize.y);

  if (page.previewShape) {
    console.log("Rendering preview", page.previewShape.points.length);
    await drawShape(viewCtx, page.previewShape, currentDocument.value, "fast");
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
  const pageSize = getDocumentSizePx(currentDocument.value);
  const offsetPx = currentDocument.value.offset;

  if (
    offsetX > offsetPx.x &&
    offsetX < offsetPx.x + pageSize.x &&
    offsetY > offsetPx.y &&
    offsetY < offsetPx.y + pageSize.y
  ) {
    return currentDocument.value.pages[currentDocument.value.currentPageIndex];
  }
  return undefined;
};

const pointerDownHandler = (e: PointerEvent) => {
  if (!viewport.value) return;
  if (e.pointerType == "touch") {
    pointerEvents.value.push(e);
    updateZoomingPointers();
  } else if (e.pointerType == "mouse") {
    //
  } else if (e.pointerType == "pen") {
    e.preventDefault();
    const eraser = (e.buttons & 32) !== 0;
    const page = findPage(e.offsetX, e.offsetY);
    if (!page) return;
    if (page && !eraser) {
      const mousePosPx = new Vec2(e.offsetX, e.offsetY).sub(
        currentDocument.value.offset,
      );
      const mousePosMm = mousePosPx.div(currentDocument.value.zoom_px_per_mm);
      page.previewShape = {
        points: [
          {
            x: mousePosMm.x * store.perfectFreehandAccuracyScaling,
            y: mousePosMm.y * store.perfectFreehandAccuracyScaling,
            pressure: 0.5,
          },
        ],
        lagCompensation: store.lagCompensation,
        penColor: store.penColor,
        penThickness: store.penSizeMm,
      };
    } else if (eraser) {
      page.previewShape = undefined;
    }
  }
  store.forceRender = true;
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
    //
  } else if (e.pointerType == "pen") {
    const eraser = (e.buttons & 32) !== 0;
    const page = findPage(e.offsetX, e.offsetY);
    if (!page) return;
    const mousePosPx = new Vec2(e.offsetX, e.offsetY).sub(
      currentDocument.value.offset,
    );
    const mousePosMm = mousePosPx.div(currentDocument.value.zoom_px_per_mm);
    if (!eraser) {
      if (!page?.previewShape) return;
      if (e.movementX === 0 && e.movementY === 0) return;
      page.previewShape.points.push({
        x: mousePosMm.x * store.perfectFreehandAccuracyScaling,
        y: mousePosMm.y * store.perfectFreehandAccuracyScaling,
        pressure: 0.5,
      });
    } else {
      for (const shape of page.shapes) {
        const deleteDistance = shape.penThickness / 2;
        for (const point of shape.points) {
          if (
            new Vec2(
              point.x / store.perfectFreehandAccuracyScaling,
              point.y / store.perfectFreehandAccuracyScaling,
            )
              .sub(mousePosMm)
              .mag() < deleteDistance
          ) {
            page.shapes = page.shapes.filter((s) => s !== shape);
            store.forceRender = true;
            store.flushCanvas = true;
            return;
          }
        }
      }
    }
  }
  store.forceRender = true;
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
    //
  } else if (e.pointerType == "pen") {
    const page = findPage(e.offsetX, e.offsetY);
    if (!page?.previewShape) return;
    const mousePosPx = new Vec2(e.offsetX, e.offsetY).sub(
      currentDocument.value.offset,
    );
    const mousePosMm = mousePosPx.div(currentDocument.value.zoom_px_per_mm);
    page.previewShape.points.push({
      x: mousePosMm.x * store.perfectFreehandAccuracyScaling,
      y: mousePosMm.y * store.perfectFreehandAccuracyScaling,
      pressure: 0.5,
    });

    // const pooledCanvas = store.canvasPool.find(
    //   (e) => e.pageIndex === page.pageIndex,
    // );
    // if (pooledCanvas) {
    drawShape(
      getCtx(store.currentPageCanvas),
      page.previewShape,
      currentDocument.value,
      "accurate",
    );
    // } else {
    //   console.warn("Page not found");
    // }
    page.shapes.push({
      points: page.previewShape.points,
      penColor: store.penColor,
      penThickness: store.penSizeMm,
    });
    page.previewShape = undefined;

    if (page.pageIndex === currentDocument.value.pages.length - 1) {
      currentDocument.value.pages.push({
        pageIndex: currentDocument.value.pages.length,
        shapes: [],
      });
    }

    store.saveDocument(currentDocument.value);
  }
  store.forceRender = true;
};

watch(
  () => store.forceRender,
  async () => {
    await nextTick();
    await nextTick();
    if (store.forceRender) {
      store.forceRender = false;
      render();
    }
  },
  { immediate: true },
);

const keydown = (e: KeyboardEvent) => {
  if (e.key === "s" && e.ctrlKey) {
    e.preventDefault();
    if (currentDocument.value.fileHandle) {
      store.saveDocument(currentDocument.value);
    } else {
      console.error("Current file has no handle attached");
    }
  }

  if (e.key === "1") {
    store.penColor = "#000000";
  }
  if (e.key === "2") {
    store.penColor = "#FF0000";
  }
  if (e.key === "3") {
    store.penColor = "#00FF00";
  }
  if (e.key === "4") {
    store.penColor = "#03c4ff";
  }
  if (e.key === "q") {
    store.penSizeMm = 0.2;
  }
  if (e.key === "w") {
    store.penSizeMm = 0.3;
  }
  if (e.key === "e") {
    store.penSizeMm = 0.4;
  }
  if (e.key === "r") {
    store.penSizeMm = 0.5;
  }
};

onMounted(async () => {
  window.addEventListener("keydown", keydown);
  store.currentPageCanvas = createCanvas();
  await nextTick();
  await nextTick();
  render();
});

watch(
  [
    () => mainCanvas.value,
    () => currentDocument.value.size_mm,
    () => currentDocument.value.zoom_px_per_mm,
  ],
  () => {
    if (mainCanvas.value) {
      const pageSize = getDocumentSizePx(currentDocument.value);
      mainCanvas.value.width = pageSize.x;
      mainCanvas.value.height = pageSize.y;
    }
  },
  { immediate: true, deep: true },
);

onUnmounted(() => {
  window.removeEventListener("keydown", keydown);
  // for (const entry of store.canvasPool) {
  //   entry.pageIndex = -1;
  // }
});
</script>

<template>
  <div
    ref="viewport"
    class="relative w-full h-full overflow-hidden bg-black"
    @keydown="keydown"
    @pointercancel="pointerUpHandler($event)"
    @pointerdown="pointerDownHandler($event)"
    @pointerleave="pointerUpHandler($event)"
    @pointermove="pointerMoveHandler($event)"
    @pointerover="pointerUpHandler($event)"
    @pointerup="pointerUpHandler($event)"
    @wheel="handleWheel"
  >
    <canvas
      ref="mainCanvas"
      class="absolute pointer-events-none rounded-r-3xl"
      :style="{
        left: currentDocument.offset.x + 'px',
        top: currentDocument.offset.y + 'px',
        backgroundColor: currentDocument.pageColor,
      }"
    />
  </div>
</template>
