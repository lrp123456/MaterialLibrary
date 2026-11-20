<template>
  <header class="library-header-bar h-14 px-5 border-b border-studio-800 bg-studio-900/70 backdrop-blur-md flex items-center justify-between shrink-0">
    <div class="flex items-center gap-4">
      <h2 class="text-sm font-bold tracking-wide uppercase font-mono flex items-center gap-2 text-white">
        <StudioIcon name="folder" :size="16" class="text-studio-accent" />
        <span>数字资产库 (DAM)</span>
      </h2>

      <!-- 泳道切换按钮 -->
      <div class="flex items-center gap-1 bg-studio-950 p-1 rounded-xl border border-studio-800">
        <button
          v-for="l in lanes"
          :key="l.key"
          type="button"
          class="px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer"
          :class="currentLane === l.key ? 'bg-studio-accent text-white font-bold shadow' : 'text-slate-400 hover:text-white'"
          @click="$emit('update:lane', l.key)"
        >
          {{ l.label }}
        </button>
      </div>
    </div>

    <!-- 搜索与操作按钮 -->
    <div class="flex items-center gap-3">
      <div class="relative w-56">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索素材标题、标签或颜色…"
          class="w-full bg-studio-950 border border-studio-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-studio-accent transition-colors"
          @keydown.enter="$emit('search', searchQuery)"
        />
      </div>

      <button
        type="button"
        class="px-3 py-1.5 rounded-xl bg-studio-800 hover:bg-studio-750 border border-studio-700 text-slate-200 text-xs font-mono font-bold transition-all cursor-pointer"
        @click="$emit('open-base-library')"
      >
        空间基底库
      </button>

      <button
        type="button"
        class="px-3.5 py-1.5 rounded-xl bg-studio-accent text-white text-xs font-mono font-bold hover:brightness-110 active:scale-95 transition-all shadow cursor-pointer flex items-center gap-1.5"
        @click="$emit('open-ingest')"
      >
        <StudioIcon name="upload" :size="14" />
        <span>吸收素材</span>
      </button>
    </div>
  </header>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  currentLane: { type: String, default: 'image' },
  initialQuery: { type: String, default: '' },
});

const emit = defineEmits(['update:lane', 'search', 'open-base-library', 'open-ingest']);

const lanes = [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'model3d', label: '3D 单品' },
];

const searchQuery = ref(props.initialQuery);
watch(() => props.initialQuery, (v) => { searchQuery.value = v; });
</script>
