<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Vec2 } from "./Vector";
import { type Document, type ImageShape, type LineShape, type Page, type Shape, type TextblockShape } from "./Document";
import {
  assert,
  combineBBox,
  isPointInBBox,
  loadImageAsync,
  RESIZE_HANDLE_SIZE,
  updateShapeBBox,
  useStore,
} from "./store";
import { Renderer } from "./Renderer";
import type { ImageShapeFileFormat, LineShapeFileFormat, ShapesInClipboard } from "@/types";

const CONTEXT_MENU_PERIMETER_LIMIT_PX = 5;

const store = useStore();
const currentDocument = defineModel<Document>("document", { required: true });
const explicitSelectionTool = ref(false);
const textTool = ref(false);
const selectedShapes = ref<Shape[]>([]);
const movedShapes = ref<Shape[]>([]);

const colors = [
  "#000000", // Jet Black
  "#1D4ED8", // Royal Blue
  "#DC2626", // Crimson Red
  "#16A34A", // Emerald Green
  "#CA8A04", // Goldenrod
  // "#9333EA", // Vivid Violet (Original)
  "#7E34D9", // New Violet #1
  // "#F97316", // Bright Orange (Original)
  // "#EA580C", // Less aggressive orange
  // "#C2410C", // Burnt Orange
  // "#D97706", // Amber Orange
  // "#FB8C00", // New Orange #1
  "#F57C00", // New Orange #2
  "#6B7280", // Slate Gray
];

const penThicknesses = [0.1, 0.3, 0.5, 0.7, 0.9];

const chooseDefaultPen = () => {
  controls.value.usePenTool(penThicknesses[2]);
};

const props = defineProps<{
  maxZoom: number;
  minZoom: number;
  zoomSensitivity: number;
}>();

const mainCanvas = ref<HTMLCanvasElement>();
const renderer = ref<undefined | Renderer>();
const viewport = ref<HTMLDivElement>();
const contextPopupPosPx = ref<undefined | Vec2>();
const cursorResize = ref(false);
const pendingFrame = ref<number | undefined>();
const pendingWheelZoomFinalize = ref<number | undefined>();
const pendingIdleZoomPreviewCacheBuild = ref<number | undefined>();
const pendingPanFinalize = ref<number | undefined>();
const pendingDeferredDeepRender = ref<number | undefined>();
const lastInteractionAtMs = ref(Date.now());
const interactiveZooming = ref(false);
const interactivePanning = ref(false);
const zoomPreview = ref<
  | {
      snapshot: HTMLCanvasElement;
      startZoom: number;
      startOffset: Vec2;
      rectLeftPx: number;
      rectTopPx: number;
      rectWidthPx: number;
      rectHeightPx: number;
      quality: number;
    }
  | undefined
>();
const panPreview = ref<
  | {
      snapshot: HTMLCanvasElement;
      startOffset: Vec2;
    }
  | undefined
>();
const idleZoomPreviewCache = ref<
  | {
      snapshot: HTMLCanvasElement;
      startZoom: number;
      startOffset: Vec2;
      rectLeftPx: number;
      rectTopPx: number;
      rectWidthPx: number;
      rectHeightPx: number;
      quality: number;
    }
  | undefined
>();

const page = computed(() => currentDocument.value.pages[currentDocument.value.currentPageIndex]);

const ZOOM_PREVIEW_CACHE_QUALITY = 0.45;
const ZOOM_PREVIEW_CACHE_PADDING_FACTOR = 0.4;
const INTERACTION_IDLE_MS = 220;

const markInteraction = () => {
  lastInteractionAtMs.value = Date.now();
};

const cancelPendingDeferredDeepRender = () => {
  if (pendingDeferredDeepRender.value !== undefined) {
    window.clearTimeout(pendingDeferredDeepRender.value);
    pendingDeferredDeepRender.value = undefined;
  }
};

const scheduleDeferredDeepRender = (delayMs: number) => {
  cancelPendingDeferredDeepRender();
  pendingDeferredDeepRender.value = window.setTimeout(() => {
    pendingDeferredDeepRender.value = undefined;
    if (Date.now() - lastInteractionAtMs.value < INTERACTION_IDLE_MS) {
      scheduleDeferredDeepRender(INTERACTION_IDLE_MS);
      return;
    }
    if (interactiveZooming.value || interactivePanning.value) {
      scheduleDeferredDeepRender(INTERACTION_IDLE_MS);
      return;
    }
    store.forceDeepRender = true;
    render();
  }, delayMs);
};

const cancelPendingIdleZoomPreviewCacheBuild = () => {
  if (pendingIdleZoomPreviewCacheBuild.value !== undefined) {
    window.clearTimeout(pendingIdleZoomPreviewCacheBuild.value);
    pendingIdleZoomPreviewCacheBuild.value = undefined;
  }
};

const scheduleIdleZoomPreviewCacheBuild = () => {
  if (interactiveZooming.value) return;
  if (interactivePanning.value) return;
  if (!renderer.value || !viewport.value) return;
  cancelPendingIdleZoomPreviewCacheBuild();

  pendingIdleZoomPreviewCacheBuild.value = window.setTimeout(() => {
    pendingIdleZoomPreviewCacheBuild.value = undefined;
    if (Date.now() - lastInteractionAtMs.value < INTERACTION_IDLE_MS) {
      scheduleIdleZoomPreviewCacheBuild();
      return;
    }
    if (interactiveZooming.value || interactivePanning.value) return;
    if (!renderer.value || !viewport.value) return;

    const vpRect = viewport.value.getBoundingClientRect();
    const viewportSizePx = new Vec2(vpRect.width, vpRect.height);
    const paddingPx = Math.max(viewportSizePx.x, viewportSizePx.y) * ZOOM_PREVIEW_CACHE_PADDING_FACTOR;
    const cache = renderer.value.buildZoomPreviewCache(viewportSizePx, paddingPx, ZOOM_PREVIEW_CACHE_QUALITY, {
      createMissingTiles: true,
      refreshDirtyTiles: true,
    });

    if (interactiveZooming.value) return;
    idleZoomPreviewCache.value = {
      snapshot: cache.canvas,
      startZoom: currentDocument.value.zoom_px_per_mm,
      startOffset: new Vec2(currentDocument.value.offset),
      rectLeftPx: cache.rectLeftPx,
      rectTopPx: cache.rectTopPx,
      rectWidthPx: cache.rectWidthPx,
      rectHeightPx: cache.rectHeightPx,
      quality: cache.quality,
    };
  }, INTERACTION_IDLE_MS);
};

const canUseIdleZoomPreviewCache = () => {
  if (!idleZoomPreviewCache.value) return false;
  const zDiff = Math.abs(idleZoomPreviewCache.value.startZoom - currentDocument.value.zoom_px_per_mm);
  if (zDiff > 0.0001) return false;
  return true;
};

const cancelPendingPanFinalize = () => {
  if (pendingPanFinalize.value !== undefined) {
    window.clearTimeout(pendingPanFinalize.value);
    pendingPanFinalize.value = undefined;
  }
};

function endInteractivePanPreview() {
  cancelPendingPanFinalize();
  if (!interactivePanning.value) return;
  interactivePanning.value = false;
  panPreview.value = undefined;
  render();
}

const schedulePanFinalize = () => {
  cancelPendingPanFinalize();
  pendingPanFinalize.value = window.setTimeout(() => {
    endInteractivePanPreview();
  }, 60);
};

const beginInteractivePanPreview = () => {
  if (!mainCanvas.value) return;
  if (interactiveZooming.value) return;
  if (interactivePanning.value) return;

  const snapshot = document.createElement("canvas");
  snapshot.width = mainCanvas.value.width;
  snapshot.height = mainCanvas.value.height;
  const snapshotCtx = snapshot.getContext("2d", { desynchronized: true });
  if (!snapshotCtx) return;
  snapshotCtx.drawImage(mainCanvas.value, 0, 0);

  panPreview.value = {
    snapshot,
    startOffset: new Vec2(currentDocument.value.offset),
  };
  interactivePanning.value = true;
};

const drawInteractivePanPreview = () => {
  if (!mainCanvas.value || !panPreview.value) return;
  const ctx = mainCanvas.value.getContext("2d", { desynchronized: true });
  if (!ctx) return;

  const dpr = window.devicePixelRatio;
  const delta = currentDocument.value.offset.sub(panPreview.value.startOffset);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, mainCanvas.value.width, mainCanvas.value.height);
  ctx.drawImage(panPreview.value.snapshot, Math.round(delta.x * dpr), Math.round(delta.y * dpr));
};

const beginInteractiveZoomPreview = () => {
  if (!mainCanvas.value || !viewport.value || !renderer.value) return;
  if (interactiveZooming.value) return;

  endInteractivePanPreview();

  cancelPendingIdleZoomPreviewCacheBuild();

  if (canUseIdleZoomPreviewCache() && idleZoomPreviewCache.value) {
    zoomPreview.value = {
      snapshot: idleZoomPreviewCache.value.snapshot,
      startZoom: idleZoomPreviewCache.value.startZoom,
      startOffset: new Vec2(idleZoomPreviewCache.value.startOffset),
      rectLeftPx: idleZoomPreviewCache.value.rectLeftPx,
      rectTopPx: idleZoomPreviewCache.value.rectTopPx,
      rectWidthPx: idleZoomPreviewCache.value.rectWidthPx,
      rectHeightPx: idleZoomPreviewCache.value.rectHeightPx,
      quality: idleZoomPreviewCache.value.quality,
    };
    interactiveZooming.value = true;
    return;
  }

  const snapshot = document.createElement("canvas");
  snapshot.width = mainCanvas.value.width;
  snapshot.height = mainCanvas.value.height;
  const snapshotCtx = snapshot.getContext("2d", { desynchronized: true });
  if (!snapshotCtx) return;
  snapshotCtx.drawImage(mainCanvas.value, 0, 0);

  const vpRect = viewport.value.getBoundingClientRect();

  zoomPreview.value = {
    snapshot,
    startZoom: currentDocument.value.zoom_px_per_mm,
    startOffset: new Vec2(currentDocument.value.offset),
    rectLeftPx: 0,
    rectTopPx: 0,
    rectWidthPx: vpRect.width,
    rectHeightPx: vpRect.height,
    quality: 1,
  };
  interactiveZooming.value = true;
};

const drawInteractiveZoomPreview = () => {
  if (!mainCanvas.value || !zoomPreview.value) return;
  const ctx = mainCanvas.value.getContext("2d", { desynchronized: true });
  if (!ctx) return;

  const dpr = window.devicePixelRatio;
  const r = currentDocument.value.zoom_px_per_mm / zoomPreview.value.startZoom;

  const dxCss = (zoomPreview.value.rectLeftPx - zoomPreview.value.startOffset.x) * r + currentDocument.value.offset.x;
  const dyCss = (zoomPreview.value.rectTopPx - zoomPreview.value.startOffset.y) * r + currentDocument.value.offset.y;
  const dwCss = zoomPreview.value.rectWidthPx * r;
  const dhCss = zoomPreview.value.rectHeightPx * r;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, mainCanvas.value.width, mainCanvas.value.height);
  ctx.drawImage(
    zoomPreview.value.snapshot,
    Math.round(dxCss * dpr),
    Math.round(dyCss * dpr),
    Math.round(dwCss * dpr),
    Math.round(dhCss * dpr),
  );
};

const endInteractiveZoomPreview = () => {
  markInteraction();
  interactiveZooming.value = false;
  zoomPreview.value = undefined;
  store.forceShallowRender = true;
  render();
  scheduleDeferredDeepRender(80);
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

const textShapes = computed(() => page.value.shapes.filter((s) => s.variant === "Textblock"));

const handleWheel = (e: WheelEvent) => {
  if (!viewport.value || !renderer.value) return;
  markInteraction();
  e.preventDefault();
  if (e.ctrlKey) {
    beginInteractiveZoomPreview();
    const delta = e.deltaX + e.deltaY + e.deltaZ;
    let ratio = 1 - delta * props.zoomSensitivity;
    const center = new Vec2(
      e.clientX - viewport.value.getBoundingClientRect().left,
      e.clientY - viewport.value.getBoundingClientRect().top,
    );
    performZoom(ratio, center);
    if (pendingWheelZoomFinalize.value !== undefined) {
      window.clearTimeout(pendingWheelZoomFinalize.value);
    }
    pendingWheelZoomFinalize.value = window.setTimeout(() => {
      endInteractiveZoomPreview();
    }, 120);
  } else if (e.shiftKey) {
    beginInteractivePanPreview();
    currentDocument.value.offset = currentDocument.value.offset.add(new Vec2(-e.deltaY, -e.deltaX));
    schedulePanFinalize();
  } else {
    beginInteractivePanPreview();
    currentDocument.value.offset = currentDocument.value.offset.add(new Vec2(-e.deltaX, -e.deltaY));
    schedulePanFinalize();
  }
  render();
};

const pointerEvents = ref<PointerEvent[]>([]);
const isZooming = ref(false);
const lastZoomFingerDistance = ref(0);
const zoomFactorWhenStartingZooming = ref(1);
const lastZoomCenter = ref(new Vec2());
const selectionPathPx = ref<undefined | Vec2[]>();
const eraserPosPx = ref<undefined | Vec2>();
const lassoSelectionToken = ref(0);

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
  if (!viewport.value || !renderer.value) return;
  markInteraction();
  const numberOfFingers = pointerEvents.value.length;
  if (numberOfFingers === 1) {
    beginInteractivePanPreview();
    currentDocument.value.offset = currentDocument.value.offset.add(
      new Vec2(pointerEvents.value[0].movementX, pointerEvents.value[0].movementY),
    );
    schedulePanFinalize();
  } else if (numberOfFingers === 2) {
    const finger1 = new Vec2(
      pointerEvents.value[0].clientX - viewport.value.getBoundingClientRect().left,
      pointerEvents.value[0].clientY - viewport.value.getBoundingClientRect().top,
    );
    const finger2 = new Vec2(
      pointerEvents.value[1].clientX - viewport.value.getBoundingClientRect().left,
      pointerEvents.value[1].clientY - viewport.value.getBoundingClientRect().top,
    );
    const center = finger1.add(finger2).div(2);
    const distance = finger2.sub(finger1).mag();

    if (!isZooming.value) {
      isZooming.value = true;
      beginInteractiveZoomPreview();
      lastZoomCenter.value = center;
      lastZoomFingerDistance.value = distance;
      zoomFactorWhenStartingZooming.value = currentDocument.value.zoom_px_per_mm;
      return;
    }

    currentDocument.value.offset = currentDocument.value.offset.add(center.sub(lastZoomCenter.value));
    const ratio = distance / lastZoomFingerDistance.value;
    performZoom(ratio, center);
    lastZoomFingerDistance.value = distance;
    lastZoomCenter.value = center;
  }

  if (numberOfFingers !== 2) {
    if (isZooming.value && zoomFactorWhenStartingZooming.value !== currentDocument.value.zoom_px_per_mm) {
      endInteractiveZoomPreview();
    }
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

    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
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

function shapeBBoxToPx(shape: Shape) {
  return {
    left: shape.bbox.left * currentDocument.value.zoom_px_per_mm,
    right: shape.bbox.right * currentDocument.value.zoom_px_per_mm,
    top: shape.bbox.top * currentDocument.value.zoom_px_per_mm,
    bottom: shape.bbox.bottom * currentDocument.value.zoom_px_per_mm,
  };
}

function getPolygonAabb(points: Vec2[]) {
  const aabb = {
    left: points[0].x,
    right: points[0].x,
    top: points[0].y,
    bottom: points[0].y,
  };
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.x < aabb.left) aabb.left = p.x;
    if (p.x > aabb.right) aabb.right = p.x;
    if (p.y < aabb.top) aabb.top = p.y;
    if (p.y > aabb.bottom) aabb.bottom = p.y;
  }
  return aabb;
}

function aabbIntersects(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function isRectInsidePolygon(bboxPx: { left: number; right: number; top: number; bottom: number }, polygon: Vec2[]) {
  const midX = (bboxPx.left + bboxPx.right) / 2;
  const midY = (bboxPx.top + bboxPx.bottom) / 2;
  const points = [
    new Vec2(bboxPx.left, bboxPx.top),
    new Vec2(midX, bboxPx.top),
    new Vec2(bboxPx.right, bboxPx.top),
    new Vec2(bboxPx.left, midY),
    new Vec2(midX, midY),
    new Vec2(bboxPx.right, midY),
    new Vec2(bboxPx.left, bboxPx.bottom),
    new Vec2(midX, bboxPx.bottom),
    new Vec2(bboxPx.right, bboxPx.bottom),
  ];
  for (const p of points) {
    if (!pointInPolygon(p, polygon)) {
      return false;
    }
  }
  return true;
}

const runLassoSelectionFast = (rawPathPx: Vec2[]) => {
  const token = ++lassoSelectionToken.value;
  cancelPendingDeferredDeepRender();
  cancelPendingIdleZoomPreviewCacheBuild();

  const pathPx = rawPathPx;
  const pathAabb = getPolygonAabb(pathPx);
  const candidates = page.value.shapes.filter((shape) => aabbIntersects(shapeBBoxToPx(shape), pathAabb));
  const result: Shape[] = [];
  const pendingLines: Shape[] = [];

  for (const shape of candidates) {
    const bboxPx = shapeBBoxToPx(shape);

    if (shape.variant !== "Line") {
      if (isRectInsidePolygon(bboxPx, pathPx)) {
        result.push(shape);
      }
      continue;
    }

    // Conservative fast accept for lines: if their bbox is fully inside polygon.
    if (isRectInsidePolygon(bboxPx, pathPx)) {
      result.push(shape);
      continue;
    }

    pendingLines.push(shape);
  }

  selectedShapes.value = result;
  store.forceShallowRender = true;
  render();

  if (pendingLines.length === 0) {
    return;
  }

  const evaluateLineStrict = (shape: Shape) => {
    if (shape.variant !== "Line") return false;
    for (const point of shape.points) {
      if (!pointInPolygon(new Vec2(point.x, point.y).mul(currentDocument.value.zoom_px_per_mm), pathPx)) {
        return false;
      }
    }
    return true;
  };

  let i = 0;
  const runChunk = () => {
    if (token !== lassoSelectionToken.value) return;

    const start = performance.now();
    while (i < pendingLines.length && performance.now() - start < 6) {
      const shape = pendingLines[i++];
      if (evaluateLineStrict(shape)) {
        result.push(shape);
      }
    }

    if (token !== lassoSelectionToken.value) return;

    selectedShapes.value = [...result];
    store.forceShallowRender = true;
    render();

    if (i < pendingLines.length) {
      requestAnimationFrame(runChunk);
    }
  };

  requestAnimationFrame(runChunk);
};

const selectShapeUnderCursor = (page: Page, cursorPosMm: Vec2) => {
  selectedShapes.value = [];
  for (const shape of page.shapes) {
    if (isPointInBBox(shape.bbox, cursorPosMm)) {
      selectedShapes.value = [shape];
      return;
    }
  }
};

const isCursorInAnySelectedBBox = (cursorPosMm: Vec2) => {
  if (selectedShapes.value.length === 0) return false;
  let combinedBBox = selectedShapes.value[0].bbox;

  for (const shape of selectedShapes.value) {
    combinedBBox = combineBBox(combinedBBox, shape.bbox);
  }

  return isPointInBBox(combinedBBox, cursorPosMm);
};

const renderNow = () => {
  if (!renderer.value) return;
  renderer.value.dynamicShapes = [];
  renderer.value.staticShapes = [];
  const movedSet = new Set(movedShapes.value);
  const selectedSet = new Set(selectedShapes.value);
  renderer.value.selectedShapes = [];
  renderer.value.selectionPathPx = selectionPathPx.value;
  renderer.value.eraserPosPx = eraserPosPx.value;

  for (const shape of page.value.shapes) {
    if (selectedSet.has(shape)) {
      renderer.value.selectedShapes.push(shape);
    }
    if (movedSet.has(shape)) continue;
    renderer.value.staticShapes.push(shape);
  }

  if (page.value.previewLine) {
    if (
      page.value.oldPreviewLineLength !== undefined ||
      page.value.oldPreviewLineLength !== page.value.previewLine.points.length
    ) {
      store.forceShallowRender = true;
      renderer.value.dynamicShapes.push(page.value.previewLine);
    }

    page.value.oldPreviewLineLength = page.value.previewLine.points.length;
  }

  if (movedShapes.value.length > 0) {
    store.forceShallowRender = true;
    for (const shape of movedShapes.value) {
      renderer.value.dynamicShapes.push(shape);
    }
  }

  renderer.value.render();
  scheduleIdleZoomPreviewCacheBuild();
  // requestAnimationFrame(render);
};

const render = () => {
  if (pendingFrame.value !== undefined) {
    return;
  }
  pendingFrame.value = requestAnimationFrame(() => {
    pendingFrame.value = undefined;
    if (interactiveZooming.value) {
      drawInteractiveZoomPreview();
    } else if (interactivePanning.value) {
      drawInteractivePanPreview();
    } else {
      renderNow();
    }
  });
};

watch(
  () => store.triggerRender,
  () => {
    render();
  },
);

const moveShape = (shape: Shape, delta: Vec2) => {
  const oldBBox = { ...shape.bbox };
  if (shape.variant === "Image") {
    shape.position.x += delta.x;
    shape.position.y += delta.y;
  } else if (shape.variant === "Textblock") {
    shape.position.x += delta.x;
    shape.position.y += delta.y;
  } else {
    for (const p of shape.points) {
      p.x += delta.x;
      p.y += delta.y;
    }
  }
  shape.bbox.left += delta.x;
  shape.bbox.right += delta.x;
  shape.bbox.top += delta.y;
  shape.bbox.bottom += delta.y;
  renderer.value?.markShapeMovedDynamic(oldBBox, shape.bbox);
};

const resizeShape = (shape: Shape, origin: Vec2, ratio: number) => {
  const oldBBox = { ...shape.bbox };
  if (shape.variant === "Image") {
    const newPos = origin.add(new Vec2(shape.position.x, shape.position.y).sub(origin).mul(ratio));
    shape.position.x = newPos.x;
    shape.position.y = newPos.y;
    shape.size.x *= ratio;
    shape.size.y *= ratio;
  } else if (shape.variant === "Textblock") {
    const newPos = origin.add(new Vec2(shape.position.x, shape.position.y).sub(origin).mul(ratio));
    shape.position.x = newPos.x;
    shape.position.y = newPos.y;
    shape.size.x *= ratio;
    shape.size.y *= ratio;
  } else {
    for (const p of shape.points) {
      const newPos = origin.add(new Vec2(p.x, p.y).sub(origin).mul(ratio));
      p.x = newPos.x;
      p.y = newPos.y;
    }
  }
  updateShapeBBox(shape);
  renderer.value?.markShapeMovedDynamic(oldBBox, shape.bbox);
};

class Controls {
  eraserButton = false;
  stylusButton = false;
  penDown = false;
  e?: PointerEvent;

  cursorPosPx = new Vec2();
  cursorPosMm = new Vec2();
  currentPage?: Page;
  deltaMm = new Vec2();

  isMovingShapes = false;
  resizeOrigin = new Vec2();
  resizeLastOriginDistance = 0;
  isResizing = false;
  startedSelectionWithStylusButton = false;
  movedShapeStartBBoxes = new Map<Shape, { left: number; right: number; top: number; bottom: number }>();

  constructor() {}

  captureMovedShapeStartBBoxes() {
    this.movedShapeStartBBoxes.clear();
    for (const shape of movedShapes.value) {
      this.movedShapeStartBBoxes.set(shape, { ...shape.bbox });
      renderer.value?.markShapeDeleted(shape);
    }
  }

  clearMovedShapeTracking() {
    this.movedShapeStartBBoxes.clear();
  }

  invalidateMovedShapeTiles() {
    if (!renderer.value) {
      this.clearMovedShapeTracking();
      return;
    }
    for (const [shape, oldBBox] of this.movedShapeStartBBoxes.entries()) {
      renderer.value.markShapeMoved(oldBBox, shape.bbox);
    }
    this.clearMovedShapeTracking();
  }

  onMouseDown() {
    assert(this.e);

    // Start resizing
    if (this.isCursorInResizeHandle()) {
      this.isResizing = true;
      if (renderer.value) {
        renderer.value.dirtyDynamicOnly = true;
      }
      const bbox = this.getCombinedSelectionBBox();
      this.resizeOrigin = new Vec2(bbox.left, bbox.top);
      this.resizeLastOriginDistance = this.cursorPosMm.sub(this.resizeOrigin).mag();
      movedShapes.value = [...selectedShapes.value];
      this.captureMovedShapeStartBBoxes();
      selectionPathPx.value = undefined;
      return;
    }

    // Selected: Start moving
    if (selectedShapes.value.length > 0) {
      if (isCursorInAnySelectedBBox(this.cursorPosMm)) {
        this.isMovingShapes = true;
        if (renderer.value) {
          renderer.value.dirtyDynamicOnly = true;
        }
        movedShapes.value = [...selectedShapes.value];
        this.captureMovedShapeStartBBoxes();
        selectionPathPx.value = undefined;
        return;
      } else {
        this.isMovingShapes = false;
        selectedShapes.value = [];
        movedShapes.value = [];
        this.clearMovedShapeTracking();
      }
    }

    // Context Popup open: Close without drawing
    if (contextPopupPosPx.value) {
      return;
    }

    if (textTool.value) {
      return;
    }

    // Always select
    // if (this.stylusButton || explicitSelectionTool.value) {
    selectedShapes.value = [];
    movedShapes.value = [];
    this.clearMovedShapeTracking();
    selectionPathPx.value = [this.cursorPosPx];
    this.startedSelectionWithStylusButton = this.stylusButton;
    // return;
    // }
  }

  onMouseDrag() {
    assert(this.e);

    if (this.isResizing) {
      const distToOrigin = this.cursorPosMm.sub(this.resizeOrigin).mag();
      const ratio = distToOrigin / this.resizeLastOriginDistance;
      for (const shape of selectedShapes.value) {
        resizeShape(shape, this.resizeOrigin, ratio);
        if (this.e.ctrlKey || this.e.shiftKey) {
          if (shape.variant === "Line") {
            shape.penThickness *= ratio;
          }
        }
      }
      this.resizeLastOriginDistance = distToOrigin;
      return;
    }

    if (this.isMovingShapes) {
      for (const shape of selectedShapes.value) {
        moveShape(shape, this.deltaMm);
      }
      return;
    }

    // Selecting
    if (selectionPathPx.value) {
      selectionPathPx.value.push(this.cursorPosPx);
      return;
    }

    // Erasing
    if (this.eraserButton) {
      for (const shape of page.value.shapes) {
        const eraserSizeMm = store.eraserSizePx / currentDocument.value.zoom_px_per_mm;
        eraserPosPx.value = this.cursorPosMm.mul(currentDocument.value.zoom_px_per_mm);
        const eraserPosMm = this.cursorPosMm;

        if (
          eraserPosMm.x + eraserSizeMm / 2 < shape.bbox.left ||
          eraserPosMm.x - eraserSizeMm / 2 > shape.bbox.right ||
          eraserPosMm.y + eraserSizeMm / 2 < shape.bbox.top ||
          eraserPosMm.y - eraserSizeMm / 2 > shape.bbox.bottom
        ) {
          continue;
        }

        let deleteShape = false;
        if (shape.variant === "Line") {
          const outlineMm = store
            .getPath(shape.penThickness, shape.points, "accurate")
            .map((p) => new Vec2(p[0], p[1]));

          if (pointInPolygon(eraserPosMm, outlineMm)) {
            deleteShape = true;
          } else {
            for (let i = 0; i < outlineMm.length - 1; i++) {
              if (circleOutlineIntersectsLine(eraserPosMm, eraserSizeMm / 2, outlineMm[i], outlineMm[i + 1])) {
                deleteShape = true;
                break;
              }
            }
          }
        }

        if (deleteShape) {
          page.value.shapes = page.value.shapes.filter((s) => s !== shape);
          // store.scheduleDocumentSave(currentDocument.value);
          store.saveDocument(currentDocument.value);
          return;
        }
      }
    }
  }

  onMouseUp() {
    assert(this.e);

    eraserPosPx.value = undefined;
    const movedOrResized = this.isMovingShapes || this.isResizing;
    this.isMovingShapes = false;

    if (this.isResizing) {
      this.isResizing = false;
    }

    if (movedOrResized) {
      if (renderer.value) {
        renderer.value.dirtyDynamicOnly = false;
      }
      this.invalidateMovedShapeTiles();
      movedShapes.value = [];
      store.forceDeepRender = true;
    }

    if (textTool.value) {
      const textblock: TextblockShape = {
        variant: "Textblock",
        position: {
          x: this.cursorPosMm.x,
          y: this.cursorPosMm.y,
        },
        bbox: { bottom: 0, left: 0, right: 0, top: 0 },
        rawText:
          "Hallo dies ist ein sehr langer Text, der ausdrücklich dafür gemacht wurde, zu lange für dieses Textfeld zu sein, um zu Testen, wie die Zeilen im Textfeld umbrechen.",
        size: new Vec2(70, 40),
      };
      updateShapeBBox(textblock);
      page.value.shapes.push(textblock);
      selectedShapes.value = [textblock];
      return;
    }

    if (selectionPathPx.value) {
      // Releasing while using selection
      if (selectionPathPerimeterLength.value <= CONTEXT_MENU_PERIMETER_LIMIT_PX) {
        // Has not moved while selecting
        selectShapeUnderCursor(page.value, this.cursorPosMm);
        selectionPathPx.value = undefined;
        return;
      }

      // Has selected and moved
      if (selectionPathPx.value) {
        const path = selectionPathPx.value;
        selectionPathPx.value = undefined;
        selectedShapes.value = [];
        runLassoSelectionFast(path);
        return;
      }
    }
  }

  onPenDown() {
    assert(this.e);

    // Start resizing
    if (this.isCursorInResizeHandle()) {
      this.isResizing = true;
      if (renderer.value) {
        renderer.value.dirtyDynamicOnly = true;
      }
      const bbox = this.getCombinedSelectionBBox();
      this.resizeOrigin = new Vec2(bbox.left, bbox.top);
      this.resizeLastOriginDistance = this.cursorPosMm.sub(this.resizeOrigin).mag();
      movedShapes.value = [...selectedShapes.value];
      this.captureMovedShapeStartBBoxes();
      selectionPathPx.value = undefined;
      return;
    }

    // Selected: Start moving
    let skipDrawLine = false;
    if (selectedShapes.value.length > 0) {
      if (isCursorInAnySelectedBBox(this.cursorPosMm)) {
        this.isMovingShapes = true;
        if (renderer.value) {
          renderer.value.dirtyDynamicOnly = true;
        }
        movedShapes.value = [...selectedShapes.value];
        this.captureMovedShapeStartBBoxes();
        selectionPathPx.value = undefined;
        return;
      } else {
        this.isMovingShapes = false;
        selectedShapes.value = [];
        movedShapes.value = [];
        this.clearMovedShapeTracking();
        skipDrawLine = true;
      }
    }

    // Context Popup open: Close without drawing
    if (contextPopupPosPx.value) {
      return;
    }

    if (this.stylusButton || explicitSelectionTool.value) {
      selectedShapes.value = [];
      movedShapes.value = [];
      this.clearMovedShapeTracking();
      selectionPathPx.value = [this.cursorPosPx];
      this.startedSelectionWithStylusButton = this.stylusButton;
      return;
    }

    if (this.eraserButton) {
      page.value.previewLine = undefined;
      eraserPosPx.value = this.cursorPosMm.mul(currentDocument.value.zoom_px_per_mm);
      return;
    }

    if (skipDrawLine) {
      return;
    }

    // Start drawing
    page.value.previewLine = {
      variant: "Line",
      bbox: {
        left: this.cursorPosMm.x,
        right: this.cursorPosMm.x,
        bottom: this.cursorPosMm.y,
        top: this.cursorPosMm.y,
      },
      points: [
        {
          x: this.cursorPosMm.x,
          y: this.cursorPosMm.y,
          pressure: 0.5,
        },
      ],
      penColor: store.penColor,
      penThickness: store.penSizeMm,
    };
  }

  getCombinedSelectionBBox() {
    let combinedBBox = selectedShapes.value[0].bbox;
    for (const shape of selectedShapes.value) {
      combinedBBox = combineBBox(combinedBBox, shape.bbox);
    }
    return combinedBBox;
  }

  isCursorInResizeHandle() {
    if (selectedShapes.value.length === 0) {
      return undefined;
    }
    const combinedBBox = this.getCombinedSelectionBBox();
    const handlePosMm = new Vec2(combinedBBox.right, combinedBBox.bottom);
    const handlePosPx = store.mmToPx(handlePosMm);
    const dist = handlePosPx.sub(this.cursorPosPx).mag();
    return dist <= RESIZE_HANDLE_SIZE;
  }

  updateResizeCursor() {
    if (this.isCursorInResizeHandle()) {
      cursorResize.value = true;
    } else {
      cursorResize.value = false;
    }
  }

  onPenHover() {
    this.updateResizeCursor();
  }

  onPenDrag() {
    assert(this.e);

    if (this.isResizing) {
      const distToOrigin = this.cursorPosMm.sub(this.resizeOrigin).mag();
      const ratio = distToOrigin / this.resizeLastOriginDistance;
      for (const shape of selectedShapes.value) {
        resizeShape(shape, this.resizeOrigin, ratio);
        if (this.e.ctrlKey || this.e.shiftKey) {
          if (shape.variant === "Line") {
            shape.penThickness *= ratio;
          }
        }
      }
      this.resizeLastOriginDistance = distToOrigin;
      return;
    }

    if (this.isMovingShapes) {
      for (const shape of selectedShapes.value) {
        moveShape(shape, this.deltaMm);
      }
      return;
    }

    // Selecting
    if (selectionPathPx.value) {
      selectionPathPx.value.push(this.cursorPosPx);
      return;
    }

    // Erasing
    if (this.eraserButton) {
      for (const shape of page.value.shapes) {
        const eraserSizeMm = store.eraserSizePx / currentDocument.value.zoom_px_per_mm;
        eraserPosPx.value = this.cursorPosMm.mul(currentDocument.value.zoom_px_per_mm);
        const eraserPosMm = this.cursorPosMm;

        if (
          eraserPosMm.x + eraserSizeMm / 2 < shape.bbox.left ||
          eraserPosMm.x - eraserSizeMm / 2 > shape.bbox.right ||
          eraserPosMm.y + eraserSizeMm / 2 < shape.bbox.top ||
          eraserPosMm.y - eraserSizeMm / 2 > shape.bbox.bottom
        ) {
          continue;
        }

        let deleteShape = false;
        if (shape.variant === "Line") {
          const outlineMm = store
            .getPath(shape.penThickness, shape.points, "accurate")
            .map((p) => new Vec2(p[0], p[1]));

          if (pointInPolygon(eraserPosMm, outlineMm)) {
            deleteShape = true;
          } else {
            for (let i = 0; i < outlineMm.length - 1; i++) {
              if (circleOutlineIntersectsLine(eraserPosMm, eraserSizeMm / 2, outlineMm[i], outlineMm[i + 1])) {
                deleteShape = true;
                break;
              }
            }
          }
        }

        if (deleteShape && renderer.value) {
          // page.value.shapes = page.value.shapes.filter((s) => s !== shape);
          if (!renderer.value.erasedShapes.has(shape)) {
            renderer.value.erasedShapes.add(shape);
          }
          store.saveDocument(currentDocument.value);
          // return;
        }
      }
    }

    // Normal drawing
    if (this.e.movementX === 0 && this.e.movementY === 0) return;
    if (page.value.previewLine) {
      page.value.previewLine.points.push({
        x: this.cursorPosMm.x,
        y: this.cursorPosMm.y,
        pressure: 0.5,
      });

      // Keep preview bbox updated for tiled dynamic rendering so strokes can span multiple tiles while drawing.
      const bbox = page.value.previewLine.bbox;
      const pad = page.value.previewLine.penThickness;
      const x = this.cursorPosMm.x;
      const y = this.cursorPosMm.y;
      bbox.left = Math.min(bbox.left, x - pad);
      bbox.right = Math.max(bbox.right, x + pad);
      bbox.top = Math.min(bbox.top, y - pad);
      bbox.bottom = Math.max(bbox.bottom, y + pad);
    }
  }

  onPenUp() {
    assert(this.e);

    eraserPosPx.value = undefined;
    const movedOrResized = this.isMovingShapes || this.isResizing;
    this.isMovingShapes = false;

    if (this.isResizing) {
      this.isResizing = false;
    }

    if (movedOrResized) {
      if (renderer.value) {
        renderer.value.dirtyDynamicOnly = false;
      }
      this.invalidateMovedShapeTiles();
      movedShapes.value = [];
      store.forceDeepRender = true;
    }

    if (selectionPathPx.value) {
      // Releasing while using selection
      if (selectionPathPerimeterLength.value <= CONTEXT_MENU_PERIMETER_LIMIT_PX) {
        // Has not moved while selecting
        if (explicitSelectionTool.value && !this.startedSelectionWithStylusButton) {
          selectShapeUnderCursor(page.value, this.cursorPosMm);
        } else {
          contextPopupPosPx.value = this.cursorPosPx;
          nextTick(() => {
            nextTick(() => {
              contextPopupRef.value?.focus();
            });
          });
        }
        selectionPathPx.value = undefined;
        return;
      }

      // Has selected and moved
      if (selectionPathPx.value) {
        const path = selectionPathPx.value;
        selectionPathPx.value = undefined;
        selectedShapes.value = [];
        runLassoSelectionFast(path);
        return;
      }
    }

    if (page.value.previewLine) {
      page.value.previewLine.points.push({
        x: this.cursorPosMm.x,
        y: this.cursorPosMm.y,
        pressure: 0.5,
      });

      const line = {
        variant: "Line",
        bbox: { left: 0, right: 0, bottom: 0, top: 0 },
        points: page.value.previewLine.points,
        penColor: store.penColor,
        penThickness: store.penSizeMm,
      } satisfies LineShape;
      updateShapeBBox(line);
      page.value.shapes.push(line);
      page.value.previewLine = undefined;
      assert(renderer.value);

      renderer.value.renderNewShapeToPrerenderer(line);

      if (page.value.pageIndex === currentDocument.value.pages.length - 1) {
        currentDocument.value.pages.push({
          pageIndex: currentDocument.value.pages.length,
          shapes: [],
        });
      }

      store.saveDocument(currentDocument.value);
    }

    if (renderer.value) {
      if (renderer.value.erasedShapes.size > 0) {
        for (const shape of renderer.value.erasedShapes) {
          renderer.value.markShapeDeleted(shape);
        }
        page.value.shapes = page.value.shapes.filter((s) => !renderer.value?.erasedShapes.has(s));
        renderer.value.erasedShapes = new Set();
      }
    }
  }

  useSelectionTool() {
    explicitSelectionTool.value = true;
  }

  usePenTool(size: number) {
    store.penSizeMm = size;
    explicitSelectionTool.value = false;
  }

  private processEventImpl() {
    assert(this.e);
    this.e.preventDefault();
    assert(viewport.value);
    assert(renderer.value);

    this.eraserButton = (this.e.buttons & 32) !== 0;
    this.stylusButton = (this.e.buttons & 2) !== 0;
    this.penDown = (this.e.buttons & 1) !== 0;

    const vpRect = viewport.value.getBoundingClientRect();
    const pointerInViewportPx = new Vec2(this.e.clientX - vpRect.left, this.e.clientY - vpRect.top);
    this.cursorPosPx = pointerInViewportPx.sub(currentDocument.value.offset);
    this.cursorPosMm = this.cursorPosPx.div(currentDocument.value.zoom_px_per_mm);

    this.deltaMm = new Vec2(this.e.movementX, this.e.movementY).div(currentDocument.value.zoom_px_per_mm);
  }

  processPenDown(e: PointerEvent) {
    this.e = e;
    this.processEventImpl();
    this.onPenDown();
  }

  processPenMove(e: PointerEvent) {
    this.e = e;
    this.processEventImpl();

    if (this.penDown || this.eraserButton || this.stylusButton) {
      this.onPenDrag();
    } else {
      this.onPenHover();
    }
  }

  processPenUp(e: PointerEvent) {
    this.e = e;
    this.processEventImpl();
    this.onPenUp();
  }

  processMouseDown(e: PointerEvent) {
    this.e = e;
    this.processEventImpl();
    this.onMouseDown();
  }

  processMouseMove(e: PointerEvent) {
    this.e = e;
    this.processEventImpl();

    if (this.penDown || this.eraserButton || this.stylusButton) {
      this.onMouseDrag();
    } else {
      // this.onMouseHover();
    }
  }

  processMouseUp(e: PointerEvent) {
    this.e = e;
    this.processEventImpl();
    this.onMouseUp();
  }
}

const controls = ref(new Controls());

const pointerDownHandler = (e: PointerEvent) => {
  markInteraction();
  lassoSelectionToken.value++;
  nextTick(() => {
    // Delay so it can be picked up in onPenDown to prevent drawing
    contextPopupPosPx.value = undefined;
  });
  if (e.pointerType == "touch") {
    pointerEvents.value.push(e);
    updateZoomingPointers();
  } else if (e.pointerType == "mouse") {
    controls.value.processMouseDown(e);
  } else if (e.pointerType == "pen") {
    controls.value.processPenDown(e);
  }
  render();
};

const pointerMoveHandler = (e: PointerEvent) => {
  markInteraction();
  if (!viewport.value || !mainCanvas.value) return;

  // Filter events that are not triggered by movements but other data (e.g. pen pressure)
  if (e.movementX === 0 && e.movementY === 0) return;

  if (e.pointerType == "touch") {
    const index = pointerEvents.value.findIndex((cachedEv) => cachedEv.pointerId === e.pointerId);
    pointerEvents.value[index] = e;
    updateZoomingPointers();
  } else if (e.pointerType == "mouse") {
    controls.value.processMouseMove(e);
  } else if (e.pointerType == "pen") {
    controls.value.processPenMove(e);
  }
  render();
};

const pointerUpHandler = (e: PointerEvent) => {
  markInteraction();
  if (!viewport.value || !mainCanvas.value) return;
  if (e.pointerType == "touch") {
    const index = pointerEvents.value.findIndex((cachedEv) => cachedEv.pointerId === e.pointerId);
    if (index !== -1) {
      pointerEvents.value.splice(index, 1);
    }
    updateZoomingPointers();
  } else if (e.pointerType == "mouse") {
    controls.value.processMouseUp(e);
  } else if (e.pointerType == "pen") {
    controls.value.processPenUp(e);
  }
  render();
};

async function copySelectedShapesToClipboard() {
  const data: ShapesInClipboard = {
    type: "technicalsketcher",
    shapes: selectedShapes.value.map((s) => {
      if (s.variant === "Line") {
        return {
          variant: "Line",
          penColor: s.penColor,
          penThickness: s.penThickness,
          points: s.points.map((p) => ({
            pressure: p.pressure,
            x: p.x,
            y: p.y,
          })),
        } satisfies LineShapeFileFormat;
      } else if (s.variant === "Image") {
        return {
          variant: "Image",
          base64ImageData: s.base64ImageData,
          position: s.position,
          size: {
            x: s.size.x,
            y: s.size.y,
          },
        } satisfies ImageShapeFileFormat;
      } else {
        throw new Error();
      }
    }),
  };

  const blob = new Blob([JSON.stringify(data)], {
    type: "text/plain",
  });

  await navigator.clipboard.write([
    new ClipboardItem({
      "text/plain": blob,
    }),
  ]);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function pasteShapes() {
  const items = await navigator.clipboard.read();

  selectedShapes.value = [];
  for (const item of items) {
    for (const type of item.types) {
      if (type.startsWith("image/")) {
        const blob = await item.getType(type);
        const base64 = await blobToBase64(blob);

        assert(viewport.value);
        const page = currentDocument.value.pages[currentDocument.value.currentPageIndex];
        if (typeof base64 !== "string") return;
        const vpBB = viewport.value.getBoundingClientRect();
        const viewportSizePx = new Vec2(vpBB.width, vpBB.height);
        const pageTopLeft = currentDocument.value.offset;

        const img = await loadImageAsync(base64);

        const imageSizePx = new Vec2(img.width, img.height).div(window.devicePixelRatio);
        const imagePositionInVp = viewportSizePx.div(2).sub(imageSizePx.div(2));
        const imagePositionInPagePx = imagePositionInVp.sub(pageTopLeft);
        const imagePositionInPageMm = imagePositionInPagePx.div(currentDocument.value.zoom_px_per_mm);

        const imageSizeMm = imageSizePx.div(currentDocument.value.zoom_px_per_mm);

        const marginMm = 5;

        if (imageSizeMm.x > currentDocument.value.size_mm.x - marginMm * 2) {
          const ratio = imageSizeMm.x / (currentDocument.value.size_mm.x - marginMm * 2);
          imageSizeMm.x /= ratio;
          imageSizeMm.y /= ratio;
        }

        if (imageSizeMm.y > currentDocument.value.size_mm.y - marginMm * 2) {
          const ratio = imageSizeMm.y / (currentDocument.value.size_mm.y - marginMm * 2);
          imageSizeMm.x /= ratio;
          imageSizeMm.y /= ratio;
        }

        if (imagePositionInPageMm.x < marginMm) {
          imagePositionInPageMm.x = marginMm;
        }
        if (imagePositionInPageMm.y < marginMm) {
          imagePositionInPageMm.y = marginMm;
        }
        if (imagePositionInPageMm.x + imageSizeMm.x > currentDocument.value.size_mm.x - marginMm) {
          imagePositionInPageMm.x = currentDocument.value.size_mm.x - marginMm - imageSizeMm.x;
        }
        if (imagePositionInPageMm.y + imageSizeMm.y > currentDocument.value.size_mm.y - marginMm) {
          imagePositionInPageMm.y = currentDocument.value.size_mm.y - marginMm - imageSizeMm.y;
        }

        const image: ImageShape = {
          variant: "Image",
          bbox: { left: 0, right: 0, top: 0, bottom: 0 },
          base64ImageData: base64,
          position: {
            x: imagePositionInPageMm.x,
            y: imagePositionInPageMm.y,
          },
          size: imageSizeMm,
          image: img,
        };
        assert(renderer.value);
        updateShapeBBox(image);
        page.shapes.push(image);
        renderer.value.renderNewShapeToPrerenderer(image);
        selectedShapes.value.push(image);
        render();
        await store.saveDocument(currentDocument.value);
      } else if (item.types.includes("text/plain")) {
        const blob = await item.getType("text/plain");
        const text = await blob.text();
        const data = JSON.parse(text) as ShapesInClipboard;

        if (data.type !== "technicalsketcher") {
          continue;
        }

        const pastedShapes: Shape[] = [];
        for (const shape of data.shapes) {
          if (shape.variant === "Image") {
            const image: ImageShape = {
              variant: "Image",
              base64ImageData: shape.base64ImageData,
              bbox: { bottom: 0, left: 0, right: 0, top: 0 },
              image: await loadImageAsync(shape.base64ImageData),
              position: {
                x: shape.position.x,
                y: shape.position.y,
              },
              size: new Vec2(shape.size.x, shape.size.y),
            };
            updateShapeBBox(image);
            pastedShapes.push(image);
          } else if (shape.variant === "Line") {
            const line: LineShape = {
              variant: "Line",
              bbox: { bottom: 0, left: 0, right: 0, top: 0 },
              penColor: shape.penColor,
              penThickness: shape.penThickness,
              points: shape.points.map((p) => ({
                pressure: p.pressure,
                x: p.x,
                y: p.y,
              })),
            };
            updateShapeBBox(line);
            pastedShapes.push(line);
          } else {
            throw new Error();
          }
        }

        selectedShapes.value = [];
        if (pastedShapes.length > 0) {
          let combinedBBox = pastedShapes[0].bbox;
          for (const shape of pastedShapes) {
            combinedBBox = combineBBox(combinedBBox, shape.bbox);
          }

          for (const shape of pastedShapes) {
            moveShape(shape, new Vec2(10, 10));

            assert(renderer.value);
            page.value.shapes.push(shape);
            renderer.value.renderNewShapeToPrerenderer(shape);

            selectedShapes.value.push(shape);
          }

          render();
          await store.saveDocument(currentDocument.value);
        }
      }
    }
  }
}

const keydown = (e: KeyboardEvent) => {
  if (e.key === "s" && e.ctrlKey) {
    e.preventDefault();
    if (currentDocument.value.fileHandle) {
      store.saveDocument(currentDocument.value);
    } else {
      console.error("Current file has no handle attached");
    }
  }

  if (e.key === "t") {
    textTool.value = true;
  }

  if (e.key === "c" && e.ctrlKey) {
    copySelectedShapesToClipboard();
  }

  if (e.key === "v" && e.ctrlKey) {
    pasteShapes();
  }

  if (e.key === "Delete") {
    const page = currentDocument.value.pages[currentDocument.value.currentPageIndex];
    for (const shape of selectedShapes.value) {
      renderer.value?.markShapeDeleted(shape);
      page.shapes = page.shapes.filter((s) => s !== shape);
    }
    selectedShapes.value = [];
    movedShapes.value = [];
    store.forceDeepRender = true;
    store.saveDocument(currentDocument.value);
    render();
  }
};

const keyup = (e: KeyboardEvent) => {
  if (e.key === "t") {
    textTool.value = false;
  }
};

onMounted(async () => {
  await nextTick();
  assert(mainCanvas.value);
  renderer.value = new Renderer(currentDocument.value, mainCanvas.value);

  chooseDefaultPen();

  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);

  requestAnimationFrame(render);
});

onUnmounted(() => {
  window.removeEventListener("keydown", keydown);
  window.removeEventListener("keyup", keyup);
  if (pendingFrame.value !== undefined) {
    cancelAnimationFrame(pendingFrame.value);
    pendingFrame.value = undefined;
  }
  if (pendingWheelZoomFinalize.value !== undefined) {
    window.clearTimeout(pendingWheelZoomFinalize.value);
    pendingWheelZoomFinalize.value = undefined;
  }
  cancelPendingDeferredDeepRender();
  cancelPendingPanFinalize();
  cancelPendingIdleZoomPreviewCacheBuild();
});

const contextPopupRef = ref<HTMLDivElement | undefined>();
</script>

<template>
  <div
    ref="viewport"
    class="relative w-full h-full overflow-hidden"
    :class="{
      'cursor-se-resize': cursorResize,
    }"
    @contextmenu.prevent
    @pointercancel="pointerUpHandler($event)"
    @pointerdown="pointerDownHandler($event)"
    @pointerleave="pointerUpHandler($event)"
    @pointerover="pointerUpHandler($event)"
    @pointerrawupdate="pointerMoveHandler($event)"
    @pointerup="pointerUpHandler($event)"
    @wheel="handleWheel"
  >
    <canvas
      ref="mainCanvas"
      class="absolute inset-0 pointer-events-none"
      :style="{
        width: '100%',
        height: '100%',
      }"
    />
    <template v-for="(textblock, index) in textShapes" :key="index">
      <textarea
        v-model="textblock.rawText"
        class="absolute"
        :style="{
          left: currentDocument.offset.x + textblock.position.x * currentDocument.zoom_px_per_mm + 'px',
          top: currentDocument.offset.y + textblock.position.y * currentDocument.zoom_px_per_mm + 'px',
          width: textblock.size.x * currentDocument.zoom_px_per_mm + 'px',
          height: textblock.size.y * currentDocument.zoom_px_per_mm + 'px',
          resize: 'none',
          background: 'transparent',
        }"
      />
    </template>
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
      <div class="-translate-x-1/2 -translate-y-1/2 w-fit flex flex-col gap-12 items-center">
        <div id="penColor" class="flex bg-white p-2 gap-2 w-fit rounded-md border border-black">
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
        <div id="penSize" class="flex bg-white w-fit rounded-md border border-black p-1 gap-1">
          <div
            class="cursor-pointer"
            @click.stop.prevent="
              () => {
                controls.useSelectionTool();
                contextPopupPosPx = undefined;
              }
            "
            @pointercancel.stop.prevent
            @pointerdown.stop.prevent
            @pointerleave.stop.prevent
            @pointermove.stop.prevent
            @pointerup.stop.prevent
          >
            <svg fill="none" height="30" viewBox="0 0 64 64" width="30" xmlns="http://www.w3.org/2000/svg">
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
                controls.usePenTool(thickness);
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
