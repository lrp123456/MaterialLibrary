<template>
  <div v-if="visible" class="studio-global-drawer-root fixed inset-0 z-50 bg-studio-950/80 backdrop-blur-sm flex justify-end font-sans">
    <aside class="w-[480px] h-full bg-studio-900 border-l border-studio-800 shadow-2xl flex flex-col">
      <!-- 抽屉头部 -->
      <header class="h-14 px-5 border-b border-studio-800 flex items-center justify-between shrink-0">
        <h3 class="text-sm font-bold text-white font-mono flex items-center gap-2">
          <StudioIcon name="history" :size="16" class="text-studio-accent" />
          <span>创作工坊历史与全景中枢</span>
        </h3>
        <button type="button" class="w-7 h-7 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer" @click="$emit('close')">
          &times;
        </button>
      </header>

      <!-- 标签导航 -->
      <div class="px-5 py-2.5 border-b border-studio-800 bg-studio-950 flex gap-2">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="px-3 py-1 rounded-lg text-xs font-mono border transition-all cursor-pointer"
          :class="activeTab === t.key ? 'bg-studio-accent text-white border-studio-accent font-bold' : 'bg-studio-900 text-slate-400 border-studio-800 hover:text-white'"
          @click="activeTab = t.key"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- 抽屉内容 -->
      <main class="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
        <div v-if="activeTab === 'history'" class="space-y-3">
          <div class="text-xs text-slate-400 font-mono">最近创作生成记录 (按时间倒序)</div>
          <div class="p-4 rounded-xl bg-studio-950 border border-studio-800 text-xs text-slate-400 text-center font-mono py-8">
            历史会话快照已由 Pinia useStudioSessionStore 集中同步
          </div>
        </div>

        <div v-else-if="activeTab === 'presets'" class="space-y-3">
          <div class="text-xs text-slate-400 font-mono">空间模板与镜头配方</div>
          <div class="p-4 rounded-xl bg-studio-950 border border-studio-800 text-xs text-slate-400 text-center font-mono py-8">
            内置 24 套空间写实与影视光影预设
          </div>
        </div>
      </main>
    </aside>
  </div>
</template>

<script setup>
import { ref } from 'vue';

defineProps({
  visible: { type: Boolean, default: false },
});

defineEmits(['close']);

const activeTab = ref('history');
const tabs = [
  { key: 'history', label: '生成历史' },
  { key: 'presets', label: '空间预设' },
];
</script>
