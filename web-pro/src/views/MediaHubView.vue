<template>
  <div class="flex-1 flex flex-col h-[calc(100vh-56px)] overflow-hidden bg-studio-950 font-sans">
    <!-- 二级导航栏：多轨视频剪辑 vs 常用媒体工具 (高度 48px) -->
    <div class="h-12 bg-studio-900 border-b border-studio-700 px-5 flex items-center justify-between shrink-0 select-none">
      <div class="flex items-center space-x-2">
        <button
          @click="activeSub = 'clip'"
          :class="[
            'px-5 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 cursor-pointer',
            'choice',
            activeSub === 'clip' ? 'is-on font-bold' : 'hover:bg-studio-800'
          ]"
        >
          <span class="choice-mark" aria-hidden="true"></span>
          <StudioIcon name="video" :size="16" />
          <span>多轨视频剪辑</span>
          <span v-if="activeSub === 'clip'" class="choice-now">当前</span>
          <span class="text-xs font-mono opacity-80">OpenCut 架构</span>
        </button>

        <button
          @click="activeSub = 'tools'"
          :class="[
            'px-5 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 cursor-pointer',
            'choice',
            activeSub === 'tools' ? 'is-on font-bold' : 'hover:bg-studio-800'
          ]"
        >
          <span class="choice-mark" aria-hidden="true"></span>
          <StudioIcon name="sliders" :size="16" />
          <span>常用媒体工具</span>
          <span v-if="activeSub === 'tools'" class="choice-now">当前</span>
          <span class="text-xs font-mono opacity-80">FFmpeg 高频工具箱</span>
        </button>
      </div>

      <!-- 右侧指示 -->
      <div class="flex items-center space-x-2 text-xs font-mono text-slate-300">
        <span class="text-slate-400">处理模式:</span>
        <span class="text-white font-extrabold uppercase px-2 py-0.5 rounded bg-studio-850 border border-studio-700">
          {{ activeSub === 'clip' ? 'MULTITRACK TIMELINE' : 'FFMPEG UTILITIES' }}
        </span>
      </div>
    </div>

    <!-- 子工作台内容展示 -->
    <ClipStudio v-if="activeSub === 'clip'" />
    <MediaToolsView v-else-if="activeSub === 'tools'" />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import StudioIcon from '../components/StudioIcon.vue';
import ClipStudio from './studio/ClipStudio.vue';
import MediaToolsView from './studio/MediaToolsView.vue';

const props = defineProps({
  initialSub: { type: String, default: 'clip' }
});

const activeSub = ref(props.initialSub);

watch(() => props.initialSub, (val) => {
  if (val) activeSub.value = val;
});
</script>
