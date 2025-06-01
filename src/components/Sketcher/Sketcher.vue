<script setup lang="ts">
import { Vec2 } from "../types/Vector";
import { ref, onMounted, computed, watch, nextTick } from "vue";
import { TskDocument } from "../types/TskDocument";
import Toolbar from "./Toolbar.vue";
import { useResizeObserver } from "@vueuse/core";
import { SelectTool } from "../types/Tools";
import FreehandTest from "./FreehandTest.vue";
</script>

<template>
  <div ref="canvasWrapper" class="w-full h-full flex flex-col">
    <div id="topbar" class="h-[50px] bg-[#45506e]"></div>
    <div class="w-full flex-grow flex">
      <div id="topbar" class="w-[200px] bg-[#45506e]"></div>
      <Freehand-Test :max-zoom="10" :min-zoom="0.1" :zoom-sensitivity="0.001" />
    </div>
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
