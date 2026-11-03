<template>
  <div
    ref="containerRef"
    class="relative w-full h-full overflow-hidden select-none bg-studio-950 flex flex-col items-center justify-center rounded-xl"
  >
    <!-- 顶部控制条：模式切换 (滑动卷帘 / 左右并排) + 快捷操作 -->
    <div class="absolute top-3 z-30 flex items-center justify-between px-4 w-full pointer-events-none">
      <!-- 模式切换开关 -->
      <div class="flex items-center space-x-1 p-1 bg-studio-900/90 backdrop-blur-md border border-studio-750 rounded-xl pointer-events-auto shadow-xl">
        <button
          @click="compareMode = 'slider'"
          :class="[
            'px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer',
            compareMode === 'slider'
              ? 'bg-gradient-to-r from-studio-accent to-studio-cyan text-white shadow'
              : 'text-slate-300 hover:text-white hover:bg-studio-800'
          ]"
        >
          <span>↔</span>
          <span>滑动卷帘对比</span>
        </button>
        <button
          @click="compareMode = 'side-by-side'"
          :class="[
            'px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer',
            compareMode === 'side-by-side'
              ? 'bg-gradient-to-r from-studio-accent to-studio-cyan text-white shadow'
              : 'text-slate-300 hover:text-white hover:bg-studio-800'
          ]"
        >
          <span>◫</span>
          <span>左右并排对比</span>
        </button>
      </div>

      <!-- 右上角辅助按钮 -->
      <div class="flex items-center space-x-2 pointer-events-auto">
        <button
          v-if="canApplyAsBase"
          @click="$emit('apply-as-base', afterImage)"
          class="px-3 py-1.5 rounded-lg bg-studio-850 hover:bg-studio-800 border border-studio-700 text-studio-cyan hover:text-white text-xs font-bold shadow-md cursor-pointer flex items-center space-x-1"
          title="将改后图作为新的底图继续编辑"
        >
          <span>📥</span>
          <span>设为新底图</span>
        </button>
        <button
          @click="$emit('close')"
          class="p-1.5 rounded-lg bg-studio-900/80 hover:bg-studio-800 border border-studio-700 text-slate-300 hover:text-white text-xs shadow-md cursor-pointer"
          title="关闭对比视图"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- 模式 A：滑动卷帘同轴对比 (CSS clip-path 完美对齐，鼠标百分百绑定) -->
    <div
      v-if="compareMode === 'slider'"
      ref="sliderViewportRef"
      class="relative w-full h-full flex items-center justify-center overflow-hidden cursor-ew-resize"
      @mousedown="onSliderMouseDown"
      @touchstart="onSliderTouchStart"
    >
      <!-- 底层：AI 生成/重绘后新图 (After) -->
      <img
        :src="afterImage"
        class="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
        alt="After (处理后)"
      />

      <!-- 顶层：处理前原始图 (Before) - 使用绝对 clip-path，像素级同轴严丝合缝 -->
      <img
        :src="beforeImage"
        class="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
        :style="{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }"
        alt="Before (原始图)"
      />

      <!-- 中间分割滑动线条与居中拖动手柄 -->
      <div
        class="absolute top-0 bottom-0 w-0.5 bg-studio-cyan pointer-events-none z-20 flex items-center justify-center shadow-[0_0_10px_rgba(6,182,212,0.85)]"
        :style="{ left: `${sliderPosition}%` }"
      >
        <div class="w-8 h-8 rounded-full bg-studio-900/95 border-2 border-studio-cyan text-cyan-300 flex items-center justify-center shadow-2xl text-xs font-black">
          <span>↔</span>
        </div>
      </div>

      <!-- 左右对比浮层标签 -->
      <div class="on-media absolute bottom-5 left-5 z-20 px-3 py-1 rounded-lg bg-black/80 backdrop-blur-md text-[11px] text-white font-mono font-bold border border-white/20 pointer-events-none shadow-lg">
        左侧：原始图 (Before)
      </div>
      <div class="absolute bottom-5 right-5 z-20 px-3 py-1 rounded-lg bg-studio-accent/90 backdrop-blur-md text-[11px] text-white font-mono font-bold border border-white/30 pointer-events-none shadow-lg">
        右侧：AI生成/重绘后 (After)
      </div>
    </div>

    <!-- 模式 B：左右并排双图对比 (清晰独立视图，左图原图、右图改后图) -->
    <div
      v-else
      class="w-full h-full p-4 pt-16 flex items-center justify-center gap-4 overflow-hidden"
    >
      <!-- 左图：原图 (Before) -->
      <div class="flex-1 h-full flex flex-col bg-studio-900/60 rounded-xl border border-studio-800 overflow-hidden relative shadow-inner">
        <div class="on-media absolute top-3 left-3 z-10 px-3 py-1 rounded-lg bg-black/80 backdrop-blur-md text-xs text-white font-mono font-bold border border-white/20 shadow">
          原始图 (Before)
        </div>
        <div class="w-full h-full flex items-center justify-center p-2">
          <img
            :src="beforeImage"
            class="max-w-full max-h-full object-contain select-none"
            alt="Before"
          />
        </div>
      </div>

      <!-- 右图：改后图 (After) -->
      <div class="flex-1 h-full flex flex-col bg-studio-900/60 rounded-xl border border-studio-800 overflow-hidden relative shadow-inner">
        <div class="absolute top-3 left-3 z-10 px-3 py-1 rounded-lg bg-studio-accent/90 backdrop-blur-md text-xs text-white font-mono font-bold border border-white/30 shadow">
          ✨ AI生成/重绘后 (After)
        </div>
        <div class="w-full h-full flex items-center justify-center p-2">
          <img
            :src="afterImage"
            class="max-w-full max-h-full object-contain select-none"
            alt="After"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  beforeImage: { type: String, required: true },
  afterImage: { type: String, required: true },
  canApplyAsBase: { type: Boolean, default: true }
});

defineEmits(['close', 'apply-as-base']);

const compareMode = ref('slider'); // 'slider' | 'side-by-side'
const sliderPosition = ref(50);
const isDragging = ref(false);
const containerRef = ref(null);
const sliderViewportRef = ref(null);

function updatePosition(clientX) {
  const el = sliderViewportRef.value || containerRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return;
  const x = clientX - rect.left;
  const percent = Math.min(Math.max((x / rect.width) * 100, 1), 99);
  sliderPosition.value = Math.round(percent * 10) / 10;
}

function onMouseMove(e) {
  if (!isDragging.value) return;
  updatePosition(e.clientX);
}

function onTouchMove(e) {
  if (!isDragging.value || !e.touches || !e.touches[0]) return;
  updatePosition(e.touches[0].clientX);
}

function stopDrag() {
  if (!isDragging.value) return;
  isDragging.value = false;
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', stopDrag);
  window.removeEventListener('touchmove', onTouchMove);
  window.removeEventListener('touchend', stopDrag);
}

function startDrag(clientX) {
  isDragging.value = true;
  updatePosition(clientX);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', stopDrag);
  window.addEventListener('touchmove', onTouchMove);
  window.addEventListener('touchend', stopDrag);
}

function onSliderMouseDown(e) {
  if (e.button !== 0) return; // 仅左键
  startDrag(e.clientX);
}

function onSliderTouchStart(e) {
  if (!e.touches || !e.touches[0]) return;
  startDrag(e.touches[0].clientX);
}

onUnmounted(() => {
  stopDrag();
});
</script>
