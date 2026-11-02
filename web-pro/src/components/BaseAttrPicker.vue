<template>
  <ResurfaceDrawer
    :guide="resolvedGuide"
    :surface="surface"
    :subclass="subclass"
    :inferred-prob="inferredProb"
    @surface="$emit('surface', $event)"
    @subclass="$emit('subclass', $event)"
    @material="$emit('material', $event)"
    @color="$emit('color', $event)"
    @finish="$emit('finish', $event)"
    @roughness="$emit('roughness', $event)"
    @aging="$emit('aging', $event)"
    @change="onChange"
    @update:guide="onUpdateGuide"
  />
</template>

<script setup>
import { computed } from 'vue';
import ResurfaceDrawer from './studio/ResurfaceDrawer.vue';

const props = defineProps({
  modelValue: {
    type: Object,
    default: null
  },
  guide: {
    type: Object,
    default: () => ({})
  },
  surface: {
    type: String,
    default: 'wall'
  },
  subclass: {
    type: String,
    default: ''
  },
  inferredProb: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits([
  'update:modelValue',
  'surface',
  'subclass',
  'material',
  'color',
  'finish',
  'roughness',
  'aging',
  'change',
  'update:guide'
]);

const resolvedGuide = computed(() => props.modelValue || props.guide || {});

function onChange(payload) {
  emit('change', payload);
  emit('update:modelValue', payload);
}

function onUpdateGuide(payload) {
  emit('update:guide', payload);
  emit('update:modelValue', payload);
}
</script>
