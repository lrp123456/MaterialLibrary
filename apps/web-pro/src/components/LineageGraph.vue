<template>
  <div
    ref="rootEl"
    class="lineage-graph"
    role="dialog"
    aria-modal="true"
    aria-label="素材血缘图"
    tabindex="-1"
  >
    <header class="graph-bar">
      <h2 class="graph-title">{{ centerName || '这张素材' }}</h2>
      <div class="graph-switches" role="group" aria-label="显示哪些关系">
        <button
          v-for="item in kindSwitches"
          :key="item.key"
          type="button"
          class="graph-switch"
          :class="{ 'is-on': flags[item.key] }"
          :aria-pressed="flags[item.key]"
          @click="flags[item.key] = !flags[item.key]"
        >
          <span class="switch-mark" :style="{ '--mark': item.color }"></span>
          <span>{{ item.label }}</span>
          <span class="switch-state">{{ flags[item.key] ? '当前' : '关' }}</span>
        </button>
        <button
          type="button"
          class="graph-switch graph-switch-extra"
          :class="{ 'is-on': extraRing }"
          :aria-pressed="extraRing"
          @click="extraRing = !extraRing"
        >
          <span class="switch-mark"></span>
          <span>再加一圈</span>
          <span class="switch-state">{{ extraRing ? '当前' : '关' }}</span>
        </button>
      </div>
      <div class="graph-actions">
        <button type="button" class="graph-open" :disabled="!centerFid" @click="emitOpen">打开这张</button>
        <button type="button" class="graph-close" @click="$emit('close')">关闭</button>
      </div>
    </header>

    <p v-if="gapLine" class="graph-gaps">{{ gapLine }}</p>
    <p v-if="extraNote" class="graph-gaps">{{ extraNote }}</p>
    <p v-if="errorText" class="graph-error">
      {{ errorText }}
      <button type="button" class="graph-retry" @click="reloadCenter">再读一次</button>
    </p>
    <p v-else-if="loading" class="graph-gaps">正在读取这张的关系</p>

    <div ref="stageEl" class="graph-stage">
      <svg class="graph-edges" :viewBox="`0 0 ${stageW} ${stageH}`" aria-hidden="true">
        <g v-for="(edge, index) in edges" :key="index">
          <line
            :x1="edge.x1"
            :y1="edge.y1"
            :x2="edge.x2"
            :y2="edge.y2"
            :stroke="edge.color"
            stroke-width="1.5"
          />
          <rect
            :x="edge.mx - edge.label.length * 7"
            :y="edge.my - 10"
            :width="edge.label.length * 14"
            height="18"
            rx="9"
            fill="#0A0E17"
          />
          <text :x="edge.mx" :y="edge.my" text-anchor="middle" :fill="edge.color">{{ edge.label }}</text>
        </g>
      </svg>

      <component
        :is="node.ring === 0 || node.sameAsset ? 'div' : 'button'"
        v-for="node in placedNodes"
        :key="node.fid"
        :type="node.ring === 0 || node.sameAsset ? undefined : 'button'"
        class="graph-card"
        :class="{ 'is-center': node.ring === 0, 'is-far': node.ring === 2, 'is-version': node.sameAsset }"
        :style="{ left: node.x + 'px', top: node.y + 'px' }"
        :aria-label="node.ring === 0 ? node.name : '把' + node.name + '放到中心'"
        @click="onNodeClick(node)"
      >
        <img
          v-if="!broken[node.fid]"
          :src="thumb(node)"
          alt=""
          class="graph-thumb"
          @error="broken[node.fid] = true"
        />
        <div v-else class="graph-thumb graph-thumb-empty">无预览</div>
        <p class="graph-name">{{ node.name }}</p>
        <p v-if="node.fid === previousFid" class="graph-back">刚才的中心</p>
        <p v-else-if="node.ring !== 0 && cardKind(node)" class="graph-kind" :style="{ color: kindColor(cardKind(node)) }">
          {{ kindText(node) }}
        </p>
      </component>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { fetchAssetDetail, getAssetImageUrl, getDerivativeImageUrl } from '../api.js';
import {
  KIND_COLOR,
  KIND_LABEL,
  layoutGraph,
  mergeRelations,
  relationsOf,
  secondRing,
  versionNodes,
  visibleKind
} from './lineage-graph-layout.js';

const props = defineProps({
  fid: { type: String, required: true },
  name: { type: String, default: '' },
  lineage: { type: Object, default: null },
  derivatives: { type: Array, default: () => [] }
});

const emit = defineEmits(['close', 'open-detail']);

const rootEl = ref(null);
const stageEl = ref(null);
const stageW = ref(960);
const stageH = ref(640);
const centerFid = ref(props.fid);
const previousFid = ref('');
const centerName = ref(props.name || '');
const packs = reactive({});
const versions = reactive({});
const flags = reactive({ parent: true, child: true, ref: true, edit: true });
const extraRing = ref(false);
const loading = ref(false);
const errorText = ref('');
const extraNote = ref('');
const broken = reactive({});
let loadGen = 0;
let observer;

const kindSwitches = [
  { key: 'parent', label: '父图', color: KIND_COLOR.parent },
  { key: 'ref', label: '参考', color: KIND_COLOR.ref },
  { key: 'child', label: '衍生', color: KIND_COLOR.child },
  { key: 'edit', label: '剪辑使用', color: KIND_COLOR.edit }
];

const directAll = computed(() => {
  const lineage = packs[centerFid.value];
  return mergeRelations(relationsOf(lineage)).filter((node) => node.fid !== centerFid.value);
});

const versionRing = computed(() => {
  if (!flags.child) return [];
  return versionNodes(versions[centerFid.value]).map((node) => ({
    ...node,
    imageUrl: getDerivativeImageUrl(centerFid.value, node.derivativeId)
  }));
});

const ring1 = computed(() => [
  ...directAll.value.filter((node) => visibleKind(node, flags)),
  ...versionRing.value
]);

const ring2 = computed(() => {
  if (!extraRing.value) return [];
  return secondRing(ring1.value, packs, flags, centerFid.value).slice(0, 24);
});

const gapLine = computed(() => {
  const bits = [];
  for (const item of kindSwitches) {
    if (!flags[item.key]) continue;
    const has = directAll.value.some((node) => node.kinds.includes(item.key))
      || (item.key === 'child' && versionNodes(versions[centerFid.value]).length > 0);
    if (!has) bits.push(`${item.label}：没有`);
  }
  return bits.join(' · ');
});

const layout = computed(() => layoutGraph({
  center: { fid: centerFid.value, name: centerName.value || centerFid.value, kinds: [], notes: [] },
  ring1: ring1.value,
  ring2: ring2.value,
  width: stageW.value,
  height: stageH.value
}));

const placedNodes = computed(() => layout.value.nodes);

const edges = computed(() => {
  const byId = new Map(placedNodes.value.map((node) => [node.fid, node]));
  const center = byId.get(centerFid.value);
  if (!center) return [];
  const list = [];
  const push = (from, to, node) => {
    const kind = visibleKind(node, flags);
    if (!kind || !from || !to) return;
    const label = KIND_LABEL[kind];
    list.push({
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      mx: (from.x + to.x) / 2,
      my: (from.y + to.y) / 2 - 8,
      color: KIND_COLOR[kind],
      label
    });
  };
  for (const node of ring1.value) push(center, byId.get(node.fid), node);
  for (const node of ring2.value) push(byId.get(node.via), byId.get(node.fid), node);
  return list;
});

function thumb(node) {
  // 血缘图节点头像是小尺寸圆形缩略图，用 256px grid 档即可
  return (node && node.imageUrl) || getAssetImageUrl(node && node.fid, '', 'grid');
}

function cardKind(node) {
  return visibleKind(node, flags);
}

function kindColor(kind) {
  return KIND_COLOR[kind] || '#e2e8f0';
}

function kindText(node) {
  const kind = cardKind(node);
  const note = (node.notes || []).filter(Boolean).join(' ');
  return note ? `${KIND_LABEL[kind]} ${note}` : KIND_LABEL[kind];
}

function emitOpen() {
  emit('open-detail', { fid: centerFid.value, name: centerName.value });
}

function onNodeClick(node) {
  if (!node || node.ring === 0 || node.sameAsset) return;
  // 已删除（回收站中或已彻底清除）的节点不可再居中，避免触发「关系没有读出来」
  if (node.missing) return;
  recenter(node);
}

async function attachEditNames(lineage) {
  const known = new Map();
  const remember = (asset) => {
    if (asset && asset.fid && asset.file_name) known.set(asset.fid, asset.file_name);
  };
  remember(lineage.parent);
  (lineage.refs || []).forEach(remember);
  (lineage.children || []).forEach(remember);
  (lineage.usedByFilms || []).forEach(remember);
  const uses = (lineage.record && lineage.record.editUses) || [];
  const pending = uses.filter((use) => use && use.fid && !use.file_name && !known.has(use.fid)).slice(0, 12);
  await Promise.all(pending.map(async (use) => {
    try {
      const detail = await fetchAssetDetail(use.fid);
      use.file_name = (detail && detail.asset && detail.asset.file_name) || use.fid;
    } catch {
      use.file_name = use.fid;
    }
  }));
  for (const use of uses) {
    if (use && use.fid && !use.file_name && known.has(use.fid)) use.file_name = known.get(use.fid);
  }
  return lineage;
}

async function loadCenter(fid, seed) {
  const gen = ++loadGen;
  loading.value = true;
  errorText.value = '';
  try {
    let lineage = seed;
    let name = '';
    if (!lineage) {
      const detail = await fetchAssetDetail(fid);
      lineage = detail && detail.lineage;
      name = (detail && detail.asset && detail.asset.file_name) || '';
      versions[fid] = (detail && detail.derivatives) || [];
    }
    if (gen !== loadGen) return;
    if (!lineage) {
      errorText.value = '库里没有这张的血缘。';
      return;
    }
    const named = await attachEditNames(JSON.parse(JSON.stringify(lineage)));
    if (gen !== loadGen) return;
    packs[fid] = named;
    centerFid.value = fid;
    centerName.value = (named.self && named.self.file_name) || name || centerName.value || fid;
  } catch (err) {
    if (gen !== loadGen) return;
    // 中心素材已被删除（软删在回收站 / 已彻底清除）：给出可操作提示，而非通用读取失败
    if (err && /HTTP\s*404|404/.test(String(err.message || ''))) {
      errorText.value = '这张素材已删除（可能在回收站中），恢复后可查看血缘。';
    } else {
      errorText.value = '这张的关系没有读出来。';
    }
  } finally {
    if (gen === loadGen) loading.value = false;
  }
}

function reloadCenter() {
  delete packs[centerFid.value];
  loadCenter(centerFid.value, null);
}

async function recenter(node) {
  if (!node || node.fid === centerFid.value) return;
  previousFid.value = centerFid.value;
  centerName.value = node.name || node.fid;
  await loadCenter(node.fid, packs[node.fid] || null);
}

async function ensureOuter() {
  if (!extraRing.value) {
    extraNote.value = '';
    return;
  }
  const realRing = ring1.value.filter((node) => !node.sameAsset);
  const hosts = realRing.slice(0, 8);
  const missed = [];
  await Promise.all(hosts.map(async (node) => {
    if (packs[node.fid]) return;
    try {
      const detail = await fetchAssetDetail(node.fid);
      if (detail && detail.lineage) packs[node.fid] = detail.lineage;
      else missed.push(node.fid);
    } catch {
      missed.push(node.fid);
    }
  }));
  const notes = [];
  if (realRing.length > 8) notes.push('再加一圈只展开前 8 张');
  if (!extraRing.value) return;
  if (missed.length) notes.push('有的外圈没有读出来');
  else if (hosts.length && secondRing(hosts, packs, flags, centerFid.value).length === 0) {
    notes.push('外圈没有更远的关系');
  }
  extraNote.value = notes.join(' · ');
}

watch(extraRing, () => { ensureOuter(); });
watch(ring1, () => { if (extraRing.value) ensureOuter(); });

watch(() => props.fid, (fid) => {
  if (!fid) return;
  previousFid.value = '';
  extraRing.value = false;
  extraNote.value = '';
  flags.parent = true;
  flags.child = true;
  flags.ref = true;
  flags.edit = true;
  centerFid.value = fid;
  centerName.value = props.name || '';
  const seed = props.lineage && (!props.lineage.self || props.lineage.self.fid === fid) ? props.lineage : null;
  loadCenter(fid, seed);
}, { immediate: true });

watch(() => [props.fid, props.derivatives], () => {
  if (props.fid) versions[props.fid] = props.derivatives || [];
}, { immediate: true });

watch(() => props.lineage, (lineage) => {
  if (!lineage || centerFid.value !== props.fid || packs[props.fid]) return;
  loadCenter(props.fid, lineage);
});

function measure() {
  const el = stageEl.value;
  if (!el) return;
  stageW.value = Math.max(40, el.clientWidth);
  stageH.value = Math.max(40, el.clientHeight);
}

onMounted(() => {
  rootEl.value?.focus();
  measure();
  observer = new ResizeObserver(measure);
  if (stageEl.value) observer.observe(stageEl.value);
});

onUnmounted(() => {
  if (observer) observer.disconnect();
});
</script>

<style scoped>
.lineage-graph {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 18px 12px;
  background: #0A0E17;
  color: #f8fafc;
  caret-color: #06B6D4;
}
.lineage-graph ::selection {
  background: #6366F1;
  color: #ffffff;
}
.lineage-graph :focus-visible {
  outline: 2px solid #06B6D4;
  outline-offset: 2px;
}
.graph-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}
.graph-title {
  margin: 0;
  font-size: 1.25rem;
  line-height: 1.3;
  font-weight: 750;
  letter-spacing: -0.02em;
  max-width: 28rem;
}
.graph-switches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
}
.graph-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid #334155;
  border-radius: 999px;
  background: transparent;
  color: #e2e8f0;
  font-size: 13px;
  font-weight: 700;
}
.graph-switch.is-on {
  background: #182236;
  color: #f8fafc;
}
.switch-mark {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  border: 1.5px solid currentColor;
  flex: none;
}
.graph-switch.is-on .switch-mark {
  background: var(--mark, #6366F1);
  border-color: var(--mark, #6366F1);
}
.switch-state {
  font-size: 12px;
  color: #06B6D4;
}
.graph-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
.graph-open {
  min-height: 36px;
  padding: 8px 14px;
  border: 0;
  border-radius: 10px;
  background: #6366F1;
  color: #ffffff;
  font-size: 14px;
  font-weight: 750;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
}
.graph-open:disabled {
  opacity: 0.45;
}
.graph-close,
.graph-retry {
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid #334155;
  border-radius: 10px;
  background: transparent;
  color: #e2e8f0;
  font-size: 14px;
  font-weight: 700;
}
.graph-gaps,
.graph-error {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
  color: #e2e8f0;
}
.graph-error {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #F59E0B;
}
.graph-stage {
  position: relative;
  flex: 1;
  min-height: 280px;
  overflow: hidden;
}
.graph-edges {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.graph-edges text {
  font-size: 12px;
  font-weight: 750;
}
.graph-card {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 148px;
  padding: 8px;
  border: 1px solid #334155;
  border-radius: 14px;
  background: #182236;
  color: #f8fafc;
  text-align: left;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.38);
  transition: left 280ms cubic-bezier(0.16, 1, 0.3, 1), top 280ms cubic-bezier(0.16, 1, 0.3, 1);
}
.graph-card.is-center,
.graph-card.is-version {
  cursor: default;
}
.graph-card.is-center {
  width: 176px;
  border-color: #e2e8f0;
}
.graph-card.is-far {
  width: 132px;
}
.graph-thumb {
  display: block;
  width: 100%;
  height: 78px;
  object-fit: cover;
  border-radius: 8px;
  background: #131A29;
}
.graph-thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 700;
}
.graph-name {
  margin: 6px 0 0;
  font-size: 13px;
  font-weight: 750;
  line-height: 1.35;
  max-height: 2.7em;
  overflow: hidden;
}
.graph-kind,
.graph-back {
  margin: 2px 0 0;
  font-size: 12px;
  font-weight: 700;
}
.graph-back {
  color: #e2e8f0;
}
@media (max-width: 720px) {
  .graph-actions {
    margin-left: 0;
    width: 100%;
  }
  .graph-card,
  .graph-card.is-center,
  .graph-card.is-far {
    width: 112px;
  }
  .graph-thumb {
    height: 58px;
  }
}
</style>
