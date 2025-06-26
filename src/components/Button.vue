<script setup lang="ts">
import BasicIcon from "./BasicIcon.vue";

const props = defineProps<{
  text: string;
  icon?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  click: [e: MouseEvent];
}>();
</script>

<template>
  <div
    class="p-1 border rounded-md w-fit h-fit flex items-center gap-2 px-2 text-white border-white select-none"
    :class="{
      'text-opacity-50 border-opacity-50': disabled,
      'cursor-pointer': !disabled,
    }"
    @click="
      (e) => {
        if (!disabled) {
          emit('click', e);
        }
      }
    "
  >
    {{ text }}
    <BasicIcon v-if="icon" :icon="icon" />
  </div>
</template>
