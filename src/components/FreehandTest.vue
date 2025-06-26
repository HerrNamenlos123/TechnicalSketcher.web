<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Vec2 } from "./Vector";
import {
  getCtx,
  getDocumentSizePx,
  type BBox,
  type Document,
  type ImageShape,
  type Page,
  type Shape,
} from "./Document";
import {
  buildShapeBBox,
  isPointInBBox,
  loadImageAsync,
  useStore,
} from "./store";

enum Action {
  Down,
  Move,
  Up,
}

const CONTEXT_MENU_PERIMETER_LIMIT_PX = 5;

const store = useStore();
const currentDocument = defineModel<Document>("document", { required: true });
const explicitSelectionTool = ref(false);
const selectedLineShapes = ref<Shape[]>([]);
const selectedImageShapes = ref<ImageShape[]>([]);

const movedLineShapes = ref<Shape[]>([]);
const movedImageShapes = ref<ImageShape[]>([]);

const colors = [
  "#000000", // Jet Black
  "#1D4ED8", // Royal Blue
  "#DC2626", // Crimson Red
  "#16A34A", // Emerald Green
  "#CA8A04", // Goldenrod
  "#9333EA", // Vivid Violet
  "#F97316", // Bright Orange
  "#6B7280", // Slate Gray
];

const penThicknesses = [0.2, 0.3, 0.4, 0.5, 0.7];

const props = defineProps<{
  maxZoom: number;
  minZoom: number;
  zoomSensitivity: number;
}>();

const mainCanvas = ref<HTMLCanvasElement>();
const viewport = ref<HTMLDivElement>();
const contextPopupPosPx = ref<undefined | Vec2>();

const drawImage = async (ctx: CanvasRenderingContext2D, image: ImageShape) => {
  if (!viewport.value || !mainCanvas.value) return;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high"; // optional: "low", "medium", "high"
  ctx.beginPath();

  ctx.drawImage(
    image.image,
    image.position.x * currentDocument.value.zoom_px_per_mm,
    image.position.y * currentDocument.value.zoom_px_per_mm,
    image.size.x * currentDocument.value.zoom_px_per_mm,
    image.size.y * currentDocument.value.zoom_px_per_mm,
  );

  ctx.restore();
};

const drawShape = async (ctx: CanvasRenderingContext2D, shape: Shape) => {
  const points = [...shape.points];
  if (!viewport.value || !mainCanvas.value) return;

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

  const outline = store.getPath(shape.penThickness, points, "accurate");
  const scalingFactor = currentDocument.value.zoom_px_per_mm;

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

function drawSelection(ctx: CanvasRenderingContext2D, points: Vec2[]) {
  if (points.length < 2) return;

  ctx.save(); // Save current canvas state

  // Configure fill style (semi-transparent)
  ctx.fillStyle = "rgba(0, 128, 255, 0.1)"; // Light blue with transparency

  // Configure stroke style (thick, dashed black outline)
  ctx.strokeStyle = "black";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]); // Dash 6px, gap 4px

  // Begin path
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }

  ctx.closePath(); // Close the polygon

  ctx.fill(); // Fill the shape
  ctx.stroke(); // Draw the outline

  ctx.restore(); // Restore previous state
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

    await store.drawGridCanvas(offCtx, currentDocument.value);

    for (const image of page.images) {
      if (movedImageShapes.value.includes(image)) continue;
      await drawImage(offCtx, image);
    }

    for (const shape of page.shapes) {
      if (movedLineShapes.value.includes(shape)) continue;
      await drawShape(offCtx, shape);
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
  if (selectionPathPx.value) {
    drawSelection(viewCtx, selectionPathPx.value);
  }

  if (page.previewShape) {
    await drawShape(viewCtx, page.previewShape);
  }

  if (eraserPosPx.value) {
    const ctx = viewCtx;
    ctx.beginPath();
    ctx.arc(
      eraserPosPx.value.x,
      eraserPosPx.value.y,
      store.eraserSizePx / 2,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "black";
    ctx.stroke();
  }

  for (const image of movedImageShapes.value) {
    drawImage(viewCtx, image);
  }

  for (const shape of movedLineShapes.value) {
    drawShape(viewCtx, shape);
  }

  for (const shape of selectedLineShapes.value) {
    const bbox = buildShapeBBox(shape);
    viewCtx.lineWidth = 1;
    viewCtx.strokeStyle = "#e77b00";
    const posMm = new Vec2(bbox.left, bbox.top);
    const sizeMm = new Vec2(bbox.right - bbox.left, bbox.bottom - bbox.top);
    const posPx = posMm.mul(currentDocument.value.zoom_px_per_mm);
    const sizePx = sizeMm.mul(currentDocument.value.zoom_px_per_mm);
    viewCtx.strokeRect(posPx.x, posPx.y, sizePx.x, sizePx.y);
  }

  for (const image of selectedImageShapes.value) {
    viewCtx.lineWidth = 1;
    viewCtx.strokeStyle = "#e77b00";
    viewCtx.strokeRect(
      image.position.x * currentDocument.value.zoom_px_per_mm,
      image.position.y * currentDocument.value.zoom_px_per_mm,
      image.size.x * currentDocument.value.zoom_px_per_mm,
      image.size.y * currentDocument.value.zoom_px_per_mm,
    );
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
const contextClickPositionPx = ref<Vec2 | undefined>(undefined);
const selectionPathPx = ref<undefined | Vec2[]>();
const eraserPosPx = ref<undefined | Vec2>();

const selectionPathPerimeterLength = computed(() => {
  if (!selectionPathPx.value) return 0;
  let perimeterPx = 0;
  for (let i = 0; i < selectionPathPx.value.length - 1; i++) {
    const aPx = selectionPathPx.value[i];
    const bPx = selectionPathPx.value[i + 1];
    const distPx = aPx.sub(bPx).mag();
    perimeterPx += distPx;
  }
  return perimeterPx;
});

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

function pointInPolygon(point: Vec2, polygon: Vec2[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function circleOutlineIntersectsLine(
  c: Vec2,
  r: number,
  a: Vec2,
  b: Vec2,
  epsilon = 0.1, // acceptable tolerance in mm
): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const acx = c.x - a.x;
  const acy = c.y - a.y;

  const abLenSq = abx * abx + aby * aby;
  const t = Math.max(0, Math.min(1, (acx * abx + acy * aby) / abLenSq));

  const closestX = a.x + t * abx;
  const closestY = a.y + t * aby;

  const dx = closestX - c.x;
  const dy = closestY - c.y;

  const dist = Math.sqrt(dx * dx + dy * dy);

  return Math.abs(dist - r) <= epsilon;
}

const buildBoundingBoxForAllShapes = (page: Page) => {
  for (const shape of page.shapes) {
    shape.eraseBBox = buildShapeBBox(shape);
  }
};

const selectShapeUnderCursor = (page: Page, cursorPosMm: Vec2) => {
  buildBoundingBoxForAllShapes(page);

  selectedImageShapes.value = [];
  selectedLineShapes.value = [];

  for (const shape of page.shapes) {
    if (shape.eraseBBox && isPointInBBox(shape.eraseBBox, cursorPosMm)) {
      selectedLineShapes.value = [shape];
      return;
    }
  }

  for (const image of page.images) {
    const bbox: BBox = {
      left: image.position.x,
      top: image.position.y,
      right: image.position.x + image.size.x,
      bottom: image.position.y + image.size.y,
    };
    if (isPointInBBox(bbox, cursorPosMm)) {
      selectedImageShapes.value = [image];
      return;
    }
  }
};

const isCursorOnAnyShape = (page: Page, cursorPosMm: Vec2) => {
  for (const shape of page.shapes) {
    if (isPointInBBox(buildShapeBBox(shape), cursorPosMm)) {
      return true;
    }
  }

  for (const image of page.images) {
    const bbox: BBox = {
      left: image.position.x,
      top: image.position.y,
      right: image.position.x + image.size.x,
      bottom: image.position.y + image.size.y,
    };
    if (isPointInBBox(bbox, cursorPosMm)) {
      return true;
    }
  }
};

const isCursorOnAnySelectedShape = (page: Page, cursorPosMm: Vec2) => {
  for (const shape of page.shapes) {
    if (!selectedLineShapes.value.includes(shape)) continue;
    if (isPointInBBox(buildShapeBBox(shape), cursorPosMm)) {
      return true;
    }
  }

  for (const image of page.images) {
    if (!selectedImageShapes.value.includes(image)) continue;
    const bbox: BBox = {
      left: image.position.x,
      top: image.position.y,
      right: image.position.x + image.size.x,
      bottom: image.position.y + image.size.y,
    };
    if (isPointInBBox(bbox, cursorPosMm)) {
      return true;
    }
  }
};

const mouseEvent = (e: PointerEvent, action: Action) => {
  if (action === Action.Down) {
  } else if (action === Action.Move) {
  } else if (action === Action.Up) {
  }
};

const penEvent = (e: PointerEvent, action: Action) => {
  e.preventDefault();
  if (!viewport.value || !mainCanvas.value) return;

  const eraserButton = (e.buttons & 32) !== 0;
  const stylusButton = (e.buttons & 2) !== 0;
  const penDown = (e.buttons & 1) !== 0;

  const topLeft = new Vec2(
    mainCanvas.value.getBoundingClientRect().left -
      viewport.value.getBoundingClientRect().left,
    mainCanvas.value.getBoundingClientRect().top -
      viewport.value.getBoundingClientRect().top,
  );
  const cursorPosPx = new Vec2(e.offsetX, e.offsetY).sub(topLeft);
  const cursorPosMm = cursorPosPx.div(currentDocument.value.zoom_px_per_mm);

  const currentPage =
    currentDocument.value.pages[currentDocument.value.currentPageIndex];
  // const cursorOnPage =
  //   cursorPosMm.x >= 0 &&
  //   cursorPosMm.x <= currentDocument.value.size_mm.x &&
  //   cursorPosMm.y >= 0 &&
  //   cursorPosMm.y <= currentDocument.value.size_mm.y;

  if (action === Action.Down) {
    if (explicitSelectionTool.value) {
      if (!isCursorOnAnySelectedShape(currentPage, cursorPosMm)) {
        selectedImageShapes.value = [];
        selectedLineShapes.value = [];
      } else {
        movedLineShapes.value = [];
        movedImageShapes.value = [];
        for (const shape of selectedLineShapes.value) {
          movedLineShapes.value.push(shape);
        }
        for (const image of selectedImageShapes.value) {
          movedImageShapes.value.push(image);
        }
        store.forceRender = true;
        store.flushCanvas = true;
        selectionPathPx.value = undefined;
      }
    }

    if (stylusButton || explicitSelectionTool.value) {
      if (
        selectedLineShapes.value.length === 0 &&
        selectedImageShapes.value.length === 0
      ) {
        contextClickPositionPx.value = cursorPosPx;
        selectionPathPx.value = [];
      }
    } else if (eraserButton) {
      currentPage.previewShape = undefined;
      eraserPosPx.value = cursorPosMm.mul(currentDocument.value.zoom_px_per_mm);
      buildBoundingBoxForAllShapes(currentPage);
    } else {
      currentPage.previewShape = {
        points: [
          {
            x: cursorPosMm.x,
            y: cursorPosMm.y,
            pressure: 0.5,
          },
        ],
        lagCompensation: store.lagCompensation,
        penColor: store.penColor,
        penThickness: store.penSizeMm,
      };
    }
  } else if (action === Action.Move) {
    const delta = new Vec2(e.movementX, e.movementY).div(
      currentDocument.value.zoom_px_per_mm,
    );
    if (explicitSelectionTool.value) {
      if (penDown) {
        for (const shape of selectedLineShapes.value) {
          shape.eraseBBox = undefined;
          for (const p of shape.points) {
            p.x += delta.x;
            p.y += delta.y;
          }
        }
        for (const image of selectedImageShapes.value) {
          image.position.x += delta.x;
          image.position.y += delta.y;
        }
        store.forceRender = true;
      }
    }

    if (stylusButton || explicitSelectionTool.value) {
      if (stylusButton || penDown) {
        if (selectionPathPx.value) {
          selectionPathPx.value.push(cursorPosPx);
        }
      }
    } else if (eraserButton) {
      for (const shape of currentPage.shapes) {
        if (!shape.eraseBBox) {
          break;
        }

        const eraserSizeMm =
          store.eraserSizePx / currentDocument.value.zoom_px_per_mm;
        eraserPosPx.value = cursorPosMm.mul(
          currentDocument.value.zoom_px_per_mm,
        );
        const eraserPosMm = cursorPosMm;

        if (
          eraserPosMm.x + eraserSizeMm / 2 < shape.eraseBBox.left ||
          eraserPosMm.x - eraserSizeMm / 2 > shape.eraseBBox.right ||
          eraserPosMm.y + eraserSizeMm / 2 < shape.eraseBBox.top ||
          eraserPosMm.y - eraserSizeMm / 2 > shape.eraseBBox.bottom
        ) {
          continue;
        }

        const outlineMm = store
          .getPath(shape.penThickness, shape.points, "accurate")
          .map((p) => new Vec2(p[0], p[1]));

        let deleteShape = false;
        if (pointInPolygon(eraserPosMm, outlineMm)) {
          deleteShape = true;
        } else {
          for (let i = 0; i < outlineMm.length - 1; i++) {
            if (
              circleOutlineIntersectsLine(
                eraserPosMm,
                eraserSizeMm / 2,
                outlineMm[i],
                outlineMm[i + 1],
              )
            ) {
              deleteShape = true;
              break;
            }
          }
        }

        if (deleteShape) {
          currentPage.shapes = currentPage.shapes.filter((s) => s !== shape);
          store.forceRender = true;
          store.flushCanvas = true;
          return;
        }
      }
    } else {
      if (e.movementX === 0 && e.movementY === 0) return;
      if (currentPage.previewShape) {
        currentPage.previewShape.points.push({
          x: cursorPosMm.x,
          y: cursorPosMm.y,
          pressure: 0.5,
        });
      }
    }
  } else if (action === Action.Up) {
    eraserPosPx.value = undefined;
    if (contextClickPositionPx.value) {
      if (
        selectionPathPerimeterLength.value <= CONTEXT_MENU_PERIMETER_LIMIT_PX
      ) {
        if (explicitSelectionTool.value) {
          selectShapeUnderCursor(currentPage, cursorPosMm);
        } else {
          contextPopupPosPx.value = cursorPosPx;
          nextTick(() => {
            nextTick(() => {
              contextPopupRef.value?.focus();
            });
          });
        }
      } else {
        // selectedLineShapes.value.push();
        // console.log("Select");
      }
      movedImageShapes.value = [];
      movedLineShapes.value = [];
      contextClickPositionPx.value = undefined;
      selectionPathPx.value = undefined;
      store.forceRender = true;
      store.flushCanvas = true;
    } else {
      if (currentPage.previewShape) {
        currentPage.previewShape.points.push({
          x: cursorPosMm.x,
          y: cursorPosMm.y,
          pressure: 0.5,
        });

        drawShape(getCtx(store.currentPageCanvas), currentPage.previewShape);
        currentPage.shapes.push({
          points: currentPage.previewShape.points,
          penColor: store.penColor,
          penThickness: store.penSizeMm,
        });
        currentPage.previewShape = undefined;

        if (currentPage.pageIndex === currentDocument.value.pages.length - 1) {
          currentDocument.value.pages.push({
            pageIndex: currentDocument.value.pages.length,
            shapes: [],
            images: [],
          });
        }
      }

      store.saveDocument(currentDocument.value);
    }
  }
};

const pointerDownHandler = (e: PointerEvent) => {
  contextPopupPosPx.value = undefined;
  if (e.pointerType == "touch") {
    pointerEvents.value.push(e);
    updateZoomingPointers();
  } else if (e.pointerType == "mouse") {
    mouseEvent(e, Action.Down);
  } else if (e.pointerType == "pen") {
    penEvent(e, Action.Down);
  }
  store.forceRender = true;
};

const pointerMoveHandler = (e: PointerEvent) => {
  if (!viewport.value || !mainCanvas.value) return;
  if (e.pointerType == "touch") {
    const index = pointerEvents.value.findIndex(
      (cachedEv) => cachedEv.pointerId === e.pointerId,
    );
    pointerEvents.value[index] = e;
    updateZoomingPointers();
  } else if (e.pointerType == "mouse") {
    mouseEvent(e, Action.Move);
  } else if (e.pointerType == "pen") {
    penEvent(e, Action.Move);
  }
  store.forceRender = true;
};

const pointerUpHandler = (e: PointerEvent) => {
  if (!viewport.value || !mainCanvas.value) return;
  if (e.pointerType == "touch") {
    const index = pointerEvents.value.findIndex(
      (cachedEv) => cachedEv.pointerId === e.pointerId,
    );
    if (index !== -1) {
      pointerEvents.value.splice(index, 1);
    }
    updateZoomingPointers();
  } else if (e.pointerType == "mouse") {
    mouseEvent(e, Action.Up);
  } else if (e.pointerType == "pen") {
    penEvent(e, Action.Up);
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
};

const paste = (e: ClipboardEvent) => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();

      reader.onload = async (e) => {
        if (!e.target || !viewport.value) return;
        const imageBase64 = e.target.result;
        const page =
          currentDocument.value.pages[currentDocument.value.currentPageIndex];
        if (typeof imageBase64 !== "string") return;
        const vpBB = viewport.value.getBoundingClientRect();
        const viewportSizePx = new Vec2(vpBB.width, vpBB.height);
        const pageTopLeft = currentDocument.value.offset;

        const img = await loadImageAsync(imageBase64);

        const imageSize = new Vec2(img.width, img.height);
        const imagePositionInVp = viewportSizePx.div(2).sub(imageSize.div(2));
        const imagePositionInPagePx = imagePositionInVp.sub(pageTopLeft);
        const imagePositionInPageMm = imagePositionInPagePx.div(
          currentDocument.value.zoom_px_per_mm,
        );

        const image: ImageShape = {
          base64ImageData: imageBase64,
          position: {
            x: imagePositionInPageMm.x,
            y: imagePositionInPageMm.y,
          },
          size: new Vec2(img.width, img.height),
          image: img,
        };
        page.images.push(image);
        // console.log("Inserted image at", image.position);
        store.saveDocument(currentDocument.value);
      };

      reader.readAsDataURL(file);
    }
  }
};

onMounted(async () => {
  window.addEventListener("keydown", keydown);
  window.addEventListener("paste", paste);
  store.currentPageCanvas = createCanvas();
  await nextTick();
  await nextTick();
  store.flushCanvas = true;
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
  window.removeEventListener("paste", paste);
  // for (const entry of store.canvasPool) {
  //   entry.pageIndex = -1;
  // }
});

const contextPopupRef = ref<HTMLDivElement | undefined>();
</script>

<template>
  <div
    ref="viewport"
    class="relative w-full h-full overflow-hidden bg-white"
    @contextmenu.prevent
    @keydown="keydown"
    @pointercancel="pointerUpHandler($event)"
    @pointerdown="pointerDownHandler($event)"
    @pointerleave="pointerUpHandler($event)"
    @pointermove="pointerMoveHandler($event)"
    @pointerover="pointerUpHandler($event)"
    @pointerup="pointerUpHandler($event)"
    @wheel="handleWheel"
  >
    <img class="w-full h-full object-cover" src="/table-tiling-2.jpg" />
    <canvas
      ref="mainCanvas"
      class="absolute pointer-events-none rounded-r-3xl shadow-black shadow-md"
      :style="{
        backgroundColor: currentDocument.pageColor,
        left: currentDocument.offset.x + 'px',
        top: currentDocument.offset.y + 'px',
        borderTopRightRadius:
          (currentDocument.size_mm.y * currentDocument.zoom_px_per_mm) / 30 +
          'px',
        borderBottomRightRadius:
          (currentDocument.size_mm.y * currentDocument.zoom_px_per_mm) / 30 +
          'px',
      }"
    />
    <div
      v-if="contextPopupPosPx"
      ref="contextPopupRef"
      class="absolute w-0 h-0 outline-none focus:outline-none"
      :style="{
        left: currentDocument.offset.x + contextPopupPosPx.x + 'px',
        top: currentDocument.offset.y + contextPopupPosPx.y + 'px',
      }"
      :tabindex="0"
      @blur="contextPopupPosPx = undefined"
      @click="contextPopupPosPx = undefined"
    >
      <div
        class="-translate-x-1/2 -translate-y-1/2 w-fit flex flex-col gap-12 items-center"
      >
        <div
          id="penColor"
          class="flex bg-white p-2 gap-2 w-fit rounded-md border border-black"
        >
          <div
            v-for="color in colors"
            :key="color"
            class="cursor-pointer"
            @click.stop.prevent="
              () => {
                store.penColor = color;
                contextPopupPosPx = undefined;
              }
            "
            @pointercancel.stop.prevent
            @pointerdown.stop.prevent
            @pointerleave.stop.prevent
            @pointermove.stop.prevent
            @pointerup.stop.prevent
          >
            <div
              class="rounded-full w-5 h-5"
              :style="{
                backgroundColor: color,
              }"
            />
          </div>
        </div>
        <div
          id="penSize"
          class="flex bg-white w-fit rounded-md border border-black p-1 gap-1"
        >
          <div
            class="cursor-pointer"
            @click.stop.prevent="
              () => {
                explicitSelectionTool = true;
                contextPopupPosPx = undefined;
              }
            "
            @pointercancel.stop.prevent
            @pointerdown.stop.prevent
            @pointerleave.stop.prevent
            @pointermove.stop.prevent
            @pointerup.stop.prevent
          >
            <svg
              fill="none"
              height="30"
              viewBox="0 0 64 64"
              width="30"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect
                fill="none"
                height="40"
                stroke="black"
                stroke-dasharray="4 4"
                stroke-width="2"
                width="40"
                x="12"
                y="12"
              />
            </svg>
          </div>

          <div
            v-for="thickness in penThicknesses"
            :key="thickness"
            class="cursor-pointer"
            @click.stop.prevent="
              () => {
                store.penSizeMm = thickness;
                contextPopupPosPx = undefined;
              }
            "
            @pointercancel.stop.prevent
            @pointerdown.stop.prevent
            @pointerleave.stop.prevent
            @pointermove.stop.prevent
            @pointerup.stop.prevent
          >
            <svg
              fill="none"
              height="30"
              viewBox="0 0 120 60"
              width="30"
              xmlns="http://www.w3.org/2000/svg"
              :style="{
                '--pen-thickness': thickness * 10,
              }"
            >
              <!-- --pen-thickness: thickness -->
              <path
                d="M10 50 C 40 0, 80 60, 110 10"
                fill="none"
                stroke="black"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="var(--pen-thickness)"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
