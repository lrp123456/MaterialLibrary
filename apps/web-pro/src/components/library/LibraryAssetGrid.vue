<template>
  <div class="asset-grid-container flex-1 overflow-y-auto p-4 scrollbar-thin">
    <div v-if="loading && (!items || !items.length)" class="h-64 flex items-center justify-center text-slate-500 font-mono text-xs">
      正在载入素材库列表…
    </div>

    <div v-else-if="!items || !items.length" class="h-64 flex flex-col items-center justify-center text-slate-500 space-y-2">
      <StudioIcon name="folder" :size="32" class="text-studio-700" />
      <p class="text-xs font-mono">当前泳道暂无素材，点击右上角吸收或同步素材</p>
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
      <div
        v-for="item in items"
        :key="item.id || item.fid"
        class="group relative rounded-xl overflow-hidden bg-studio-900 border border-studio-800 hover:border-studio-accent transition-all cursor-pointer aspect-square flex flex-col"
        :class="{ 'ring-2 ring-studio-accent': selectedIds && selectedIds.has(item.id) }"
        @click="$emit('select-item', item)"
      >
        <div class="flex-1 bg-studio-950 overflow-hidden relative">
          <img
            v-if="item.thumbnail_url || item.preview_url"
            :src="item.thumbnail_url || item.preview_url"
            :alt="item.file_name"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
          <div v-else class="w-full h-full flex items-center justify-center text-slate-600 text-xs font-mono">
            {{ item.media_type || 'asset' }}
          </div>
        </div>

        <div class="p-1.5 bg-studio-900 border-t border-studio-800/60 flex items-center justify-between text-[11px] text-slate-300">
          <span class="truncate font-mono">{{ item.file_name || item.name || item.fid }}</span>
          <span v-if="item.origin" class="text-[9px] px-1 rounded bg-studio-800 text-slate-400 font-mono">
            {{ item.origin }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  items: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  selectedIds: { type: Object, default: () => new Set() },
});

defineEmits(['select-item']);
</script>
