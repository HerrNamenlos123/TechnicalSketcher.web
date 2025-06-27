<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Vec2 } from "./Vector";
import {
  type Document,
  type ImageShape,
  type LineShape,
  type Page,
  type Shape,
} from "./Document";
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

const CONTEXT_MENU_PERIMETER_LIMIT_PX = 5;

const store = useStore();
const currentDocument = defineModel<Document>("document", { required: true });
const explicitSelectionTool = ref(false);
const selectedShapes = ref<Shape[]>([]);
const movedShapes = ref<Shape[]>([]);

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
const renderer = ref<undefined | Renderer>();
const viewport = ref<HTMLDivElement>();
const contextPopupPosPx = ref<undefined | Vec2>();
const cursorResize = ref(false);

const page = computed(
  () => currentDocument.value.pages[currentDocument.value.currentPageIndex],
);

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
  if (!viewport.value || !renderer.value) return;
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
  store.forceDeepRender = true;
  render();
};

const pointerEvents = ref<PointerEvent[]>([]);
const isZooming = ref(false);
const lastZoomFingerDistance = ref(0);
const lastZoomCenter = ref(new Vec2());
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
  if (!viewport.value || !renderer.value) return;
  const numberOfFingers = pointerEvents.value.length;
  if (numberOfFingers === 1) {
    currentDocument.value.offset = currentDocument.value.offset.add(
      new Vec2(
        pointerEvents.value[0].movementX,
        pointerEvents.value[0].movementY,
      ),
    );
    isZooming.value = false;
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
    store.forceDeepRender = true;
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

const render = () => {
  if (!renderer.value) return;
  renderer.value.dynamicShapes = [];
  renderer.value.staticShapes = [];
  renderer.value.selectedShapes = [];
  renderer.value.selectionPathPx = selectionPathPx.value;
  renderer.value.eraserPosPx = eraserPosPx.value;

  for (const shape of page.value.shapes) {
    if (selectedShapes.value.includes(shape)) {
      renderer.value.selectedShapes.push(shape);
    }
    if (movedShapes.value.includes(shape)) continue;
    renderer.value.staticShapes.push(shape);
  }

  if (page.value.previewLine) {
    store.forceShallowRender = true;
    renderer.value.dynamicShapes.push(page.value.previewLine);
  }

  for (const shape of movedShapes.value) {
    renderer.value.dynamicShapes.push(shape);
  }

  renderer.value.render();
};

watch(
  () => store.triggerRender,
  () => {
    render();
  },
);

const moveShape = (shape: Shape, delta: Vec2) => {
  if (shape.variant === "Image") {
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
};

const resizeShape = (shape: Shape, origin: Vec2, ratio: number) => {
  if (shape.variant === "Image") {
    const newPos = origin.add(
      new Vec2(shape.position.x, shape.position.y).sub(origin).mul(ratio),
    );
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

  constructor() {}

  onPenDown() {
    assert(this.e);

    // Start resizing
    if (this.isCursorInResizeHandle()) {
      this.isResizing = true;
      const bbox = this.getCombinedSelectionBBox();
      this.resizeOrigin = new Vec2(bbox.left, bbox.top);
      this.resizeLastOriginDistance = this.cursorPosMm
        .sub(this.resizeOrigin)
        .mag();
      movedShapes.value = [...selectedShapes.value];
      selectionPathPx.value = undefined;
      return;
    }

    // Start moving
    if (selectedShapes.value.length > 0) {
      if (isCursorInAnySelectedBBox(this.cursorPosMm)) {
        this.isMovingShapes = true;
        movedShapes.value = [...selectedShapes.value];
        selectionPathPx.value = undefined;
        return;
      } else {
        this.isMovingShapes = false;
        selectedShapes.value = [];
        movedShapes.value = [];
      }
    }

    if (this.stylusButton || explicitSelectionTool.value) {
      selectedShapes.value = [];
      movedShapes.value = [];
      selectionPathPx.value = [this.cursorPosPx];
      this.startedSelectionWithStylusButton = this.stylusButton;
      return;
    }

    if (this.eraserButton) {
      page.value.previewLine = undefined;
      eraserPosPx.value = this.cursorPosMm.mul(
        currentDocument.value.zoom_px_per_mm,
      );
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
        const eraserSizeMm =
          store.eraserSizePx / currentDocument.value.zoom_px_per_mm;
        eraserPosPx.value = this.cursorPosMm.mul(
          currentDocument.value.zoom_px_per_mm,
        );
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
        }

        if (deleteShape) {
          page.value.shapes = page.value.shapes.filter((s) => s !== shape);
          return;
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
    }
  }

  onPenUp() {
    assert(this.e);

    eraserPosPx.value = undefined;
    this.isMovingShapes = false;

    if (this.isResizing) {
      this.isResizing = false;
    }

    if (selectionPathPx.value) {
      // Releasing while using selection
      if (
        selectionPathPerimeterLength.value <= CONTEXT_MENU_PERIMETER_LIMIT_PX
      ) {
        // Has not moved while selecting
        if (
          explicitSelectionTool.value &&
          !this.startedSelectionWithStylusButton
        ) {
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
        for (const shape of page.value.shapes) {
          let skip = false;
          if (shape.variant === "Line") {
            for (const point of shape.points) {
              if (
                !pointInPolygon(
                  new Vec2(point.x, point.y).mul(
                    currentDocument.value.zoom_px_per_mm,
                  ),
                  selectionPathPx.value,
                )
              ) {
                skip = true;
                break;
              }
            }
          } else {
            const topLeft = new Vec2(shape.position.x, shape.position.y);
            const topRight = new Vec2(
              shape.position.x + shape.size.x,
              shape.position.y,
            );
            const bottomRight = new Vec2(
              shape.position.x + shape.size.x,
              shape.position.y + shape.size.y,
            );
            const bottomLeft = new Vec2(
              shape.position.x,
              shape.position.y + shape.size.y,
            );
            if (
              !pointInPolygon(
                topLeft.mul(currentDocument.value.zoom_px_per_mm),
                selectionPathPx.value,
              ) ||
              !pointInPolygon(
                topRight.mul(currentDocument.value.zoom_px_per_mm),
                selectionPathPx.value,
              ) ||
              !pointInPolygon(
                bottomRight.mul(currentDocument.value.zoom_px_per_mm),
                selectionPathPx.value,
              ) ||
              !pointInPolygon(
                bottomLeft.mul(currentDocument.value.zoom_px_per_mm),
                selectionPathPx.value,
              )
            ) {
              skip = true;
            }
          }
          if (skip) continue;
          selectedShapes.value.push(shape);
        }
        selectionPathPx.value = undefined;
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

      // drawShape(getCtx(store.currentPageCanvas), currentPage.previewLine);

      if (page.value.pageIndex === currentDocument.value.pages.length - 1) {
        currentDocument.value.pages.push({
          pageIndex: currentDocument.value.pages.length,
          shapes: [],
        });
      }

      store.saveDocument(currentDocument.value);
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
    assert(mainCanvas.value);
    assert(renderer.value);

    this.eraserButton = (this.e.buttons & 32) !== 0;
    this.stylusButton = (this.e.buttons & 2) !== 0;
    this.penDown = (this.e.buttons & 1) !== 0;

    const topLeft = new Vec2(
      mainCanvas.value.getBoundingClientRect().left -
        viewport.value.getBoundingClientRect().left,
      mainCanvas.value.getBoundingClientRect().top -
        viewport.value.getBoundingClientRect().top,
    );
    this.cursorPosPx = new Vec2(this.e.offsetX, this.e.offsetY).sub(topLeft);
    this.cursorPosMm = this.cursorPosPx.div(
      currentDocument.value.zoom_px_per_mm,
    );

    this.deltaMm = new Vec2(this.e.movementX, this.e.movementY).div(
      currentDocument.value.zoom_px_per_mm,
    );
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
}

const controls = ref(new Controls());

const pointerDownHandler = (e: PointerEvent) => {
  contextPopupPosPx.value = undefined;
  if (e.pointerType == "touch") {
    pointerEvents.value.push(e);
    updateZoomingPointers();
  } else if (e.pointerType == "mouse") {
    // mouseEvent(e, Action.Down);
  } else if (e.pointerType == "pen") {
    controls.value.processPenDown(e);
  }
  render();
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
    // mouseEvent(e, Action.Move);
  } else if (e.pointerType == "pen") {
    controls.value.processPenMove(e);
  }
  render();
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
    // mouseEvent(e, Action.Up);
  } else if (e.pointerType == "pen") {
    controls.value.processPenUp(e);
  }
  render();
};

const keydown = (e: KeyboardEvent) => {
  if (e.key === "s" && e.ctrlKey) {
    e.preventDefault();
    if (currentDocument.value.fileHandle) {
      store.saveDocument(currentDocument.value);
    } else {
      console.error("Current file has no handle attached");
    }
  }
  if (e.key === "Delete") {
    const page =
      currentDocument.value.pages[currentDocument.value.currentPageIndex];
    for (const shape of selectedShapes.value) {
      page.shapes = page.shapes.filter((s) => s !== shape);
    }
    selectedShapes.value = [];
    movedShapes.value = [];
  }
  store.forceDeepRender = true;
  render();
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
          variant: "Image",
          bbox: { left: 0, right: 0, top: 0, bottom: 0 },
          base64ImageData: imageBase64,
          position: {
            x: imagePositionInPageMm.x,
            y: imagePositionInPageMm.y,
          },
          size: new Vec2(img.width, img.height).div(
            currentDocument.value.zoom_px_per_mm,
          ),
          image: img,
        };
        updateShapeBBox(image);
        page.shapes.push(image);
        render();
        await store.saveDocument(currentDocument.value);
      };

      reader.readAsDataURL(file);
    }
  }
};

onMounted(async () => {
  await nextTick();
  assert(mainCanvas.value);
  renderer.value = new Renderer(currentDocument.value, mainCanvas.value);

  window.addEventListener("keydown", keydown);
  window.addEventListener("paste", paste);
  render();
});

onUnmounted(() => {
  window.removeEventListener("keydown", keydown);
  window.removeEventListener("paste", paste);
});

const contextPopupRef = ref<HTMLDivElement | undefined>();
</script>

<template>
  <div
    ref="viewport"
    class="relative w-full h-full overflow-hidden bg-white"
    :class="{
      'cursor-se-resize': cursorResize,
    }"
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
