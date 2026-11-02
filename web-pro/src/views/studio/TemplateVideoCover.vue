<template>
  <div class="relative w-full h-full overflow-hidden bg-black/40">
    <img
      v-if="stage === 'poster'"
      :src="posterUrl"
      :class="contain ? 'w-full h-full object-contain' : 'w-full h-full object-cover'"
      alt=""
      @load="onPosterLoad"
      @error="onPosterError"
    />
    <video
      v-else-if="stage === 'video'"
      :src="frameUrl"
      muted
      playsinline
      preload="auto"
      :class="contain ? 'w-full h-full object-contain pointer-events-none' : 'w-full h-full object-cover pointer-events-none'"
      @loadeddata="onVideoLoaded"
      @error="onVideoError"
    ></video>
    <img
      v-else-if="stage === 'ref'"
      :src="referenceUrl"
      :class="contain ? 'w-full h-full object-contain' : 'w-full h-full object-cover'"
      alt="参考图"
    />
    <div v-else class="w-full h-full flex items-center justify-center text-[10px] text-slate-400">
      无封面
    </div>

    <div
      v-if="!compact && videoUrl && stage !== 'ref' && stage !== 'empty'"
      class="absolute inset-0 flex items-center justify-center pointer-events-none"
    >
      <div class="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-purple-200 border border-white/20">
        <StudioIcon name="play" :size="14" />
      </div>
    </div>
    <span
      v-if="stage === 'ref'"
      class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-bold text-amber-200"
    >参考图</span>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import StudioIcon from '../../components/StudioIcon.vue';

const props = defineProps({
  posterUrl: { type: String, default: '' },
  videoUrl: { type: String, default: '' },
  referenceUrl: { type: String, default: '' },
  compact: { type: Boolean, default: false },
  contain: { type: Boolean, default: false }
});

const emit = defineEmits(['measured']);

const stage = ref('empty');
const videoReady = ref(false);
let timer = 0;

const frameUrl = computed(() => {
  const url = props.videoUrl || '';
  if (!url || url.includes('#')) return url;
  return `${url}#t=0.001`;
});

function chooseStage() {
  videoReady.value = false;
  if (props.posterUrl) stage.value = 'poster';
  else if (props.videoUrl) stage.value = 'video';
  else if (props.referenceUrl) stage.value = 'ref';
  else stage.value = 'empty';
}

function emitSize(el) {
  const width = el?.naturalWidth || el?.videoWidth || 0;
  const height = el?.naturalHeight || el?.videoHeight || 0;
  if (width > 0 && height > 0) emit('measured', { width, height });
}

function onPosterLoad(event) {
  emitSize(event?.target);
}

function onPosterError() {
  if (props.videoUrl) stage.value = 'video';
  else if (props.referenceUrl) stage.value = 'ref';
  else stage.value = 'empty';
}

function onVideoError() {
  if (props.referenceUrl) stage.value = 'ref';
  else stage.value = 'empty';
}

function onVideoLoaded(event) {
  const width = event?.target?.videoWidth || 0;
  if (width > 0) {
    videoReady.value = true;
    emitSize(event.target);
    return;
  }
  onVideoError();
}

watch(() => [props.posterUrl, props.videoUrl, props.referenceUrl], chooseStage, { immediate: true });

watch(stage, (value) => {
  window.clearTimeout(timer);
  if (value !== 'video') return;
  videoReady.value = false;
  timer = window.setTimeout(() => {
    if (stage.value === 'video' && !videoReady.value) onVideoError();
  }, 8000);
});

onBeforeUnmount(() => window.clearTimeout(timer));
</script>
