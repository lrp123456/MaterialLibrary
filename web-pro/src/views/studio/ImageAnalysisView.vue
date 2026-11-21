<template>
  <div class="flex-1 min-h-0 flex flex-col bg-studio-950 text-slate-200 overflow-hidden">
    <div v-if="!currentImage" class="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <h2 class="text-xl font-bold text-slate-100 mb-2">图片区域分析</h2>
      <p class="text-sm text-slate-400 max-w-md mb-6">先分析整张室内实景，再框选一块，确认要看的物体。</p>
      <button type="button" class="px-4 py-2 rounded-lg bg-studio-accent text-white text-sm font-semibold cursor-pointer" @click="$emit('choose-image')">选择图片</button>
    </div>

    <div v-else class="flex-1 min-h-0 grid grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
      <div class="min-h-0 overflow-auto p-4">
        <div class="flex items-center gap-2 mb-3">
          <select v-model="selectedModel" class="bg-studio-900 border border-studio-700 rounded px-2 py-1 text-xs">
            <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
          <button type="button" class="px-3 py-1 rounded bg-studio-accent text-white text-xs font-semibold cursor-pointer disabled:opacity-40" :disabled="busy" @click="runScene">分析这张图</button>
          <button type="button" class="px-3 py-1 rounded bg-studio-800 text-xs cursor-pointer" @click="drawMode = drawMode === 'rect' ? 'polygon' : 'rect'">{{ drawMode === 'rect' ? '矩形' : '多点' }}</button>
          <button v-if="drawMode === 'polygon'" type="button" class="px-3 py-1 rounded bg-studio-800 text-xs cursor-pointer" @click="closePolygon">完成选区</button>
        </div>
        <p v-if="error" class="text-xs text-rose-300 mb-2">{{ error }}</p>
        <div class="relative inline-block max-w-full">
          <img ref="imgEl" :src="imageUrl" class="max-h-[68vh] max-w-full block select-none" alt="" @load="layoutReady = true" />
          <div
            v-if="report.scene"
            class="absolute inset-0"
            @mousedown="onPointerDown"
            @mousemove="onPointerMove"
            @mouseup="onPointerUp"
            @click="onOverlayClick"
          >
            <div v-if="liveRect" class="absolute border-2 border-studio-accent bg-studio-accent/10" :style="rectStyle(liveRect)"></div>
            <svg v-if="polygon.length" class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polygon :points="polygon.map(p => `${p.x * 100},${p.y * 100}`).join(' ')" fill="rgba(99,102,241,0.18)" stroke="#818cf8" stroke-width="1.5" />
            </svg>
          </div>
        </div>
      </div>

      <aside class="min-h-0 overflow-auto border-l border-studio-800 p-4 space-y-4">
        <section v-if="report.scene">
          <h3 class="text-sm font-bold mb-1">场景卡</h3>
          <p class="text-xs text-slate-300">空间类型：{{ report.scene.spaceType }}</p>
          <p class="text-xs text-slate-400">主色：{{ (report.scene.colors || []).join('、') || '无' }}</p>
          <ul class="mt-2 space-y-1">
            <li v-for="item in report.scene.candidates" :key="item.id" class="text-xs text-slate-300">{{ item.nameZh }}</li>
          </ul>
        </section>

        <section v-if="report.scene">
          <h3 class="text-sm font-bold mb-1">这块区域</h3>
          <input v-model="phrase" class="w-full bg-studio-900 border border-studio-700 rounded px-2 py-1 text-xs mb-2" placeholder="例如：电视背景墙" />
          <button type="button" class="px-3 py-1 rounded bg-studio-800 text-xs cursor-pointer disabled:opacity-40" :disabled="!selection || busy" @click="runPreview">查看框内物体</button>
          <ul v-if="preview" class="mt-2 space-y-1">
            <li v-for="item in preview.candidates" :key="item.id">
              <button type="button" class="text-xs text-left w-full px-2 py-1 rounded cursor-pointer" :class="focusId === item.id ? 'bg-studio-accent text-white' : 'bg-studio-900 text-slate-200'" @click="focusId = item.id">
                {{ item.nameZh }}<span v-if="preview.suggestedId === item.id"> · 原话预选</span>
              </button>
            </li>
          </ul>
          <button type="button" class="mt-2 px-3 py-1 rounded bg-studio-accent text-white text-xs font-semibold cursor-pointer disabled:opacity-40" :disabled="!canAnalyze || busy" @click="runRegion">分析这块</button>
        </section>

        <section v-for="region in report.regions || []" :key="region.id" class="border border-studio-800 rounded-lg p-3">
          <p class="text-xs font-bold">{{ region.focus?.nameZh || '未确认焦点' }}</p>
          <p class="text-[11px] text-slate-400">{{ region.status === 'stale' ? '已失效，需要重新分析这块' : (region.focusConfirmed ? '焦点已确认' : '请点选焦点') }}</p>
          <label class="block text-[11px] mt-2">颜色
            <select v-model="region.colorIntent" class="w-full bg-studio-900 border border-studio-700 rounded px-1 py-0.5" @change="saveIntent(region)">
              <option value="unset">先不选</option>
              <option value="keep">沿用这块</option>
              <option value="follow_target">以后跟目标图</option>
            </select>
          </label>
          <label class="block text-[11px] mt-1">材质
            <select v-model="region.materialIntent" class="w-full bg-studio-900 border border-studio-700 rounded px-1 py-0.5" @change="saveIntent(region)">
              <option value="unset">先不选</option>
              <option value="keep">沿用这块</option>
              <option value="follow_target">以后跟目标图</option>
            </select>
          </label>
          <p v-if="region.draft" class="text-[11px] text-slate-300 mt-2 whitespace-pre-wrap">{{ region.draft }}</p>
          <button type="button" class="mt-2 px-3 py-1 rounded bg-studio-accent text-white text-xs cursor-pointer disabled:opacity-40" :disabled="!region.draftOk" @click="jump(region)">去创作对话看效果</button>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { getAssetImageUrl, getImageAnalysis, previewImageRegion, submitImageRegion, submitImageScene } from '../../api';

const props = defineProps({
  currentImage: { type: Object, default: null }
});
const emit = defineEmits(['choose-image', 'jump']);

const models = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon' }
];
const selectedModel = ref('gemini-2.5-flash');
const report = ref({ scene: null, regions: [] });
const busy = ref(false);
const error = ref('');
const phrase = ref('');
const preview = ref(null);
const focusId = ref('');
const selection = ref(null);
const drawMode = ref('rect');
const liveRect = ref(null);
const polygon = ref([]);
const drag = ref(null);
const imgEl = ref(null);
const layoutReady = ref(false);

const imageUrl = computed(() => props.currentImage?.url || (props.currentImage?.fid ? getAssetImageUrl(props.currentImage.fid, props.currentImage.mediaToken) : ''));
const canAnalyze = computed(() => {
  if (!selection.value || !preview.value) return false;
  if (preview.value.focusConfirmed) return true;
  return Boolean(focusId.value);
});

watch(() => props.currentImage?.fid, async (fid) => {
  preview.value = null;
  selection.value = null;
  focusId.value = '';
  polygon.value = [];
  error.value = '';
  if (!fid) {
    report.value = { scene: null, regions: [] };
    return;
  }
  try {
    const res = await getImageAnalysis(fid);
    report.value = res.data || { scene: null, regions: [] };
  } catch (err) {
    error.value = err.message || String(err);
  }
}, { immediate: true });

function pointOf(event) {
  const rect = imgEl.value.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  };
}

function onPointerDown(event) {
  if (!report.value.scene || drawMode.value !== 'rect') return;
  const start = pointOf(event);
  drag.value = start;
  liveRect.value = { kind: 'rect', x: start.x, y: start.y, w: 0, h: 0 };
}

function onPointerMove(event) {
  if (!drag.value) return;
  const now = pointOf(event);
  liveRect.value = {
    kind: 'rect',
    x: Math.min(drag.value.x, now.x),
    y: Math.min(drag.value.y, now.y),
    w: Math.abs(now.x - drag.value.x),
    h: Math.abs(now.y - drag.value.y)
  };
}

function onPointerUp() {
  if (!drag.value || !liveRect.value) return;
  if (liveRect.value.w > 0.01 && liveRect.value.h > 0.01) {
    selection.value = liveRect.value;
    preview.value = null;
    focusId.value = '';
  }
  drag.value = null;
}

function onOverlayClick(event) {
  if (drawMode.value !== 'polygon' || !report.value.scene) return;
  polygon.value = polygon.value.concat(pointOf(event));
}

function closePolygon() {
  if (polygon.value.length < 3) return;
  selection.value = { kind: 'polygon', points: polygon.value.slice() };
  preview.value = null;
  focusId.value = '';
}

function rectStyle(box) {
  return { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` };
}

async function runScene() {
  busy.value = true;
  error.value = '';
  try {
    const res = await submitImageScene(props.currentImage.fid, selectedModel.value);
    report.value = res.data;
    preview.value = null;
    selection.value = null;
  } catch (err) {
    error.value = err.message || String(err);
  } finally {
    busy.value = false;
  }
}

async function runPreview() {
  busy.value = true;
  error.value = '';
  try {
    const res = await previewImageRegion(props.currentImage.fid, selection.value, phrase.value);
    preview.value = res.data;
    focusId.value = res.data.focusConfirmed ? res.data.focus?.id : (res.data.suggestedId || '');
  } catch (err) {
    error.value = err.message || String(err);
  } finally {
    busy.value = false;
  }
}

async function runRegion() {
  busy.value = true;
  error.value = '';
  try {
    const id = `r${Date.now()}`;
    const res = await submitImageRegion({
      fid: props.currentImage.fid,
      id,
      selection: selection.value,
      phrase: phrase.value,
      focusId: preview.value.focusConfirmed ? preview.value.focus.id : focusId.value,
      model: selectedModel.value,
      colorIntent: 'unset',
      materialIntent: 'unset'
    });
    attachDraft(res.data.report);
  } catch (err) {
    error.value = err.message || String(err);
  } finally {
    busy.value = false;
  }
}

function attachDraft(nextReport) {
  report.value = nextReport;
}

async function saveIntent(region) {
  if (region.status === 'stale') return;
  try {
    const res = await submitImageRegion({
      fid: props.currentImage.fid,
      id: region.id,
      selection: region.selection,
      phrase: region.phrase,
      focusId: region.focus?.id,
      colorIntent: region.colorIntent,
      materialIntent: region.materialIntent,
      skipVision: true,
      model: selectedModel.value
    });
    attachDraft(res.data.report);
  } catch (err) {
    error.value = err.message || String(err);
  }
}

function jump(region) {
  const overlay = toViewerRegion(region.selection);
  emit('jump', {
    target: 'image-analysis',
    draft: region.draft,
    image: props.currentImage,
    region: overlay
  });
}

function toViewerRegion(sel) {
  if (!sel) return null;
  if (sel.kind === 'rect') {
    const x = sel.x * 100;
    const y = sel.y * 100;
    const r = (sel.x + sel.w) * 100;
    const b = (sel.y + sel.h) * 100;
    return { id: 'analysis-box', type: 'polygon', pctPoints: [{ x, y }, { x: r, y }, { x: r, y: b }, { x, y: b }] };
  }
  return {
    id: 'analysis-box',
    type: 'polygon',
    pctPoints: (sel.points || []).map((point) => ({ x: point.x * 100, y: point.y * 100 }))
  };
}
</script>
