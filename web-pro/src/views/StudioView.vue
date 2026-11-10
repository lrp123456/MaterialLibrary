<template>
  <div class="view-root studio-view flex-1 min-h-0 flex flex-col overflow-hidden bg-studio-950 font-sans">
    <!-- 空间创作顶栏分段控制器：生成工作台 | 参考视频分析 -->
    <div class="h-10 px-4 border-b border-studio-800 bg-studio-900/60 backdrop-blur flex items-center justify-between shrink-0 z-20">
      <div class="inline-flex items-center p-0.5 rounded-lg bg-studio-950/80 border border-studio-800 text-xs font-medium">
        <button
          type="button"
          @click="activeSegment = 'generate'"
          :class="[
            'px-3 py-1 rounded-md transition-all flex items-center gap-1.5 cursor-pointer',
            activeSegment === 'generate'
              ? 'bg-studio-accent text-white shadow-sm font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
          <span>生成工作台</span>
        </button>
        <button
          type="button"
          @click="activeSegment = 'analyze'"
          :class="[
            'px-3 py-1 rounded-md transition-all flex items-center gap-1.5 cursor-pointer',
            activeSegment === 'analyze'
              ? 'bg-studio-accent text-white shadow-sm font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
          <span>参考视频分析</span>
          <span v-if="currentVideo" class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
        </button>
      </div>

      <!-- 右侧辅助按钮 -->
      <div v-if="activeSegment === 'analyze'" class="flex items-center gap-2">
        <button
          type="button"
          @click="pickerVisible = true"
          class="px-2.5 py-1 text-xs rounded bg-studio-800 hover:bg-studio-700 text-slate-200 flex items-center gap-1 border border-studio-700 transition-colors cursor-pointer"
        >
          <svg class="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="2" width="20" height="20" rx="2.18"/>
            <line x1="7" y1="2" x2="7" y2="22"/>
            <line x1="17" y1="2" x2="17" y2="22"/>
          </svg>
          <span>{{ currentVideo ? '更换参考视频' : '选择参考视频' }}</span>
        </button>
      </div>
    </div>

    <!-- 生成分段（默认工作台） -->
    <div v-show="activeSegment === 'generate'" class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <ChatStudio
        :initialPayload="chatTargetPayload"
        @sendToClip="$emit('sendToClip', $event)"
        @payload-consumed="$emit('payloadConsumed')"
      />
    </div>

    <!-- 分析分段 -->
    <div v-show="activeSegment === 'analyze'" class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <VideoAnalysisView
        :currentVideo="currentVideo"
        @choose-video="pickerVisible = true"
        @jump-to-generate="handleJumpToGenerate"
      />
    </div>

    <!-- 视频资产选择器（复用现有 AssetPickerModal，仅开启视频类型，支持入库与上传） -->
    <AssetPickerModal
      :visible="pickerVisible"
      :mediaTypes="['video']"
      :initialMain="'video'"
      :uploadEnabled="true"
      :maxSelect="1"
      title="选择或上传参考视频进行逐镜拆解"
      submitLabel="开始拆解分析"
      @close="pickerVisible = false"
      @select="onVideoSelected"
    />
  </div>
</template>

<script setup>
import { defineAsyncComponent, h, ref, watch } from 'vue';
import { getAssetImageUrl } from '../api';
import AssetPickerModal from '../components/AssetPickerModal.vue';

// 懒加载组件：ChatStudio 体量大，避免拖慢其它视口
const ChatStudio = defineAsyncComponent({
  loader: () => import('./studio/ChatStudio.vue'),
  loadingComponent: {
    render() {
      return h('div', { class: 'flex-1 flex items-center justify-center text-xs text-slate-500 font-mono tracking-widest' }, 'LOADING STUDIO…');
    }
  },
  delay: 120
});

const VideoAnalysisView = defineAsyncComponent({
  loader: () => import('./studio/VideoAnalysisView.vue'),
  loadingComponent: {
    render() {
      return h('div', { class: 'flex-1 flex items-center justify-center text-xs text-slate-500 font-mono tracking-widest' }, 'LOADING ANALYSIS…');
    }
  },
  delay: 120
});

const props = defineProps({
  initialPayload: { type: Object, default: null }
});

const emit = defineEmits(['sendToClip', 'payloadConsumed']);

const activeSegment = ref('generate'); // 'generate' | 'analyze'
const currentVideo = ref(null);
const pickerVisible = ref(false);
const chatTargetPayload = ref(null);

watch(() => props.initialPayload, (payload) => {
  if (!payload) return;
  if (payload.target === 'quick') {
    const rawUrl = payload.item?.url || payload.item?.imgUrl || (payload.item?.fid ? getAssetImageUrl(payload.item.fid, payload.item.mediaToken) : '');
    const itemObj = typeof payload.item === 'object' ? { ...payload.item } : { url: String(payload.item || '') };
    if (rawUrl) itemObj.url = rawUrl;
    itemObj._openDrawer = true;
    chatTargetPayload.value = { target: 'quick', items: [itemObj] };
    activeSegment.value = 'generate';
    return;
  }
  if (payload.target === 'analyze_video') {
    currentVideo.value = payload.item || null;
    activeSegment.value = 'analyze';
    return;
  }
  chatTargetPayload.value = payload;
}, { immediate: true });

function onVideoSelected(selected) {
  const item = Array.isArray(selected) ? selected[0] : selected;
  if (item) {
    currentVideo.value = item;
    activeSegment.value = 'analyze';
  }
  pickerVisible.value = false;
}

function handleJumpToGenerate(recipe) {
  activeSegment.value = 'generate';
  chatTargetPayload.value = recipe;
}
</script>
