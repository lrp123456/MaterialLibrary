<template>
  <div class="view-root studio-view flex-1 min-h-0 flex flex-col overflow-hidden bg-studio-950 font-sans">
    <!-- 空间创作顶栏分段控制器：对话台 | 创作库 | 参考视频分析 -->
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
          <span>对话台</span>
        </button>
        <button
          type="button"
          @click="activeSegment = 'creation'"
          :class="[
            'px-3 py-1 rounded-md transition-all flex items-center gap-1.5 cursor-pointer',
            activeSegment === 'creation'
              ? 'bg-studio-accent text-white shadow-sm font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <span>创作库</span>
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
          <span>分析</span>
          <span v-if="currentVideo" class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
        </button>
      </div>

      <!-- 右侧辅助按钮 -->
      <div v-if="activeSegment === 'analyze'" class="flex items-center gap-2">
        <button
          type="button"
          @click="analyzeKind === 'video' ? (pickerVisible = true) : (imagePickerVisible = true)"
          class="px-2.5 py-1 text-xs rounded bg-studio-800 hover:bg-studio-700 text-slate-200 flex items-center gap-1 border border-studio-700 transition-colors cursor-pointer"
        >
          <svg class="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="2" width="20" height="20" rx="2.18"/>
            <line x1="7" y1="2" x2="7" y2="22"/>
            <line x1="17" y1="2" x2="17" y2="22"/>
          </svg>
          <span v-if="analyzeKind === 'video'">{{ currentVideo ? '更换参考视频' : '选择参考视频' }}</span>
          <span v-else>{{ currentImage ? '更换图片' : '选择图片' }}</span>
        </button>
      </div>
    </div>

    <!-- 对话台分段（默认工作台） -->
    <div v-show="activeSegment === 'generate'" class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <ChatStudio
        :initialPayload="chatTargetPayload"
        @sendToClip="$emit('sendToClip', $event)"
        @payload-consumed="$emit('payloadConsumed')"
        @openCreationLibrary="activeSegment = 'creation'"
      />
    </div>

    <!-- 创作库分段 (资产库演变与提示词复用) -->
    <div v-show="activeSegment === 'creation'" class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <CreationLibraryView
        @sendToChat="handleCreationSendToChat"
      />
    </div>

    <!-- 分析分段 -->
    <div v-show="activeSegment === 'analyze'" class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div class="h-9 px-4 border-b border-studio-800 flex items-center gap-2 shrink-0">
        <button type="button" class="px-2.5 py-1 rounded text-xs cursor-pointer" :class="analyzeKind === 'video' ? 'bg-studio-accent text-white' : 'text-slate-400'" @click="analyzeKind = 'video'">视频</button>
        <button type="button" class="px-2.5 py-1 rounded text-xs cursor-pointer" :class="analyzeKind === 'image' ? 'bg-studio-accent text-white' : 'text-slate-400'" @click="analyzeKind = 'image'">图片</button>
      </div>
      <VideoAnalysisView
        v-show="analyzeKind === 'video'"
        :currentVideo="currentVideo"
        @choose-video="pickerVisible = true"
        @upload-video="onVideoUpload"
        @jump-to-generate="handleJumpToGenerate"
        @select-history="onVideoHistorySelected"
      />
      <ImageAnalysisView
        v-show="analyzeKind === 'image'"
        :currentImage="currentImage"
        @choose-image="imagePickerVisible = true"
        @jump="handleImageJump"
      />
    </div>

    <!-- 视频资产选择器（复用现有 AssetPickerModal，仅开启视频类型，支持入库与上传） -->
    <AssetPickerModal
      :visible="imagePickerVisible"
      :mediaTypes="['image']"
      :initialMain="'image'"
      commit-on-version
      :uploadEnabled="true"
      :maxSelect="1"
      title="选择要分析的室内实景"
      submitLabel="使用这张图"
      @close="imagePickerVisible = false"
      @confirm="onImageSelected"
      @select="onImageSelected"
    />

    <AssetPickerModal
      :visible="pickerVisible"
      :mediaTypes="['video']"
      :initialMain="'video'"
      commit-on-version
      :uploadEnabled="true"
      :maxSelect="1"
      title="选择或上传参考视频进行逐镜拆解"
      submitLabel="开始拆解分析"
      @close="pickerVisible = false"
      @confirm="onVideoSelected"
      @select="onVideoSelected"
      @upload="onVideoUpload"
    />

    <!-- 上传本地视频遮罩状态 -->
    <div v-if="isUploadingVideo" class="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div class="px-7 py-6 rounded-2xl bg-studio-900 border border-studio-700 text-center shadow-2xl flex flex-col items-center">
        <div class="w-10 h-10 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-3"></div>
        <div class="text-sm font-bold text-slate-100">正在上传本地参考视频...</div>
        <div class="text-xs text-slate-400 mt-1">上传完成后将立即入库并开启逐镜逆向拆解</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { defineAsyncComponent, h, ref, watch } from 'vue';
import { authFetch, getAssetImageUrl, getAssetPosterUrl } from '../api';
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

const ImageAnalysisView = defineAsyncComponent({
  loader: () => import('./studio/ImageAnalysisView.vue'),
  loadingComponent: {
    render() {
      return h('div', { class: 'flex-1 flex items-center justify-center text-xs text-slate-500 font-mono tracking-widest' }, 'LOADING ANALYSIS…');
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

const CreationLibraryView = defineAsyncComponent({
  loader: () => import('./studio/CreationLibraryView.vue'),
  loadingComponent: {
    render() {
      return h('div', { class: 'flex-1 flex items-center justify-center text-xs text-slate-500 font-mono tracking-widest' }, 'LOADING CREATION LIBRARY…');
    }
  },
  delay: 120
});

const props = defineProps({
  initialPayload: { type: Object, default: null }
});

const emit = defineEmits(['sendToClip', 'payloadConsumed']);

const activeSegment = ref('generate'); // 'generate' | 'creation' | 'analyze'
const analyzeKind = ref('video');
const currentVideo = ref(null);
const currentImage = ref(null);
const pickerVisible = ref(false);
const imagePickerVisible = ref(false);
const chatTargetPayload = ref(null);

function handleCreationSendToChat(payload) {
  chatTargetPayload.value = {
    target: 'creation_reuse',
    ...payload
  };
  activeSegment.value = 'generate';
}

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
  if (payload.target === 'creation') {
    activeSegment.value = 'creation';
    return;
  }
  chatTargetPayload.value = payload;
}, { immediate: true });

const isUploadingVideo = ref(false);

function onVideoSelected(selected) {
  const item = Array.isArray(selected) ? selected[0] : selected;
  if (item && (item.fid || item.id)) {
    const fid = item.fid || item.id;
    currentVideo.value = {
      fid,
      id: fid,
      name: item.name || item.file_name || '参考视频',
      url: item.url || getAssetPosterUrl(fid, item.mediaToken),
      kind: 'video',
      mediaToken: item.mediaToken
    };
    activeSegment.value = 'analyze';
  }
  pickerVisible.value = false;
}

async function onVideoUpload(file) {
  if (!file) return;
  pickerVisible.value = false;
  isUploadingVideo.value = true;
  try {
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('filename', file.name);
    fd.append('category', 'video');
    fd.append('source', 'manual');

    const res = await authFetch('/api/upload', {
      method: 'POST',
      body: fd
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const fid = data.fid || data.asset?.fid;
    if (fid) {
      currentVideo.value = {
        fid,
        id: fid,
        name: file.name,
        url: URL.createObjectURL(file),
        kind: 'video'
      };
      activeSegment.value = 'analyze';
    } else {
      throw new Error('未获取到入库资产编号 (fid)');
    }
  } catch (err) {
    alert(`上传参考视频失败: ${err.message || err}`);
  } finally {
    isUploadingVideo.value = false;
  }
}

function handleJumpToGenerate(recipe) {
  activeSegment.value = 'generate';
  chatTargetPayload.value = recipe;
}

function onImageSelected(selected) {
  const item = Array.isArray(selected) ? selected[0] : selected;
  if (item && (item.fid || item.id)) {
    const fid = item.fid || item.id;
    currentImage.value = {
      fid,
      id: fid,
      name: item.name || item.file_name || '分析图片',
      url: item.url || getAssetImageUrl(fid, item.mediaToken),
      kind: 'image',
      mediaToken: item.mediaToken
    };
    analyzeKind.value = 'image';
    activeSegment.value = 'analyze';
  }
  imagePickerVisible.value = false;
}

function handleImageJump(payload) {
  activeSegment.value = 'generate';
  chatTargetPayload.value = payload;
}

function onVideoHistorySelected(item) {
  if (item && item.fid) {
    currentVideo.value = {
      fid: item.fid,
      id: item.fid,
      name: item.name || item.fileName || '参考视频',
      url: item.thumbUrl || getAssetPosterUrl(item.fid),
      kind: 'video',
      duration: item.duration
    };
    activeSegment.value = 'analyze';
  }
}
</script>
