<script setup lang="ts">
import { watch } from "vue";
import BasicIcon from "../BasicIcon.vue";

const selectedTool = defineModel<string>("selectedTool", { required: true });

defineEmits<{
  onSelectTool: [tool: string];
}>();

type Tool = {
  name: string;
  icon: string;
};

const tools: Tool[] = [
  { name: "select", icon: "PhSelectionPlus" },
  { name: "line", icon: "PhLineSegment" },
  { name: "line_strip", icon: "PhLineSegments" },
  { name: "circle", icon: "PhCircle" },
  { name: "pen", icon: "PhPen" },
  { name: "brush", icon: "PhPaintBrush" },
  { name: "cut", icon: "PhScissors" },
  { name: "copy", icon: "PhCopy" },
  { name: "settings", icon: "PhGear" },
];

const selectTool = (toolIndex: number) => {
  selectedTool.value = tools[toolIndex].name;
};

watch(
  selectedTool,
  () => {
    if (!tools.find((t) => t.name === selectedTool.value)) {
      selectTool(0);
    }
  },
  { deep: true, immediate: true },
);
</script>

<template>
  <div class="absolute left-1/2 -translate-x-1/2 text-2xl">
    <div class="relative m-2 border rounded-md flex items-center bg-background">
      <div
        v-for="(tool, i) in tools"
        :key="tool.name"
        class="bg-transparent hover:bg-white hover:bg-opacity-10 p-2 cursor-pointer"
        :class="{
          'bg-white bg-opacity-30 hover:bg-white': tool.name == selectedTool,
        }"
        :tabindex="0"
        @click="selectTool(i)"
        @keypress.enter="selectTool(i)"
        @keypress.space="selectTool(i)"
      >
        <BasicIcon :icon="tool.icon" />
      </div>
    </div>
  </div>
</template>
