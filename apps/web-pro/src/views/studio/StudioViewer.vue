<template>
  <div v-if="visible" class="studio-viewer-root fixed inset-0 z-50 bg-studio-950/90 backdrop-blur-md flex flex-col font-sans select-none">
    <!-- 头部栏 -->
    <header class="h-14 px-6 border-b border-studio-800 bg-studio-900/60 flex items-center justify-between shrink-0">
      <div class="flex items-center gap-3">
        <h3 class="text-sm font-bold text-white font-mono flex items-center gap-2">
          <StudioIcon name="eye" :size="16" class="text-studio-accent" />
          <span>媒体全屏沉浸预览</span>
        </h3>
        <span v-if="item?.prompt" class="text-xs text-slate-400 font-mono truncate max-w-md">
          {{ item.prompt }}
        </span>
      </div>

      <div class="flex items-center gap-3">
        <button
          type="button"
          class="px-3 py-1.5 rounded-xl bg-studio-800 hover:bg-studio-750 border border-studio-700 text-slate-300 text-xs font-mono transition-all"
          @click="zoom = Math.min(3, zoom + 0.2)"
        >
          放大
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-xl bg-studio-800 hover:bg-studio-750 border border-studio-700 text-slate-300 text-xs font-mono transition-all"
          @click="zoom = Math.max(0.5, zoom - 0.2)"
        >
          缩小
        </button>
        <button
          type="button"
          class="w-8 h-8 rounded-xl bg-studio-800 hover:bg-studio-750 text-slate-300 hover:text-white flex items-center justify-center font-bold text-sm cursor-pointer"
          @click="$emit('close')"
        >
          &times;
        </button>
      </div>
    </header>

    <!-- 主展示区 -->
    <main class="flex-1 flex items-center justify-center p-8 overflow-hidden relative">
      <video
        v-if="item?.videoUrl"
        :src="item.videoUrl"
        controls
        autoplay
        class="max-h-[80vh] max-w-[85vw] object-contain rounded-2xl shadow-2xl border border-studio-800"
      />
      <img
        v-else-if="item?.mediaUrl"
        :src="item.mediaUrl"
        :alt="item.prompt || 'Preview'"
        class="max-h-[80vh] max-w-[85vw] object-contain rounded-2xl shadow-2xl border border-studio-800 transition-transform duration-200"
        :style="{ transform: `scale(${zoom})` }"
      />
      <div v-else class="text-xs text-slate-500 font-mono">
        暂无媒体资源数据
      </div>
    </main>

    <!-- 底部状态栏 -->
    <footer class="h-10 px-6 border-t border-studio-800 bg-studio-900/60 flex items-center justify-between text-xs text-slate-400 font-mono">
      <span>缩放: {{ (zoom * 100).toFixed(0) }}%</span>
      <span>按下 ESC 或点击右上角关闭</span>
    </footer>
  </div>
</template>

<script setup>
import { ref } from 'vue';

defineProps({
  visible: { type: Boolean, default: false },
  item: { type: Object, default: () => null },
});

defineEmits(['close']);

const zoom = ref(1.0);
</script>
