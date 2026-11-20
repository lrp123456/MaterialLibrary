<template>
  <div class="canvas-viewport flex-1 flex items-center justify-center p-6 bg-studio-950 overflow-hidden relative select-none">
    <div class="canvas-wrapper relative border border-studio-800 rounded-xl overflow-hidden shadow-2xl bg-studio-900/50">
      <img
        v-if="imageUrl"
        ref="imageRef"
        :src="imageUrl"
        alt="Edit Target"
        class="max-h-[75vh] max-w-[80vw] object-contain pointer-events-none"
        @load="onImageLoad"
      />
      <div v-else class="w-96 h-96 flex items-center justify-center text-slate-500 font-mono text-xs">
        请选择或上传待编辑图片
      </div>

      <!-- 交互层画布 -->
      <canvas
        ref="canvasRef"
        class="absolute inset-0 w-full h-full cursor-crosshair"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
      />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useCanvasInteractionStore } from '../../../stores/canvasInteraction.js';

const props = defineProps({
  imageUrl: { type: String, default: '' },
  activeTool: { type: String, default: 'crop' },
});

const emit = defineEmits(['geometry-change']);

const canvasStore = useCanvasInteractionStore();
const imageRef = ref(null);
const canvasRef = ref(null);

let startX = 0;
let startY = 0;
let isInteracting = false;

function onImageLoad() {
  if (canvasRef.value && imageRef.value) {
    canvasRef.value.width = imageRef.value.clientWidth;
    canvasRef.value.height = imageRef.value.clientHeight;
  }
}

function handleMouseDown(e) {
  isInteracting = true;
  const rect = canvasRef.value.getBoundingClientRect();
  startX = e.clientX - rect.left;
  startY = e.clientY - rect.top;
}

function handleMouseMove(e) {
  if (!isInteracting || !canvasRef.value) return;
  const rect = canvasRef.value.getBoundingClientRect();
  const curX = e.clientX - rect.left;
  const curY = e.clientY - rect.top;

  const ctx = canvasRef.value.getContext('2d');
  ctx.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.strokeRect(startX, startY, curX - startX, curY - startY);
}

function handleMouseUp(e) {
  if (!isInteracting || !canvasRef.value) return;
  isInteracting = false;
  const rect = canvasRef.value.getBoundingClientRect();
  const curX = e.clientX - rect.left;
  const curY = e.clientY - rect.top;

  const w = canvasRef.value.width || 1;
  const h = canvasRef.value.height || 1;

  const normBbox = {
    x: Math.min(startX, curX) / w,
    y: Math.min(startY, curY) / h,
    w: Math.abs(curX - startX) / w,
    h: Math.abs(curY - startY) / h,
  };

  canvasStore.setNormalizedBbox(normBbox);
  emit('geometry-change', normBbox);
}
</script>
