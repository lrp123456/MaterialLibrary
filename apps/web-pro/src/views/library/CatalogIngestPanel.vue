<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-0"
    @click.self="emit('close')"
  >
    <div class="w-screen h-screen max-w-none max-h-none overflow-y-auto rounded-none border-0 bg-studio-950 text-slate-100 shadow-2xl">
      <div class="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-white/10 bg-studio-950">
        <h2 class="text-sm font-bold">基础素材入库</h2>
        <button type="button" class="text-xs text-slate-400 hover:text-white" @click="emit('close')">关闭</button>
      </div>

      <section class="px-5 py-4 border-b border-white/10 space-y-3">
        <h3 class="text-xs font-bold text-slate-300">从照片提炼草稿</h3>
        <p class="text-[11px] text-slate-400">框选或连点后再识别，草稿会预填库和系列。不框选就看整张照片。确认前不会入库。</p>
        <div class="flex flex-wrap gap-2 items-center">
          <input type="file" accept="image/*" class="text-xs max-w-[14rem]" @change="onFile" />
          <button type="button" class="px-3 py-1.5 rounded-lg bg-white/10 text-xs" @click="pickerOpen = true">从素材库选择</button>
          <button type="button" class="px-3 py-1.5 rounded-lg bg-white/10 text-sm" :disabled="busy || !photoUrl" @click="previewPhoto">生成草稿</button>
        </div>
        <p v-if="photoName" class="text-[11px] text-slate-500">当前照片：{{ photoName }}</p>
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)]">
          <div class="relative h-[min(70vh,720px)] min-h-[24rem] rounded-xl bg-black/40 border border-white/10 overflow-hidden">
            <StudioEditLayer
              v-if="photoUrl"
              :key="photoName + ':' + imageBase64.length"
              ref="cropLayerRef"
              crop-only
              :visible="true"
              :image="{ url: photoUrl, name: photoName, fid }"
            />
            <div v-else class="absolute inset-0 flex items-center justify-center text-xs text-slate-500">先选择照片或从素材库挑一张</div>
          </div>
          <div class="space-y-2 min-w-0">
            <p v-if="previewError" class="text-xs text-rose-300">{{ previewError }}</p>
            <p v-else-if="!drafts.length" class="text-xs text-slate-500">识别后在这里改库、系列、名称和部位，再确认入库。</p>
            <ul v-if="drafts.length" class="space-y-2 max-h-80 overflow-y-auto pr-1">
              <li v-for="(row, index) in drafts" :key="index" class="rounded-lg border border-white/10 p-2 space-y-2 text-xs">
                <label class="flex items-center gap-2 font-medium">
                  <input v-model="row.checked" type="checkbox" />
                  入库
                </label>
                <div class="grid grid-cols-2 gap-2">
                  <label class="space-y-1">
                    <span class="text-slate-400">库</span>
                    <select v-model="row.library" class="w-full rounded bg-studio-900 border border-white/10 px-2 py-1" @change="onLibraryChange(row)">
                      <option v-for="lib in LIBRARIES" :key="lib.key" :value="lib.key">{{ lib.label }}</option>
                    </select>
                  </label>
                  <label class="space-y-1">
                    <span class="text-slate-400">系列</span>
                    <select v-model="row.kind_key" class="w-full rounded bg-studio-900 border border-white/10 px-2 py-1" @change="syncSeries(row)">
                      <option v-for="series in seriesOfLibrary(row.library)" :key="series.kind_key" :value="series.kind_key">{{ series.label }}</option>
                    </select>
                  </label>
                  <label class="space-y-1 col-span-2">
                    <span class="text-slate-400">名称</span>
                    <input v-model="row.name_zh" type="text" class="w-full rounded bg-studio-900 border border-white/10 px-2 py-1" />
                  </label>
                  <label class="space-y-1">
                    <span class="text-slate-400">品牌</span>
                    <input v-model="row.brand" type="text" class="w-full rounded bg-studio-900 border border-white/10 px-2 py-1" />
                  </label>
                  <label class="space-y-1">
                    <span class="text-slate-400">部位</span>
                    <select v-model="row.mount" class="w-full rounded bg-studio-900 border border-white/10 px-2 py-1">
                      <option value="">未定</option>
                      <option v-for="mount in MOUNTS" :key="mount.key" :value="mount.key">{{ mount.label }}</option>
                    </select>
                  </label>
                  <label v-if="row.library === 'material'" class="space-y-1 col-span-2">
                    <span class="text-slate-400">色值</span>
                    <span class="inline-flex items-center gap-2">
                      <input v-model="row.hex" type="text" class="w-28 rounded bg-studio-900 border border-white/10 px-2 py-1 font-mono" />
                      <span class="inline-block w-4 h-4 rounded-full border border-white/20" :style="{ background: row.hex || 'transparent' }"></span>
                    </span>
                  </label>
                </div>
              </li>
            </ul>
            <button
              v-if="drafts.length"
              type="button"
              class="px-3 py-1.5 rounded-lg bg-studio-accent text-white text-sm font-bold disabled:opacity-40"
              :disabled="busy || !drafts.some((row) => row.checked)"
              @click="confirmPhoto"
            >
              确认入库
            </button>
            <p v-if="confirmNote" class="text-xs text-emerald-300">{{ confirmNote }}</p>
          </div>
        </div>
      </section>

      <section class="px-5 py-4 space-y-3">
        <h3 class="text-xs font-bold text-slate-300">用当前列表生成方案草稿</h3>
        <p class="text-[11px] text-slate-400">按当前已显示的基础素材统计主色、材料种类和一起出现的部位。保存时另建一套，不改已有方案。</p>
        <button type="button" class="px-3 py-1.5 rounded-lg bg-white/10 text-sm" :disabled="busy || !itemIds.length" @click="draftScheme">
          生成草稿（{{ Math.min(itemIds.length, 40) }} 条）
        </button>
        <ul v-if="schemeSlots.length" class="text-xs space-y-1 text-slate-300">
          <li v-for="(slot, index) in schemeSlots" :key="index">
            {{ slot.surface }} · {{ slot.role }} · {{ slot.name_zh }}
          </li>
        </ul>
        <div v-if="schemeSlots.length" class="flex flex-wrap gap-2">
          <input v-model="schemeName" type="text" placeholder="方案名称" class="flex-1 rounded-lg bg-studio-900 border border-white/10 px-2 py-1.5 text-sm" />
          <input v-model="styleLeaf" type="text" placeholder="风格叶子，由你填写" class="flex-1 rounded-lg bg-studio-900 border border-white/10 px-2 py-1.5 text-sm" />
          <button type="button" class="px-3 py-1.5 rounded-lg bg-studio-accent text-white text-sm font-bold disabled:opacity-40" :disabled="busy || !schemeName.trim() || !styleLeaf.trim()" @click="saveScheme">
            保存为新方案
          </button>
        </div>
        <p v-if="schemeNote" class="text-xs text-emerald-300">{{ schemeNote }}</p>
      </section>
    </div>
  </div>

  <div
    v-if="viewing && photoUrl"
    class="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-6"
    @click="viewing = false"
  >
    <img :src="photoUrl" class="max-w-[92vw] max-h-[92vh] object-contain" alt="" />
  </div>

  <AssetPickerModal
    :visible="pickerOpen"
    context="edit"
    title="从素材库选择"
    submit-label="用这张照片"
    :max-select="1"
    :media-types="['image']"
    initial-main="image"
    @close="pickerOpen = false"
    @confirm="onPicked"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { authFetch, getAssetImageUrl, getAssetOriginalUrl } from '../../api.js';
import AssetPickerModal from '../../components/AssetPickerModal.vue';
import StudioEditLayer from '../studio/StudioEditLayer.vue';

const LIBRARIES = [
  { key: 'material', label: '材质库' },
  { key: 'design', label: '做法库' },
  { key: 'product', label: '选品库' }
];
const SERIES = [
  { library: 'material', kind_key: 'latex', label: '乳胶漆' },
  { library: 'material', kind_key: 'microcement', label: '微水泥' },
  { library: 'material', kind_key: 'wallpaper', label: '墙纸' },
  { library: 'material', kind_key: 'tile', label: '瓷砖' },
  { library: 'material', kind_key: 'wood', label: '木作' },
  { library: 'material', kind_key: 'stone', label: '石材' },
  { library: 'design', kind_key: 'ceiling_design', label: '天花' },
  { library: 'design', kind_key: 'wall_design', label: '墙面' },
  { library: 'design', kind_key: 'door_design', label: '门板' },
  { library: 'product', kind_key: 'furniture', label: '家具' },
  { library: 'product', kind_key: 'light', label: '灯具' },
  { library: 'product', kind_key: 'fixture', label: '洁具五金' },
  { library: 'product', kind_key: 'soft_goods', label: '软装' },
  { library: 'product', kind_key: 'carpet', label: '地毯' }
];
const MOUNTS = [
  { key: 'ceiling', label: '天花' },
  { key: 'wall', label: '墙面' },
  { key: 'floor', label: '地面' },
  { key: 'millwork', label: '全屋定制' },
  { key: 'counter', label: '台面' },
  { key: 'furniture', label: '家具' },
  { key: 'soft', label: '软装' }
];

const props = defineProps({
  open: { type: Boolean, default: false },
  itemIds: { type: Array, default: () => [] },
  initialAsset: { type: Object, default: null }
});
const emit = defineEmits(['close', 'saved']);

const sources = ref([]);
const adapterId = ref('');
const pullNote = ref('');
const fid = ref('');
const imageBase64 = ref('');
const distillBase64 = ref('');
const photoUrl = ref('');
const photoName = ref('');
const drafts = ref([]);
const previewError = ref('');
const confirmNote = ref('');
const schemeSlots = ref([]);
const schemeName = ref('');
const styleLeaf = ref('');
const schemeNote = ref('');
const busy = ref(false);
const pickerOpen = ref(false);
const viewing = ref(false);
const tool = ref('rect');
const normRect = ref(null);
const polyPoints = ref([]);
const polyClosed = ref(false);
const polyHover = ref(null);
const dragging = ref(false);
const dragAnchor = ref(null);
const stageRef = ref(null);
const cropLayerRef = ref(null);
const nat = ref({ w: 0, h: 0 });
const photoLayout = ref({ left: 0, top: 0, width: 0, height: 0 });
let stageObserver = null;

const hasSelection = computed(() => {
  if (normRect.value && normRect.value.w > 0.02 && normRect.value.h > 0.02) return true;
  return polyClosed.value && polyPoints.value.length >= 3;
});

const polyDrawPoints = computed(() => {
  const box = photoLayout.value;
  if (!box.width || polyPoints.value.length < 1) return '';
  const points = polyPoints.value.slice();
  if (!polyClosed.value && polyHover.value) points.push(polyHover.value);
  if (points.length < 2) return '';
  return points.map((point) => `${box.left + point.x * box.width},${box.top + point.y * box.height}`).join(' ');
});

watch(() => props.open, async (open) => {
  if (open) {
    loadSources();
    await loadInitialAsset();
  } else {
    pickerOpen.value = false;
    viewing.value = false;
  }
});

async function loadInitialAsset() {
  const asset = props.initialAsset;
  if (!asset) return;
  try {
    let url = asset.url || '';
    if (!url && asset.fid) url = getAssetImageUrl(asset.fid, asset.mediaToken);
    if (asset.fid) fid.value = asset.fid;
    if (!url) return;
    const resp = await fetch(url);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const dataUrl = await initialBlobToDataUrl(blob);
    imageBase64.value = dataUrl;
    photoUrl.value = dataUrl;
    photoName.value = asset.name || asset.file_name || '提取材质';
  } catch (e) {
    console.warn('预载提取材质图片失败', e);
  }
}

function initialBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function seriesOfLibrary(library) {
  return SERIES.filter((row) => row.library === library);
}

function syncSeries(row) {
  const series = SERIES.find((item) => item.kind_key === row.kind_key);
  if (!series) return;
  row.library = series.library;
  row.bucket = series.library;
  row.series_zh = series.label;
  if (series.library !== 'material') row.hex = '';
}

function onLibraryChange(row) {
  const series = seriesOfLibrary(row.library);
  if (!series.some((item) => item.kind_key === row.kind_key)) {
    row.kind_key = series[0] ? series[0].kind_key : '';
  }
  syncSeries(row);
}

function clearSelection() {
  normRect.value = null;
  polyPoints.value = [];
  polyClosed.value = false;
  polyHover.value = null;
  dragging.value = false;
  dragAnchor.value = null;
}

function setTool(next) {
  tool.value = next;
  if (next === 'rect') {
    polyPoints.value = [];
    polyClosed.value = false;
    polyHover.value = null;
  } else if (next === 'polygon') {
    normRect.value = null;
    polyClosed.value = false;
  }
}

function closePoly() {
  if (polyPoints.value.length >= 3) {
    polyClosed.value = true;
    polyHover.value = null;
  }
}

function measurePhoto() {
  const stage = stageRef.value;
  const nw = nat.value.w;
  const nh = nat.value.h;
  if (!stage || !nw || !nh) {
    photoLayout.value = { left: 0, top: 0, width: 0, height: 0 };
    return;
  }
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const scale = Math.min(sw / nw, sh / nh);
  const width = nw * scale;
  const height = nh * scale;
  photoLayout.value = { left: (sw - width) / 2, top: (sh - height) / 2, width, height };
}

function bindStage() {
  if (stageObserver) stageObserver.disconnect();
  stageObserver = null;
  const stage = stageRef.value;
  if (!stage || typeof ResizeObserver === 'undefined') return;
  stageObserver = new ResizeObserver(() => measurePhoto());
  stageObserver.observe(stage);
}

function onPhotoLoad(event) {
  const img = event.target;
  nat.value = { w: img.naturalWidth || 0, h: img.naturalHeight || 0 };
  measurePhoto();
  bindStage();
}

function pointerNorm(event) {
  const box = photoLayout.value;
  const stage = stageRef.value;
  if (!stage || !box.width || !box.height) return null;
  const bounds = stage.getBoundingClientRect();
  const x = (event.clientX - bounds.left - box.left) / box.width;
  const y = (event.clientY - bounds.top - box.top) / box.height;
  if (x < -0.02 || y < -0.02 || x > 1.02 || y > 1.02) return null;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y))
  };
}

function onPointerDown(event) {
  const point = pointerNorm(event);
  if (!point) return;
  if (tool.value === 'rect') {
    dragging.value = true;
    dragAnchor.value = point;
    normRect.value = { x: point.x, y: point.y, w: 0, h: 0 };
    if (stageRef.value && stageRef.value.setPointerCapture) {
      stageRef.value.setPointerCapture(event.pointerId);
    }
  } else if (tool.value === 'polygon' && !polyClosed.value) {
    polyPoints.value = [...polyPoints.value, point];
  }
}

function onPointerMove(event) {
  const point = pointerNorm(event);
  if (tool.value === 'polygon' && point && !polyClosed.value) polyHover.value = point;
  if (!dragging.value || !dragAnchor.value || !point) return;
  const ax = dragAnchor.value.x;
  const ay = dragAnchor.value.y;
  normRect.value = {
    x: Math.min(ax, point.x),
    y: Math.min(ay, point.y),
    w: Math.abs(point.x - ax),
    h: Math.abs(point.y - ay)
  };
}

function onPointerUp() {
  dragging.value = false;
  if (normRect.value && (normRect.value.w < 0.02 || normRect.value.h < 0.02)) normRect.value = null;
}

function selectionPixels(nw, nh) {
  if (polyClosed.value && polyPoints.value.length >= 3) {
    const xs = polyPoints.value.map((point) => point.x);
    const ys = polyPoints.value.map((point) => point.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const x1 = Math.max(...xs);
    const y1 = Math.max(...ys);
    return {
      x: Math.floor(x0 * nw),
      y: Math.floor(y0 * nh),
      w: Math.max(1, Math.ceil((x1 - x0) * nw)),
      h: Math.max(1, Math.ceil((y1 - y0) * nh)),
      poly: polyPoints.value
    };
  }
  const rect = normRect.value;
  if (rect && rect.w > 0.02 && rect.h > 0.02) {
    return {
      x: Math.floor(rect.x * nw),
      y: Math.floor(rect.y * nh),
      w: Math.max(1, Math.ceil(rect.w * nw)),
      h: Math.max(1, Math.ceil(rect.h * nh)),
      poly: null
    };
  }
  return null;
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('照片还没有显示出来'));
    img.src = src;
  });
}

function normToPixels(norm, nw, nh) {
  if (!norm) return null;
  if (norm.poly && norm.poly.length >= 3) {
    return {
      x: Math.floor(norm.x * nw),
      y: Math.floor(norm.y * nh),
      w: Math.max(1, Math.ceil(norm.w * nw)),
      h: Math.max(1, Math.ceil(norm.h * nh)),
      poly: norm.poly
    };
  }
  if (norm.w > 0.02 && norm.h > 0.02) {
    return {
      x: Math.floor(norm.x * nw),
      y: Math.floor(norm.y * nh),
      w: Math.max(1, Math.ceil(norm.w * nw)),
      h: Math.max(1, Math.ceil(norm.h * nh)),
      poly: null
    };
  }
  return null;
}

async function exportSelection() {
  if (!imageBase64.value) return '';
  const img = await loadHtmlImage(imageBase64.value);
  const fromLayer = cropLayerRef.value?.getCropNorm?.() || null;
  const sel = normToPixels(fromLayer, img.naturalWidth, img.naturalHeight) || selectionPixels(img.naturalWidth, img.naturalHeight);
  if (!sel) return imageBase64.value;
  const canvas = document.createElement('canvas');
  canvas.width = sel.w;
  canvas.height = sel.h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
  if (sel.poly) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    sel.poly.forEach((point, index) => {
      const x = point.x * img.naturalWidth - sel.x;
      const y = point.y * img.naturalHeight - sel.y;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    return canvas.toDataURL('image/png');
  }
  return canvas.toDataURL('image/jpeg', 0.92);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读不到这张库内图片'));
    reader.readAsDataURL(blob);
  });
}

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `请求失败 ${res.status}`);
  return data;
}

async function loadSources() {
  try {
    const res = await authFetch('/api/base-library/catalog/sources');
    const data = await readJson(res);
    sources.value = data.data || [];
  } catch (err) {
    pullNote.value = err.message;
  }
}

async function pullBrand() {
  busy.value = true;
  pullNote.value = '';
  try {
    const res = await authFetch('/api/base-library/catalog/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adapter: adapterId.value })
    });
    const data = await readJson(res);
    pullNote.value = data.note || `解析 ${data.parsed} 条，入库 ${data.saved} 条。`;
    if (data.saved) emit('saved');
  } catch (err) {
    pullNote.value = err.message;
  } finally {
    busy.value = false;
  }
}

function onFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  photoName.value = file.name;
  fid.value = '';
  clearSelection();
  drafts.value = [];
  confirmNote.value = '';
  const reader = new FileReader();
  reader.onload = () => {
    imageBase64.value = String(reader.result || '');
    photoUrl.value = imageBase64.value;
  };
  reader.readAsDataURL(file);
}

async function onPicked(versions) {
  const version = versions && versions[0];
  pickerOpen.value = false;
  if (!version) return;
  busy.value = true;
  previewError.value = '';
  try {
    const url = version.url || getAssetOriginalUrl(version.fid);
    if (!url) throw new Error('这张素材没有图片');
    fid.value = version.fid || '';
    photoName.value = version.name || version.fid || '库内素材';
    clearSelection();
    drafts.value = [];
    confirmNote.value = '';
    const res = await authFetch(url);
    if (!res.ok) throw new Error('读不到这张库内图片');
    const dataUrl = await blobToDataUrl(await res.blob());
    imageBase64.value = dataUrl;
    photoUrl.value = dataUrl;
  } catch (err) {
    previewError.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function previewPhoto() {
  busy.value = true;
  previewError.value = '';
  confirmNote.value = '';
  try {
    const payload = await exportSelection();
    if (!payload && !fid.value) throw new Error('请先选择照片或从素材库挑选');
    distillBase64.value = payload || imageBase64.value;
    const body = distillBase64.value
      ? { image_base64: distillBase64.value }
      : { fid: fid.value.trim() };
    const res = await authFetch('/api/base-library/catalog/distill-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await readJson(res);
    drafts.value = (data.drafts || []).map((row) => ({ ...row, checked: true, brand: row.brand || '' }));
    if (!drafts.value.length) previewError.value = '这张照片里没有可入库的条目。';
  } catch (err) {
    previewError.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function confirmPhoto() {
  busy.value = true;
  confirmNote.value = '';
  try {
    const swatches = drafts.value.filter((row) => row.checked);
    const res = await authFetch('/api/base-library/catalog/distill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: distillBase64.value || imageBase64.value,
        fid: (distillBase64.value || imageBase64.value) ? '' : fid.value.trim(),
        swatches
      })
    });
    const data = await readJson(res);
    confirmNote.value = `新入库 ${data.created || 0} 条，合并 ${data.merged || 0} 条。来源记为照片。`;
    if (data.skipped) confirmNote.value += ` 跳过 ${data.skipped} 条。`;
    drafts.value = [];
    emit('saved');
  } catch (err) {
    confirmNote.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function draftScheme() {
  busy.value = true;
  schemeNote.value = '';
  try {
    const res = await authFetch('/api/base-library/schemes/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_ids: props.itemIds.slice(0, 40) })
    });
    const data = await readJson(res);
    schemeSlots.value = data.slots || [];
    if (!schemeSlots.value.length) schemeNote.value = '当前列表还组不出部位草稿。';
  } catch (err) {
    schemeNote.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function saveScheme() {
  busy.value = true;
  schemeNote.value = '';
  try {
    const res = await authFetch('/api/base-library/schemes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name_zh: schemeName.value.trim(),
        style_leaf: styleLeaf.value.trim(),
        slots: schemeSlots.value
      })
    });
    const data = await readJson(res);
    schemeNote.value = `已另存方案 ${data.data?.name_zh || schemeName.value.trim()}。`;
    schemeName.value = '';
    styleLeaf.value = '';
    emit('saved');
  } catch (err) {
    schemeNote.value = err.message;
  } finally {
    busy.value = false;
  }
}

onBeforeUnmount(() => {
  if (stageObserver) stageObserver.disconnect();
});
</script>
