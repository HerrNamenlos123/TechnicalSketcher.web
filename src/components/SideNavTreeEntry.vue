<script setup lang="ts">
import type { FSDirEntry, FSFileEntry } from "@/types";
import BasicIcon from "./BasicIcon.vue";

const props = defineProps<{
  entry: FSFileEntry | FSDirEntry;
}>();

const emit = defineEmits<{
  openFile: [entry: FSFileEntry];
}>();
</script>

<template>
  <div class="">
    <div v-if="entry.type === 'file'" class="">
      <div
        class="text-lg p-2 border radius-lg flex items-center gap-2 cursor-pointer"
        @click="emit('openFile', entry)"
      >
        <BasicIcon icon="PhFile" />
        {{ entry.filename }}
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
