<template>
  <div class="relative w-full h-full overflow-hidden select-none bg-studio-950 flex items-center justify-center">
    <!-- 底层：重绘后/处理后新图 (After) -->
    <img
      :src="afterImage"
      class="absolute inset-0 w-full h-full object-contain pointer-events-none"
      alt="处理后"
    />

    <!-- 顶层：处理前原图 (Before)，通过 clip-path 裁剪 -->
    <div
      class="absolute inset-0 overflow-hidden pointer-events-none"
      :style="{ width: `${sliderPosition}%` }"
    >
      <img
        :src="beforeImage"
        class="absolute top-0 left-0 max-w-none h-full object-contain"
        :style="{ width: `${containerWidth}px` }"
        alt="原始图"
      />
    </div>

    <!-- 中间分割拖动线 -->
    <div
      class="theme-handle absolute top-0 bottom-0 w-0.5 bg-studio-cyan cursor-ew-resize z-20 flex items-center justify-center"
      :style="{ left: `${sliderPosition}%` }"
      @mousedown="startDrag"
      @touchstart="startDrag"
    >
      <div class="w-8 h-8 -ml-0.5 rounded-full bg-studio-900 border-2 border-studio-cyan text-cyan-300 flex items-center justify-center shadow-xl text-xs font-bold">
        <span>↔</span>
      </div>
    </div>

    <!-- 左右对比浮层标签 -->
    <div class="absolute top-4 left-4 z-10 px-3 py-1 rounded-lg bg-black/80 backdrop-blur text-xs text-white font-mono font-bold border border-white/20 pointer-events-none shadow-lg">
      原始图 (Before)
    </div>
    <div class="absolute top-4 right-4 z-10 px-3 py-1 rounded-lg bg-studio-accent/85 backdrop-blur text-xs text-white font-mono font-bold border border-white/30 pointer-events-none shadow-lg">
      AI生成/重绘后 (After)
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  beforeImage: { type: String, required: true },
  afterImage: { type: String, required: true },
});

const sliderPosition = ref(50);
const isDragging = ref(false);
const containerWidth = ref(800);

function onMove(e) {
  if (!isDragging.value) return;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const rect = document.body.getBoundingClientRect();
  const percent = Math.min(Math.max(((clientX - 280) / (window.innerWidth - 600)) * 100, 5), 95);
  sliderPosition.value = percent;
}

function stopDrag() {
  isDragging.value = false;
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', stopDrag);
  window.removeEventListener('touchmove', onMove);
  window.removeEventListener('touchend', stopDrag);
}

function startDrag() {
  isDragging.value = true;
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', stopDrag);
  window.addEventListener('touchmove', onMove);
  window.addEventListener('touchend', stopDrag);
}

onMounted(() => {
  containerWidth.value = window.innerWidth - 600;
});
</script>
