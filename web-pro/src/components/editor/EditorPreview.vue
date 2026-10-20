<template>
  <main class="flex-1 flex flex-col bg-studio-950 p-3 relative overflow-hidden min-w-0">
    <div class="flex-1 flex items-center justify-center relative overflow-hidden min-h-0">
      <div
        class="relative rounded-xl overflow-hidden shadow-2xl border border-studio-750 bg-black flex items-center justify-center"
        :style="viewportStyle"
      >
        <canvas ref="canvasRef" class="w-full h-full block" />
        <canvas
          ref="overlayRef"
          class="absolute inset-0 w-full h-full"
          :class="state.maskEditMode ? 'cursor-crosshair' : 'pointer-events-none'"
          :style="{ opacity: state.maskEditMode ? 1 : 0 }"
          @pointerdown="onOverlayPointerDown"
          @pointermove="onOverlayPointerMove"
          @pointerup="onOverlayPointerUp"
          @pointerleave="onOverlayPointerUp"
        />
        <div v-if="!state.project?.scenes?.length" class="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
          没有场景
        </div>
      </div>
    </div>

    <div v-if="state.missingClipIds.length" class="mt-2 text-[11px] px-3 py-1.5 rounded-lg border border-studio-750 bg-studio-900 text-slate-300 flex items-center gap-2 shrink-0">
      <span class="text-amber-400 font-bold">缺片源</span>
      <span>{{ state.missingClipIds.length }} 个片段没有真实片源，预览中对应层为空（不会用示例片顶替）。</span>
    </div>

    <!-- 播放控制条 -->
    <div class="h-11 bg-studio-900 rounded-xl border border-studio-750 px-3 flex items-center justify-between shrink-0 shadow-lg mt-2">
      <div class="flex items-center space-x-1 text-slate-400">
        <button @click="stepFrame(-1)" class="editor-icon-btn" title="上一帧 (←)">⏮</button>
        <button @click="seek(state.currentTime - 2)" class="editor-icon-btn" title="快退 2 秒">⏪</button>
      </div>
      <div class="flex items-center space-x-3">
        <button
          @click="togglePlay"
          class="w-9 h-9 rounded-full bg-studio-accent hover:brightness-110 text-white flex items-center justify-center shadow-md transition-transform active:scale-95 cursor-pointer"
          :title="state.playing ? '暂停 (Space)' : '播放 (Space)'"
        >
          <StudioIcon :name="state.playing ? 'pause' : 'play'" :size="16" />
        </button>
        <div class="font-mono text-xs text-studio-cyan font-bold tracking-wider min-w-[170px] text-center">
          {{ formatTimecode(state.currentTime, state.project?.fps || 30) }}
          <span class="text-slate-500">/</span>
          {{ formatTimecode(duration, state.project?.fps || 30) }}
        </div>
      </div>
      <div class="flex items-center space-x-2 text-slate-400">
        <button @click="seek(state.currentTime + 2)" class="editor-icon-btn" title="快进 2 秒">⏩</button>
        <button @click="stepFrame(1)" class="editor-icon-btn" title="下一帧 (→)">⏭</button>
        <button
          @click="toggleSnapping"
          class="ml-2 px-2 py-1 rounded-lg text-[11px] border cursor-pointer"
          :class="state.snapping ? 'bg-studio-accent/20 border-studio-accent text-white' : 'border-studio-750 text-slate-400'"
          title="磁吸开关 (N)"
        >
          磁吸 {{ state.snapping ? '开' : '关' }}
        </button>
      </div>
    </div>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import StudioIcon from '../StudioIcon.vue';
import {
  attachCanvas, attachOverlayCanvas, detachCanvas, duration, redo, scene, seek, state,
  stepFrame, togglePlay, undo, drawMaskOverlay, selectedClip, selectedMask,
  addMaskPoint, moveMaskPoint, requestPreviewRender,
} from '../../editor/store.js';
import { formatTimecode, clamp } from '../../editor/model.js';
import { computeElementBox } from '../../editor/compositor.js';

const canvasRef = ref(null);
const overlayRef = ref(null);
const dragPoint = ref(null);

const viewportStyle = computed(() => {
  const c = state.project?.canvas || { width: 1280, height: 720 };
  const ratio = c.width / c.height;
  return {
    aspectRatio: `${c.width} / ${c.height}`,
    width: ratio >= 1 ? 'min(100%, 760px)' : `min(56vh, ${Math.round(56 * ratio)}vh)`,
    maxHeight: '100%',
  };
});

function onOverlayPointerDown(e) {
  if (!state.maskEditMode || !selectedMask.value || selectedMask.value.type !== 'path') return;
  const canvas = overlayRef.value;
  const rect = canvas.getBoundingClientRect();
  const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
  const local = canvasToLocal(cx, cy);
  if (!local) return;
  const mask = selectedMask.value;
  const pts = mask.points || [];
  const hitRadius = 14;
  const hit = pts.findIndex((p) => {
    const px = p.x * local.box.w;
    const py = p.y * local.box.h;
    return Math.hypot(px - local.x, py - local.y) <= hitRadius;
  });
  if (hit >= 0) {
    dragPoint.value = hit;
  } else {
    addMaskPoint(local.x / local.box.w, local.y / local.box.h);
  }
}

function onOverlayPointerMove(e) {
  if (dragPoint.value == null) return;
  const canvas = overlayRef.value;
  const rect = canvas.getBoundingClientRect();
  const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
  const local = canvasToLocal(cx, cy);
  if (!local) return;
  moveMaskPoint(dragPoint.value, local.x / local.box.w, local.y / local.box.h);
}

function onOverlayPointerUp() {
  dragPoint.value = null;
}

function canvasToLocal(cx, cy) {
  const clip = selectedClip.value;
  if (!clip || !state.project) return null;
  const box = computeElementBox(state.project, clip, state.currentTime);
  const rad = (-box.rotation * Math.PI) / 180;
  const dx = cx - box.cx;
  const dy = cy - box.cy;
  const x = dx * Math.cos(rad) - dy * Math.sin(rad) + box.w / 2;
  const y = dx * Math.sin(rad) + dy * Math.cos(rad) + box.h / 2;
  return { x: clamp(x, 0, box.w), y: clamp(y, 0, box.h), box };
}

function toggleSnapping() {
  state.snapping = !state.snapping;
}

onMounted(() => {
  attachCanvas(canvasRef.value);
  attachOverlayCanvas(overlayRef.value);
  requestPreviewRender();
});

onBeforeUnmount(() => {
  detachCanvas(canvasRef.value);
  attachOverlayCanvas(null);
});
</script>

<style scoped>
.editor-icon-btn {
  padding: 6px;
  border-radius: 8px;
  cursor: pointer;
}
.editor-icon-btn:hover {
  background: var(--theme-bg-hover);
  color: var(--theme-text-primary);
}
</style>
