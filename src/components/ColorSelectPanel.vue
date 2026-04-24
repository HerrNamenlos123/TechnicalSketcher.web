<script setup lang="ts">
const colors = [
  "#000000", // Jet Black
  "#1D4ED8", // Royal Blue
  "#DC2626", // Crimson Red
  "#16A34A", // Emerald Green
  "#CA8A04", // Goldenrod
  // "#9333EA", // Vivid Violet (Original)
  "#7E34D9", // New Violet #1
  // "#F97316", // Bright Orange (Original)
  // "#EA580C", // Less aggressive orange
  // "#C2410C", // Burnt Orange
  // "#D97706", // Amber Orange
  // "#FB8C00", // New Orange #1
  "#F57C00", // New Orange #2
  "#6B7280", // Slate Gray
];

const emit = defineEmits<{
  selectColor: [color: string];
}>();
</script>

<template>
  <div id="penColor" class="flex bg-white p-2 gap-2 w-fit rounded-md border border-black">
    <div
      v-for="color in colors"
      :key="color"
      class="cursor-pointer"
      @click.stop.prevent="
        () => {
          emit('selectColor', color);
        }
      "
      @pointercancel.stop.prevent
      @pointerdown.stop.prevent
      @pointerleave.stop.prevent
      @pointermove.stop.prevent
      @pointerup.stop.prevent
    >
      <div
        class="rounded-full w-5 h-5"
        :style="{
          backgroundColor: color,
        }"
      />
    </div>
  </div>
</template>
