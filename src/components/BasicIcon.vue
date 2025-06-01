<script setup lang="ts">
import * as icons from "@phosphor-icons/vue";
import type { Component } from "vue";

const props = defineProps<{
  icon: string;
}>();

const IconComponent =
  (icons as Record<string, Component>)[props.icon] || icons.PhQuestion; // Fallback to a default icon if not found
</script>

<template>
  <component :is="IconComponent" />
</template>
