<template>
  <div v-if="visible" class="studio-edit-layer-root fixed inset-0 z-[100] bg-studio-950/95 flex flex-col font-sans">
    <!-- 顶部工具栏 -->
    <EditToolBar
      :activeTool="canvasStore.activeTool"
      @select-tool="canvasStore.setTool"
      @reset="handleReset"
      @apply="handleApply"
      @close="$emit('close')"
    />

    <!-- 画布编辑视口 -->
    <CanvasViewport
      :imageUrl="activeImage"
      :activeTool="canvasStore.activeTool"
      @geometry-change="handleGeometryChange"
    />

    <!-- 底部状态与操作说明 -->
    <footer class="h-10 px-5 border-t border-studio-800 bg-studio-900/60 flex items-center justify-between text-xs text-slate-400 font-mono">
      <span>工具模式: {{ canvasStore.activeTool }}</span>
      <span v-if="currentBbox">
        选区: ({{ (currentBbox.x * 100).toFixed(1) }}%, {{ (currentBbox.y * 100).toFixed(1) }}%)
        大小: {{ (currentBbox.w * 100).toFixed(1) }}% × {{ (currentBbox.h * 100).toFixed(1) }}%
      </span>
      <span v-else>拖拽鼠标绘制选区</span>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useCanvasInteractionStore } from '../../stores/canvasInteraction.js';
import EditToolBar from '../../components/studio/edit/EditToolBar.vue';
import CanvasViewport from '../../components/studio/edit/CanvasViewport.vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  initialImage: { type: String, default: '' },
  assetFid: { type: String, default: '' },
});

const emit = defineEmits(['close', 'saved']);

const canvasStore = useCanvasInteractionStore();
const activeImage = ref(props.initialImage || '');
const currentBbox = computed(() => canvasStore.normalizedBbox);

function handleGeometryChange(bbox) {
  // 更新几何状态
}

function handleReset() {
  canvasStore.resetGeometry();
}

async function handleApply() {
  const bbox = canvasStore.normalizedBbox;
  emit('saved', {
    bbox,
    tool: canvasStore.activeTool,
    image: activeImage.value,
  });
  emit('close');
}
</script>
