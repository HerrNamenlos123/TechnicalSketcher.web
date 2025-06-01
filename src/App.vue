<script setup lang="ts">
import { onMounted } from "vue";
import Sketcher from "./components/Sketcher/Sketcher.vue";
import TopBar from "./components/TopBar.vue";

onMounted(() => {
  document.addEventListener("onpointerdown", (e) => {
    console.log("Pointer down global");
  });
  document.addEventListener("onpointermove", (e) => {
    console.log("Pointer move global");
  });
  document.addEventListener("onpointerup", (e) => {
    console.log("Pointer up global");
  });
});

const down = (e: PointerEvent) => {
  e.preventDefault();
  console.log("pointer down");
};
const move = (e: PointerEvent) => {
  e.preventDefault();
  console.log("pointer move");
};
const up = (e: PointerEvent) => {
  e.preventDefault();
  console.log("pointer up");
};
</script>

<template>
  <div class="flex flex-col bg-background h-svh w-svh overflow-hidden">
    <TopBar />
    <div class="relative w-full flex-grow flex">
      <Sketcher
        :invert-mouse="false"
        :snap-to-grid-c-m="1"
        :zoom-sensitivity="0.001"
      />
    </div>
  </div>
  <!-- <div class="w-screen h-screen bg-red-500 test" @pointerdown="down" -->
  <!--   @pointermove="move" @pointerup="up" /> -->
</template>
<style scoped>
.test {
  touch-action: none;
}
</style>
