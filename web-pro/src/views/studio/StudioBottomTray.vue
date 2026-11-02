<template>
  <!-- 纵向模式：作为看图区右侧的窄长槽位 (展开状态) -->
  <div
    v-if="mode === 'vertical'"
    class="studio-tray-vertical relative w-[76px] shrink-0 h-full bg-studio-900 border-l border-studio-700 py-3 px-2 flex flex-col items-center select-none overflow-y-auto scrollbar-thin transition-colors"
    :class="{ 'ring-2 ring-studio-accent bg-studio-800/80': isDragging }"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDropFiles"
  >
    <!-- 拖拽提示遮罩 -->
    <div
      v-if="isDragging"
      class="absolute inset-0 z-20 bg-studio-accent/20 backdrop-blur-xs flex flex-col items-center justify-center p-2 text-center pointer-events-none"
    >
      <StudioIcon name="wand" :size="20" class="text-white animate-bounce mb-1" />
      <span class="text-[10px] font-bold text-white leading-tight">松手挂载</span>
    </div>

    <div class="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider font-mono">
      参考 ({{ images.length }})
    </div>

    <div class="flex flex-col items-center gap-2.5 w-full">
      <!-- 已挂载图片缩略索引格 -->
      <div
        v-for="(item, idx) in images"
        :key="item.url || item.fid || idx"
        @click="$emit('select', idx)"
        :class="[
          'group relative flex flex-col items-center justify-between w-[58px] h-[64px] rounded-xl border p-1 transition-all cursor-pointer bg-studio-850 shrink-0',
          selectedIndex === idx
            ? 'border-studio-accent shadow-sm shadow-studio-accent/20 ring-1 ring-studio-accent'
            : 'border-studio-700 hover:border-studio-600 hover:bg-studio-800'
        ]"
        :title="`${item.name || '参考图'} (图${idx + 1})`"
      >
        <div class="w-full flex-1 flex items-center justify-center overflow-hidden rounded-lg bg-studio-950">
          <img
            :src="item.thumbUrl || item.url || item.imgUrl"
            class="max-w-full max-h-full object-contain"
            :alt="`图${idx + 1}`"
          />
        </div>
        <div class="mt-1 flex items-center justify-center">
          <span class="px-1.5 py-0.2 rounded bg-studio-cyan/15 text-studio-cyan font-mono text-[10px] font-bold leading-tight">
            图{{ idx + 1 }}
          </span>
        </div>
      </div>

      <!-- 末尾虚线「添加」素材卡片：直接点击呼出素材选择器 -->
      <button
        type="button"
        @click="$emit('open-picker')"
        class="w-[58px] h-[64px] rounded-xl border-2 border-dashed border-studio-700 hover:border-studio-accent hover:bg-studio-800/60 transition-all flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-white cursor-pointer group shrink-0"
        title="添加参考图（支持点击打开选择器或直接拖拽图片）"
      >
        <StudioIcon name="plus" :size="16" customClass="group-hover:text-studio-accent transition-colors" />
        <span class="text-[10px] font-bold">添加</span>
      </button>
    </div>
  </div>

  <!-- 横向模式：看图区收缩时贴底停留在输入框正上方作为紧凑条 -->
  <div
    v-else
    class="studio-tray-horizontal relative h-[56px] w-full bg-studio-900/95 backdrop-blur border-t border-studio-700/80 px-4 flex items-center shrink-0 select-none overflow-x-auto scrollbar-thin transition-colors"
    :class="{ 'ring-2 ring-studio-accent bg-studio-800/80': isDragging }"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDropFiles"
  >
    <!-- 拖拽高亮提示 -->
    <div
      v-if="isDragging"
      class="absolute inset-0 z-20 bg-studio-accent/20 backdrop-blur-xs flex items-center justify-center text-white text-xs font-bold pointer-events-none"
    >
      松手立即挂载参考图
    </div>

    <div class="flex items-center gap-2.5">
      <div class="text-[11px] font-mono text-slate-400 font-bold mr-1 shrink-0 flex items-center gap-1">
        <span>参考图</span>
        <span class="text-studio-cyan">({{ images.length }})</span>
      </div>

      <div
        v-for="(item, idx) in images"
        :key="item.url || item.fid || idx"
        @click="$emit('select', idx)"
        :class="[
          'group relative flex items-center gap-2 h-9 px-2 rounded-lg border transition-all cursor-pointer bg-studio-850 shrink-0',
          selectedIndex === idx
            ? 'border-studio-accent shadow-sm shadow-studio-accent/20 ring-1 ring-studio-accent'
            : 'border-studio-700 hover:border-studio-600 hover:bg-studio-800'
        ]"
        :title="`${item.name || '参考图'} (图${idx + 1}) - 点击展开看图区`"
      >
        <div class="w-6 h-6 rounded overflow-hidden bg-studio-950 flex items-center justify-center shrink-0">
          <img
            :src="item.thumbUrl || item.url || item.imgUrl"
            class="max-w-full max-h-full object-contain"
            :alt="`图${idx + 1}`"
          />
        </div>
        <span class="px-1 py-0.2 rounded bg-studio-cyan/15 text-studio-cyan font-mono text-[10px] font-bold leading-tight">
          图{{ idx + 1 }}
        </span>
      </div>

      <button
        type="button"
        @click="$emit('open-picker')"
        class="h-9 px-2.5 rounded-lg border border-dashed border-studio-700 hover:border-studio-accent hover:bg-studio-800/60 transition-all flex items-center gap-1.5 text-slate-400 hover:text-white cursor-pointer group shrink-0 text-xs font-bold"
        title="添加参考图"
      >
        <StudioIcon name="plus" :size="13" customClass="group-hover:text-studio-accent transition-colors" />
        <span>添加</span>
      </button>

      <!-- 快捷展开看图区提示/按钮 -->
      <button
        type="button"
        @click="$emit('expand-viewer')"
        class="ml-auto text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-studio-800 transition-colors cursor-pointer"
        title="展开看图区"
      >
        <StudioIcon name="maximize" :size="12" />
        <span>展开画板</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import StudioIcon from '../../components/StudioIcon.vue';

defineProps({
  images: { type: Array, default: () => [] },
  selectedIndex: { type: Number, default: 0 },
  mode: { type: String, default: 'vertical' }, // 'vertical' | 'horizontal'
});

const emit = defineEmits(['select', 'open-picker', 'expand-viewer', 'upload-files']);

const isDragging = ref(false);

function onDropFiles(e) {
  isDragging.value = false;
  const files = e.dataTransfer?.files;
  if (files && files.length) {
    emit('upload-files', Array.from(files));
  }
}
</script>
