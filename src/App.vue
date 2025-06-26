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

onMounted(async () => {
  window.addEventListener("keydown", keydown);
  await store.init();
});
onUnmounted(() => {
  window.removeEventListener("keydown", keydown);
});
</script>

<template>
  <div
    class="flex flex-col bg-background h-svh w-svh overflow-hidden"
    @wheel.prevent
  >
    <div
      v-if="store.paperTexture"
      class="flex-grow flex flex-col overflow-hidden"
    >
      <TopBar />
      <div class="w-full flex-grow flex overflow-hidden">
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
