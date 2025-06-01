<script setup lang="ts">
import TopBar from "./components/TopBar.vue";
import FreehandTest from "./components/FreehandTest.vue";
</script>

<template>
  <div class="flex flex-col bg-background h-svh w-svh" @wheel.prevent>
    <div ref="canvasWrapper" class="w-full h-full flex flex-col">
      <TopBar />
      <div class="w-full flex-grow flex">
        <div
          id="sidenav"
          class="w-[200px] bg-background border-r border-white border-opacity-20"
        />
        <FreehandTest
          :max-zoom="10"
          :min-zoom="0.1"
          :zoom-sensitivity="0.001"
        />
      </div>
    </div>
  </div>
</template>
