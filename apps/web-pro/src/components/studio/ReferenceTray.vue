<template>
  <div v-if="items && items.length" class="reference-tray px-4 py-2 border-t border-studio-800 bg-studio-900/60 backdrop-blur-sm flex items-center gap-3 overflow-x-auto">
    <div class="text-[11px] font-mono text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1.5">
      <StudioIcon name="image" :size="14" class="text-studio-accent" />
      <span>引用素材 ({{ items.length }})</span>
    </div>
    <div class="flex items-center gap-2">
      <div
        v-for="(item, idx) in items"
        :key="item.id || idx"
        class="relative group w-14 h-14 rounded-lg overflow-hidden border border-studio-700 bg-studio-950 flex items-center justify-center shrink-0"
        :class="{ 'border-red-500 ring-1 ring-red-500': item.valid === false }"
      >
        <img
          v-if="item.previewUrl"
          :src="item.previewUrl"
          :alt="item.name"
          class="w-full h-full object-cover"
        />
        <div v-else class="text-[10px] text-slate-500 text-center px-1 truncate">
          {{ item.name }}
        </div>

        <div v-if="item.valid === false" class="absolute inset-0 bg-red-950/60 flex items-center justify-center text-[9px] text-red-300 font-bold">
          失效
        </div>

        <button
          type="button"
          class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-studio-950/80 text-slate-300 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          @click.stop="$emit('remove', item.id)"
        >
          &times;
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  items: {
    type: Array,
    default: () => [],
  },
});

defineEmits(['remove']);
</script>
