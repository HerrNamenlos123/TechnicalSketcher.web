<script setup lang="ts">
import type { FSDirEntry, FSFileEntry } from "@/types";
import BasicIcon from "./BasicIcon.vue";
import { useStore } from "./store";

const store = useStore();

const props = defineProps<{
  entry: FSFileEntry | FSDirEntry;
}>();

const emit = defineEmits<{
  openFile: [entry: FSFileEntry];
}>();

const exportDoc = (entry: FSFileEntry) => {
  const doc = store.openDocuments.find(
    (d) => d.fileHandle?.fullPath === entry.fullPath,
  );
  if (doc) {
    store.exportDocumentAsPdf(doc);
  }
};
</script>

<template>
  <div class="">
    <div v-if="entry.type === 'file'" class="flex w-full">
      <div
        class="text-lg p-2 border radius-lg flex items-center gap-2 cursor-pointer flex-grow"
        @click="emit('openFile', entry)"
      >
        <BasicIcon icon="PhFile" />
        {{ entry.filename }}
      </div>
      <div
        class="text-lg p-2 border radius-lg flex items-center gap-2 cursor-pointer"
        @click="exportDoc(entry)"
      >
        <BasicIcon icon="PhFilePdf" />
      </div>
    </div>
    <div v-else-if="entry.type === 'directory'" class="flex flex-col">
      <div
        class="text-lg p-2 border radius-lg flex items-center gap-2 cursor-pointer"
      >
        <BasicIcon icon="PhFolderOpen" />
        {{ entry.dirname }}
      </div>
      <div class="ml-4">
        <SideNavTreeEntry
          v-for="(childEntry, i) in entry.children"
          :key="i"
          :entry="childEntry"
          @open-file="emit('openFile', $event)"
        />
      </div>
    </div>
  </div>
</template>
