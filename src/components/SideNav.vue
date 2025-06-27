<script setup lang="ts">
import SideNavTreeEntry from "./SideNavTreeEntry.vue";
import { useStore } from "./store";
import { onMounted, ref } from "vue";
import BasicIcon from "./BasicIcon.vue";
import type { FSFileEntry } from "@/types";
import Button from "./Button.vue";
import { ColorPicker } from "vue3-colorpicker";

const openVault = async () => {
  await store.initVault();
  await store.loadVault();
};

onMounted(() => {
  store.loadVault();
});

const store = useStore();

const createDocumentPopup = ref(false);
const createFilepath = ref("");

const openFile = async (file: FSFileEntry) => {
  await store.loadAndOpenDocument(file);
};

// const a = () => {
//   // if (store.currentDocument) {
//   //   // console.log("doc", store.currentDocument.pages);
//   //   // for (const page of store.currentDocument.pages) {
//   //   //   console.log(page);
//   //   // }
//   // }
//   setTimeout(a, 1000);
// };
// a();

const exportDone = ref(false);

const exportDoc = async (entry: FSFileEntry) => {
  const doc = store.openDocuments.find(
    (d) => d.fileHandle?.fullPath === entry.fullPath,
  );
  if (doc) {
    await store.exportDocumentAsPdf(doc);
    exportDone.value = true;
    setTimeout(() => {
      exportDone.value = false;
    }, 1000);
  }
};

const setPageWidth = (x: number) => {
  if (!store.currentlyOpenDocument) return;
  store.currentlyOpenDocument.size_mm.x = x;
  store.triggerRender = true;
};

const setPageHeight = (y: number) => {
  if (!store.currentlyOpenDocument) return;
  store.currentlyOpenDocument.size_mm.y = y;
  store.triggerRender = true;
};
</script>

<template>
  <div
    class="w-64 bg-background border-r border-white border-opacity-20 text-white overflow-y-auto"
  >
    <div class="h-fit">
      <template v-if="store.vault">
        <SideNavTreeEntry
          v-for="(entry, i) in store.vault.filetree"
          :key="i"
          :entry="entry"
          @open-file="openFile"
        />
      </template>
      <template v-else>
        <div
          class="border p-1 text-white text-xl rounded-lg cursor-pointer"
          @click="openVault"
        >
          Open Vault
        </div>
      </template>
      <div class="w-full flex justify-center mt-4 text-xl relative">
        <div
          class="p-1 border rounded-md cursor-pointer"
          @click="
            createDocumentPopup = true;
            createFilepath = '';
          "
        >
          <BasicIcon icon="PhPlus" />
        </div>
        <div
          v-if="createDocumentPopup"
          class="absolute top-0 left-0 z-50 bg-background border w-[400px] p-2 gap-2 flex flex-col"
        >
          <div class="">Filepath</div>
          <input v-model="createFilepath" class="bg-black" />
          <div class="flex gap-4">
            <Button
              text="Create"
              @click="
                store.createDocument(createFilepath);
                createDocumentPopup = false;
              "
            />
            <Button text="Cancel" @click="createDocumentPopup = false" />
          </div>
        </div>
      </div>

      <div
        v-if="store.currentlyOpenDocument?.fileHandle !== undefined"
        class="w-full flex justify-center mt-4 text-xl relative"
      >
        <Button
          :icon="(!exportDone && 'PhFilePdf') || undefined"
          :text="!exportDone ? 'Export PDF' : 'Done'"
          @click="exportDoc(store.currentlyOpenDocument.fileHandle)"
        />
      </div>

      <div
        v-if="store.currentlyOpenDocument"
        class="flex items-center gap-2 ml-4 text-xl mt-4"
      >
        <div>{{ "Page Color" }}</div>
        <ColorPicker
          v-model:pure-color="store.currentlyOpenDocument.pageColor"
          @pure-color-change="
            () => {
              store.triggerRender = true;
              store.deepRender = true;
            }
          "
        />
      </div>
      <div
        v-if="store.currentlyOpenDocument"
        class="flex items-center gap-2 ml-4 text-xl mt-4"
      >
        <div>{{ "Grid Color" }}</div>
        <ColorPicker
          v-model:pure-color="store.currentlyOpenDocument.gridColor"
          @pure-color-change="
            () => {
              store.triggerRender = true;
              store.deepRender = true;
            }
          "
        />
      </div>
      <div
        v-if="(store.currentlyOpenDocument?.pages.length || 0) > 0"
        class="flex items-center gap-2 ml-4 text-xl mt-4"
      >
        <div>{{ "Page Width" }}</div>
        <input
          class="w-16 bg-black border"
          type="text"
          :value="store.currentlyOpenDocument?.size_mm.x"
          @input="
            (e) => setPageWidth(Number((e.target as HTMLInputElement).value))
          "
        />
        <div>{{ "mm" }}</div>
      </div>
      <div
        v-if="(store.currentlyOpenDocument?.pages.length || 0) > 0"
        class="flex items-center gap-2 ml-4 text-xl mt-4"
      >
        <div>{{ "Page Height" }}</div>
        <input
          class="w-16 bg-black border"
          type="text"
          :value="store.currentlyOpenDocument?.size_mm.y"
          @input="
            (e) => setPageHeight(Number((e.target as HTMLInputElement).value))
          "
        />
        <div>{{ "mm" }}</div>
      </div>
    </div>
  </div>
</template>
