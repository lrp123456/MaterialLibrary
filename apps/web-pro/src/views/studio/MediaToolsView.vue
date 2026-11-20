<template>
  <div class="media-tools-view-root h-full flex flex-col bg-studio-950 font-sans">
    <!-- 头部工具标签栏 -->
    <header class="h-14 px-5 border-b border-studio-800 bg-studio-900/60 flex items-center justify-between shrink-0">
      <div class="flex items-center gap-3">
        <h3 class="text-sm font-bold text-white font-mono flex items-center gap-2">
          <StudioIcon name="sliders" :size="16" class="text-studio-accent" />
          <span>多媒体算力与音视频工具箱</span>
        </h3>

        <div class="flex items-center gap-1 bg-studio-950 p-1 rounded-xl border border-studio-800">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            class="px-3 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer"
            :class="activeTab === tab.key ? 'bg-studio-accent text-white font-bold shadow' : 'text-slate-400 hover:text-white'"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
    </header>

    <!-- 工具主面板 -->
    <main class="flex-1 overflow-y-auto scrollbar-thin">
      <MediaConvertTool
        v-if="activeTab === 'convert'"
        @start="handleStartConvert"
      />

      <div v-else-if="activeTab === 'frames'" class="p-6 max-w-xl space-y-4">
        <h4 class="text-sm font-bold text-white font-mono flex items-center gap-2">
          <StudioIcon name="image" :size="16" class="text-studio-accent" />
          <span>视频高精度关键帧抽取</span>
        </h4>
        <p class="text-xs text-slate-400 leading-relaxed">
          按帧率、时间戳或场景突变关键帧智能切分图片，结果自动归入素材库。
        </p>
      </div>

      <div v-else-if="activeTab === 'lipsync'" class="p-6 max-w-xl space-y-4">
        <h4 class="text-sm font-bold text-white font-mono flex items-center gap-2">
          <StudioIcon name="mic" :size="16" class="text-studio-accent" />
          <span>人物口型与音频精确对齐</span>
        </h4>
        <p class="text-xs text-slate-400 leading-relaxed">
          基于本地 Wav2Lip / MuseTalk 算法模型，保持人脸自然微表情并同步嘴型。
        </p>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import MediaConvertTool from '../../components/media/MediaConvertTool.vue';

const activeTab = ref('convert');

const tabs = [
  { key: 'convert', label: '格式转换' },
  { key: 'frames', label: '提取关键帧' },
  { key: 'lipsync', label: '口型同步' },
];

function handleStartConvert(opts) {
  console.log('[MediaToolsView] start convert:', opts);
}
</script>
