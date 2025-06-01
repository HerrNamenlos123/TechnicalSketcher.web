<script setup lang="ts">
import { Vec2 } from "../types/Vector";
import { ref, onMounted, computed, watch, nextTick } from "vue";
import { TskDocument } from "../types/TskDocument";
import Toolbar from "./Toolbar.vue";
import { useResizeObserver } from "@vueuse/core";
import { SelectTool } from "../types/Tools";
import FreehandTest from "./FreehandTest.vue";

const props = withDefaults(
  defineProps<{
    zoomSensitivity: number;
    invertMouse: boolean;
    snapToGridCM: number;
    minZoomFactor?: number;
    maxZoomFactor?: number;
  }>(),
  {
    minZoomFactor: 1,
    maxZoomFactor: 500,
  },
);

/// =================================================================
/// ====                         Canvas                          ====
/// =================================================================
const canvasWrapper = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const canvasContext = computed(() => canvasRef.value?.getContext("2d"));

const document = ref(new TskDocument());

/// =================================================================
/// ====                     Mouse Position                      ====
/// =================================================================
const onMouseMove = (e: MouseEvent) => {
  document.value.globalMousePosition.x = e.clientX;
  document.value.globalMousePosition.y = e.clientY;
  document.value.onCursorMove();
};

watch(
  () => canvasRef.value?.getBoundingClientRect(),
  () => {
    const rect = canvasRef.value?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    document.value.canvasClientBoundingRect.x = rect.left;
    document.value.canvasClientBoundingRect.y = rect.top;
  },
  { immediate: true, deep: true },
);

/// =================================================================
/// ====                     Tool Selection                      ====
/// =================================================================
const selectedToolId = ref("select");
watch(
  selectedToolId,
  () => {
    document.value.selectTool(selectedToolId.value);
  },
  { immediate: true, deep: true },
);

const handleKeyDown = (e: KeyboardEvent) => {
  document.value.handleKey(e.code);
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    document.value.shiftPressed = true;
  }
  document.value.onCursorMove();
};

const handleKeyUp = (e: KeyboardEvent) => {
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    document.value.shiftPressed = false;
  }
  document.value.onCursorMove();
};

const handlePanDelta = (delta: Vec2) => {
  document.value.pan = document.value.pan.add(delta);
};

const handleZoom = (newGlobalFactor: number, averagePosition: Vec2) => {
  const averageInCanvasCoords =
    document.value.globalCoordsToCanvasCoords(averagePosition);
  const averageToPrevPan = document.value.pan.sub(averageInCanvasCoords);

  if (newGlobalFactor > props.maxZoomFactor) {
    newGlobalFactor = props.maxZoomFactor;
  }
  if (newGlobalFactor < props.minZoomFactor) {
    newGlobalFactor = props.minZoomFactor;
  }

  const scaledAverageToPan = averageToPrevPan.mul(
    newGlobalFactor / document.value.zoom,
  );

  document.value.pan = averageInCanvasCoords.add(scaledAverageToPan);
  document.value.zoom = newGlobalFactor;
};

const handleWheel = (e: WheelEvent) => {
  console.log(e);
  if (e.ctrlKey) {
    const delta = e.deltaX + e.deltaY;
    const newGlobalZoom =
      document.value.zoom +
      document.value.zoom * (-delta * props.zoomSensitivity);
    handleZoom(newGlobalZoom, new Vec2(e.clientX, e.clientY));
  } else {
    const delta = new Vec2(-e.deltaX, -e.deltaY);
    if (props.invertMouse) {
      delta.mul(-1);
    }
    handlePanDelta(delta);
  }
};

const moveCanvasCenterTo = (point: Vec2) => {
  document.value.pan = point;
};

const updatePointers = () => {
  return;
  console.log("Update pointers");
  const nav = document.value.nav;
  const numberOfFingers = nav.eventCache.length;
  if (numberOfFingers === 1) {
    const averagePosition = new Vec2(
      nav.eventCache[0].clientX,
      nav.eventCache[0].clientY,
    );
    if (!nav.lastAveragePosition) {
      nav.lastAveragePosition = averagePosition;
      return;
    }
    console.log("Average", averagePosition, nav.lastAveragePosition);
    handlePanDelta(averagePosition.sub(nav.lastAveragePosition));
    nav.lastAveragePosition = averagePosition;
    return;
  } else if (numberOfFingers !== 2) {
    nav.initialZoomFingerDistance = undefined;
    nav.lastAveragePosition = undefined;
    nav.initialZoomFactor = undefined;
    return;
  }

  const finger1 = new Vec2(
    nav.eventCache[0].clientX,
    nav.eventCache[0].clientY,
  );
  const finger2 = new Vec2(
    nav.eventCache[1].clientX,
    nav.eventCache[1].clientY,
  );
  const averagePosition = finger1.add(finger2).div(2);
  const fingerDistance = finger2.sub(finger1).mag();

  if (
    !nav.initialZoomFingerDistance ||
    !nav.lastAveragePosition ||
    !nav.initialZoomFactor ||
    !nav.initialZoomPosition
  ) {
    nav.initialZoomFingerDistance = fingerDistance;
    nav.lastAveragePosition = averagePosition;
    nav.initialZoomFactor = document.value.zoom;
    nav.initialZoomPosition = averagePosition;
    return;
  }

  handlePanDelta(averagePosition.sub(nav.lastAveragePosition));
  const fingerDistanceScaleFactor =
    fingerDistance / nav.initialZoomFingerDistance;
  handleZoom(
    nav.initialZoomFactor * fingerDistanceScaleFactor,
    averagePosition,
  );

  nav.lastAveragePosition = averagePosition;
};

const pointerDownHandler = (e: PointerEvent) => {
  console.log("Pointer down");
  return;
  const nav = document.value.nav;
  if (e.pointerType == "touch") {
    nav.eventCache.push(e);
    nav.initialZoomFingerDistance = undefined;
    nav.lastAveragePosition = undefined;
    nav.initialZoomFactor = undefined;
    updatePointers();
  } else if (e.pointerType == "mouse") {
    const mousePos = new Vec2(e.clientX, e.clientY);
    if (e.buttons === 4 || (e.shiftKey && e.buttons == 1)) {
      nav.prevMousePosition = mousePos;
    }
    document.value.shiftPressed = e.shiftKey;
    switch (e.button) {
      case 0:
        document.value.onCursorDown("left");
        break;
      case 1:
        document.value.onCursorDown("wheel");
        break;
      case 2:
        document.value.onCursorDown("right");
        break;
    }
  } else if (e.pointerType == "pen") {
    document.value.shiftPressed = e.shiftKey;
    // document.onCursorDown("left");
  }
};

const pointerMoveHandler = (e: PointerEvent) => {
  console.log("Move");
  return;
  const nav = document.value.nav;
  if (e.pointerType == "touch") {
    const index = nav.eventCache.findIndex(
      (cachedEv) => cachedEv.pointerId === e.pointerId,
    );
    nav.eventCache[index] = e;
    updatePointers();
  } else if (e.pointerType == "mouse") {
    const mouse = new Vec2(e.clientX, e.clientY);
    if (
      e.buttons === 4 ||
      (e.shiftKey &&
        e.buttons == 1 &&
        document.value.selectedTool instanceof SelectTool)
    ) {
      handlePanDelta(mouse.sub(nav.prevMousePosition));
    }
    nav.prevMousePosition = mouse;
    document.value.shiftPressed = e.shiftKey;
  } else if (e.pointerType == "pen") {
    const pen = new Vec2(e.clientX, e.clientY);
    nav.prevMousePosition = pen;
    document.value.shiftPressed = e.shiftKey;
  }
};

const pointerUpHandler = (e: PointerEvent) => {
  console.log("Pointer up");
  return;
  const nav = document.value.nav;
  if (e.pointerType == "touch") {
    const index = nav.eventCache.findIndex(
      (cachedEv) => cachedEv.pointerId === e.pointerId,
    );
    if (index !== -1) {
      nav.eventCache.splice(index, 1);
    }
    nav.initialZoomFingerDistance = undefined;
    nav.lastAveragePosition = undefined;
    nav.initialZoomFactor = undefined;
    updatePointers();
  } else if (e.pointerType == "mouse") {
    document.value.shiftPressed = e.shiftKey;
    switch (e.button) {
      case 0:
        document.value.onCursorUp("left");
        break;
      case 1:
        document.value.onCursorUp("wheel");
        break;
      case 2:
        document.value.onCursorUp("right");
        break;
    }
  } else if (e.pointerType == "pen") {
    document.value.shiftPressed = e.shiftKey;
    document.value.onCursorUp("left");
  }
};

onMounted(() => {
  // const canvas = canvasRef.value;
  // if (canvas) {
  //   const context = canvas.getContext("2d");
  //   if (context) {
  //     this.setState({ canvasContext: context });
  //     this.moveCanvasCenterToPoint(
  //       new Vec2(
  //         context.canvas.width / 2,
  //         context.canvas.height / 2
  //       )
  //     );
  //     this.canvasRenderer = new CanvasRenderer(this.state, context);
  //   }
  // }
});

// const componentDidUpdate = () => {
// if (state.canvasContext) {
//   if (canvasRenderer.value) {
//     canvasRenderer.value.renderCanvas(this.state);
//   }
// }
// }

//     const drawCircle = (
//         position: Vec2,
//         radius: number,
//         lineWidth: number,
//         strokeStyle: string
// ) => {
//         const c = this.ctx;
//         const p = this.objectToCanvasCoords(position);
//         const r = this.objectToCanvasDistance(radius);
//
//         // Optimize bounding box
//
//         c.beginPath();
//         c.arc(p.x, p.y, r, 0, Math.PI * 2);
//         c.lineWidth = this.objectToCanvasDistance(lineWidth);
//         c.strokeStyle = strokeStyle;
//         c.stroke();
//     }

const renderCanvas = async () => {
  if (!canvasWrapper.value || !canvasRef.value) {
    return;
  }
  canvasRef.value.width = canvasRef.value?.getBoundingClientRect().width;
  canvasRef.value.height = canvasRef.value?.getBoundingClientRect().height;
  const ctx = canvasContext.value;

  if (ctx) {
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    document.value.render(ctx);
  }
};

watch(
  document,
  () => {
    renderCanvas();
  },
  { immediate: true, deep: true },
);

useResizeObserver(canvasWrapper, () => renderCanvas());
onMounted(async () => {
  await nextTick();
  renderCanvas();
});
</script>

<template>
  <div ref="canvasWrapper" class="w-full h-full flex flex-col">
    <div id="topbar" class="h-[50px] bg-[#45506e]"></div>
    <div class="w-full flex-grow flex">
      <div id="topbar" class="w-[200px] bg-[#45506e]"></div>
      <Freehand-Test />
    </div>
    <!-- <Toolbar v-model:selected-tool="selectedToolId" /> -->
    <!-- <div v-if="false" class="absolute z-100 w-64 h-64 bg-red-500 canvass" @pointerdown="console.log('pointer down')"> -->
    <!-- </div> -->
    <!-- <div class="w-full h-full bg-green-500" id="map" /> -->
    <!-- ref="canvasRef" -->
    <!-- tabIndex="0" -->
    <!-- <canvas -->
    <!--   v-if="false" -->
    <!--   class="w-full h-full select-none canvas" -->
    <!-- /> -->
  </div>
</template>

<style scoped>
canvas div {
  touch-action: none;
}

#map {
  height: 150vh;
  width: 70vw;
  background: linear-gradient(blue, green);
  touch-action: none;
}
</style>
<!-- @keydown="handleKeyUp" -->
<!-- @keyup="handleKeyDown" -->
<!-- @mousemove="onMouseMove" -->
<!-- @pointercancel="pointerUpHandler" -->
<!-- @pointerdown="pointerDownHandler" -->
<!-- @pointerleave="pointerUpHandler" -->
<!-- @pointermove="pointerMoveHandler" -->
<!-- @pointerout="pointerUpHandler" -->
<!-- @pointerup="pointerUpHandler" -->
<!-- @wheel="handleWheel" -->
