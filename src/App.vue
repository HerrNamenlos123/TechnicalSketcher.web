<script setup lang="ts">
import FreehandTest from "./components/FreehandTest.vue";
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { hasPendingSaves, useStore } from "./components/store";
import { Button, Dock, Splitter, SplitterPanel, Toast, useToast } from "primevue";
import SideNav from "./components/SideNav.vue";
import type { MenuItem } from "primevue/menuitem";
import { useRoute } from "vue-router";
import { isElectron } from "./vault/electronHandle";

const store = useStore();
const toast = useToast();

let unsubscribeUpdateDownloaded: (() => void) | undefined;
let unsubscribeOpenFile: (() => void) | undefined;

const restartForUpdate = () => {
  window.electronAPI?.updates.quitAndInstall();
};

const keydown = (e: KeyboardEvent) => {
  if (e.key === "s" && e.ctrlKey) {
    e.preventDefault();
  }
};

// There's no reliable way to await an async write inside beforeunload, so the best we can do
// is warn the user that closing/reloading right now could cut off a save still in flight.
const beforeunload = (e: BeforeUnloadEvent) => {
  if (hasPendingSaves()) {
    e.preventDefault();
    e.returnValue = "";
  }
};

const route = useRoute();

watch(
  [() => route?.query, () => store.vault],
  () => {
    if (!store.vault) return;
    const file = route?.query?.file;
    if (file && !Array.isArray(file)) {
      store.loadAndOpenDocumentFromPathOptimisticMatch(file);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const url = new URL(window.location as any); // current URL
      url.searchParams.delete("file"); // remove the param
      window.history.replaceState({}, "", url);
    }
  },
  { immediate: true, deep: true },
);

onMounted(async () => {
  window.addEventListener("keydown", keydown);
  window.addEventListener("beforeunload", beforeunload);
  await store.init();

  if (isElectron()) {
    unsubscribeOpenFile = window.electronAPI!.app.onOpenFile((path) => {
      store.loadAndOpenDocumentFromPathOptimisticMatch(path);
    });
    unsubscribeUpdateDownloaded = window.electronAPI!.updates.onDownloaded(() => {
      toast.add({
        severity: "info",
        summary: "Update ready",
        detail: "A new version was downloaded. Restart the app to apply it.",
        group: "update",
        life: 0,
      });
    });
  }
});
onUnmounted(() => {
  window.removeEventListener("keydown", keydown);
  window.removeEventListener("beforeunload", beforeunload);
  unsubscribeUpdateDownloaded?.();
  unsubscribeOpenFile?.();
});

const leftSidebarToggleTrigger = ref(true);
watch(
  () => store.leftSidebarVisible,
  async () => {
    if (store.leftSidebarVisible) {
      leftSidebarToggleTrigger.value = false;
      await nextTick();
      leftSidebarToggleTrigger.value = true;
    }
  },
  { deep: true },
);

const items = ref<MenuItem[]>([
  {
    label: "back",
    icon: "pi pi-angle-left",
    disabled: () => !store.currentlyOpenDocument || store.currentlyOpenDocument.currentPageIndex <= 0,
    command: () => {
      if (!store.currentlyOpenDocument) return;
      store.currentlyOpenDocument.currentPageIndex--;
      store.triggerRender = true;
      store.forceDeepRender = true;
      store.saveDocument(store.currentlyOpenDocument);
    },
  },
  {
    label: "next",
    icon: "pi pi-angle-right",
    disabled: () =>
      !store.currentlyOpenDocument ||
      store.currentlyOpenDocument.currentPageIndex >= store.currentlyOpenDocument.pages.length - 1,
    command: () => {
      if (!store.currentlyOpenDocument) return;
      store.currentlyOpenDocument.currentPageIndex++;
      store.triggerRender = true;
      store.forceDeepRender = true;
      store.saveDocument(store.currentlyOpenDocument);
    },
  },
]);
</script>

<template>
  <div class="relative flex flex-col bg-background h-svh w-svh overflow-hidden">
    <img class="absolute w-full z-0 h-full object-cover blur-[1px]" src="/table-tiling-2.jpg" />
    <div class="absolute z-20 w-full h-full left-0 top-0 pointer-events-none">
      <Splitter v-if="leftSidebarToggleTrigger" style="height: 100%; width: 100%">
        <SplitterPanel v-if="store.leftSidebarVisible" :min-size="10" :size="20">
          <div class="flex flex-col h-full bg-white/10 backdrop-blur-[5px] pointer-events-auto">
            <div class="flex justify-between p-2 items-center">
              <div class="text-black text-xl font-bold pl-2">TechnicalSketcher</div>
              <Button
                icon="pi pi-bars"
                severity="secondary"
                @click="store.leftSidebarVisible = !store.leftSidebarVisible"
              />
            </div>
            <div class="overflow-y-auto px-2">
              <SideNav />
            </div>
          </div>
        </SplitterPanel>
        <SplitterPanel :min-size="50" :size="80">
          <div v-if="store.paperTexture" class="h-full flex flex-col">
            <div class="relative w-full h-full flex">
              <div v-if="!store.leftSidebarVisible" class="absolute top-0 left-0 p-2 z-20 pointer-events-auto">
                <Button
                  icon="pi pi-bars"
                  severity="secondary"
                  @click="store.leftSidebarVisible = !store.leftSidebarVisible"
                />
              </div>
              <div class="absolute bottom-0 left-0 w-full pb-4">
                <div class="relative">
                  <Dock position="bottom" :model="items">
                    <template #itemicon="{ item }">
                      <Button
                        severity="primary"
                        :icon="item.icon"
                        @click="item.command?.({ item: item, originalEvent: $event })"
                      />
                    </template>
                  </Dock>
                </div>
              </div>
            </div>
          </div>
        </SplitterPanel>
      </Splitter>
    </div>
    <FreehandTest
      v-if="store.currentlyOpenDocument"
      v-model:document="store.currentlyOpenDocument"
      :max-zoom="80"
      :min-zoom="0.5"
      :zoom-sensitivity="0.001"
    />
    <Toast />
    <Toast position="bottom-right" group="update">
      <template #message="slotProps">
        <div class="flex flex-col gap-2">
          <div>{{ slotProps.message.detail }}</div>
          <Button label="Restart Now" size="small" @click="restartForUpdate" />
        </div>
      </template>
    </Toast>
  </div>
</template>

<style>
:root {
  --p-dock-padding: 4px !important;
  --p-dock-item-padding: 0 !important;
  --p-dock-background: rgba(255, 255, 255, 0.553) !important;
  --p-dock-border-color: rgba(0, 0, 0, 0.395) !important;

  --p-splitter-color: transparent !important;
  --p-splitter-background: transparent !important;
  --p-splitter-border-color: transparent !important;
}
</style>
