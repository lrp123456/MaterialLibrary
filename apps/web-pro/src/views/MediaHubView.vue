<template>
  <div class="view-root mediahub-view flex-1 min-h-0 flex flex-col overflow-hidden bg-studio-950 font-sans">
    <!-- 二级导航栏：多轨视频剪辑 vs 常用媒体工具 (高度 48px) -->
    <div class="h-12 bg-studio-900 border-b border-studio-700 px-5 flex items-center justify-between shrink-0 select-none">
      <div class="flex items-center space-x-2">
        <button
          @click="activeSub = 'opencut'"
          :class="[
            'px-5 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 cursor-pointer',
            'choice',
            activeSub === 'opencut' ? 'is-on font-bold' : 'hover:bg-studio-800'
          ]"
        >
          <span class="choice-mark" aria-hidden="true"></span>
          <StudioIcon name="video" :size="16" />
          <span>多轨剪辑</span>
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
          <span>媒体工具</span>
        </button>
      </div>

      <!-- 右侧指示 -->
      <div class="flex items-center space-x-2 text-xs font-mono text-slate-300">
        <span class="text-slate-400">处理模式:</span>
        <span class="text-white font-extrabold uppercase px-2 py-0.5 rounded bg-studio-850 border border-studio-700">
          {{ modeLabel }}
        </span>
      </div>
    </div>

    <!-- 子工作台内容展示 -->
    <OpenCutView v-if="activeSub === 'opencut'" :initialPayload="clipPayload" />
    <MediaToolsView v-else-if="activeSub === 'tools'" />
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, h, ref, watch } from 'vue';
import StudioIcon from '../components/StudioIcon.vue';

// 两个子工作台独立成块：默认只载多轨剪辑，切到「媒体工具」时才拉取
// MediaToolsView（含 mediabunny/wgsl/jszip 的动态依赖链）。
const subLoading = {
  render() {
    return h('div', { class: 'flex-1 flex items-center justify-center text-xs text-slate-500 font-mono tracking-widest' }, 'LOADING…');
  }
};
const OpenCutView = defineAsyncComponent({ loader: () => import('./studio/OpenCutView.vue'), loadingComponent: subLoading, delay: 120 });
const MediaToolsView = defineAsyncComponent({ loader: () => import('./studio/MediaToolsView.vue'), loadingComponent: subLoading, delay: 120 });

const props = defineProps({
  initialSub: { type: String, default: 'opencut' },
  clipPayload: { type: Object, default: null }
});

const activeSub = ref(props.initialSub);

const modeLabel = computed(() => {
  return activeSub.value === 'opencut' ? 'OPENCUT TIMELINE' : 'FFMPEG UTILITIES';
});

watch(() => props.initialSub, (val) => {
  if (val) activeSub.value = val;
});
</script>
