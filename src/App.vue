<script setup lang="ts">
import TopBar from "./components/TopBar.vue";
import FreehandTest from "./components/FreehandTest.vue";
import { onMounted, onUnmounted } from "vue";
import SideNav from "./components/SideNav.vue";
import { useStore } from "./components/store";

const store = useStore();

const keydown = (e: KeyboardEvent) => {
  if (e.key === "s" && e.ctrlKey) {
    e.preventDefault();
  }
};

onMounted(() => {
  window.addEventListener("keydown", keydown);
});
onUnmounted(() => {
  window.removeEventListener("keydown", keydown);
});
</script>

<template>
  <div class="flex flex-col bg-background h-svh w-svh" @wheel.prevent>
    <div ref="canvasWrapper" class="w-full h-full flex flex-col">
      <TopBar />
      <div class="w-full flex-grow flex">
        <SideNav />
        <FreehandTest
          v-if="store.currentlyOpenDocument"
          v-model:document="store.currentlyOpenDocument"
          :max-zoom="15"
          :min-zoom="0.1"
          :zoom-sensitivity="0.001"
        />
      </div>
    </div>
  </div>
</template>
