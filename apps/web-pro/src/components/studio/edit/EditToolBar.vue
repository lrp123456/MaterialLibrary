<template>
  <div class="edit-toolbar h-14 px-5 border-b border-studio-800 bg-studio-900/90 backdrop-blur-md flex items-center justify-between shrink-0 font-sans">
    <div class="flex items-center gap-3">
      <h3 class="text-sm font-bold text-white font-mono flex items-center gap-2">
        <StudioIcon name="sliders" :size="16" class="text-studio-accent" />
        <span>精准图像编辑工作台</span>
      </h3>

      <div class="flex items-center gap-1 bg-studio-950 p-1 rounded-xl border border-studio-800">
        <button
          v-for="t in tools"
          :key="t.key"
          type="button"
          class="px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer flex items-center gap-1.5"
          :class="activeTool === t.key ? 'bg-studio-accent text-white font-bold shadow' : 'text-slate-400 hover:text-white'"
          @click="$emit('select-tool', t.key)"
        >
          <StudioIcon :name="t.icon" :size="13" />
          <span>{{ t.label }}</span>
        </button>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <button
        type="button"
        class="px-3 py-1.5 rounded-xl bg-studio-800 hover:bg-studio-750 border border-studio-700 text-slate-300 text-xs font-mono transition-all cursor-pointer"
        @click="$emit('reset')"
      >
        重置选区
      </button>

      <button
        type="button"
        class="px-4 py-1.5 rounded-xl bg-studio-accent text-white text-xs font-bold font-mono hover:brightness-110 active:scale-95 transition-all shadow cursor-pointer flex items-center gap-1.5"
        @click="$emit('apply')"
      >
        <StudioIcon name="check" :size="14" />
        <span>完成应用</span>
      </button>

      <button
        type="button"
        class="w-8 h-8 rounded-xl bg-studio-800 hover:bg-studio-750 text-slate-400 hover:text-white flex items-center justify-center text-sm font-bold cursor-pointer"
        @click="$emit('close')"
      >
        &times;
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  activeTool: { type: String, default: 'crop' },
});

defineEmits(['select-tool', 'reset', 'apply', 'close']);

const tools = [
  { key: 'crop', label: '裁切', icon: 'maximize' },
  { key: 'brush', label: '涂抹', icon: 'brush' },
  { key: 'bbox', label: '矩形框', icon: 'maximize' },
  { key: 'polygon', label: '多边形', icon: 'zap' },
];
</script>
