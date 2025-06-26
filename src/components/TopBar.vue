<script setup lang="ts">
import Button from "./Button.vue";
import { useStore } from "./store";

const store = useStore();

const next = () => {
  if (!store.currentlyOpenDocument) return;
  store.currentlyOpenDocument.currentPageIndex++;
  store.forceRender = true;
  store.flushCanvas = true;
};

const prev = () => {
  if (!store.currentlyOpenDocument) return;
  store.currentlyOpenDocument.currentPageIndex--;
  store.forceRender = true;
  store.flushCanvas = true;
};
</script>

<template>
  <div
    class="h-12 bg-background border-b border-white border-opacity-20 justify-content-between flex justify-center items-center"
  >
    <div v-if="store.currentlyOpenDocument" class="flex gap-4 ml-64">
      <Button
        class="text-white"
        text="<"
        :disabled="store.currentlyOpenDocument.currentPageIndex <= 0"
        @click="prev"
      />
      <Button
        class="text-white"
        text=">"
        :disabled="
          store.currentlyOpenDocument.currentPageIndex >=
          store.currentlyOpenDocument.pages.length - 1
        "
        @click="next"
      />
    </div>
  </div>
</template>
