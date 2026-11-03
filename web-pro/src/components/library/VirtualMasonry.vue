<template>
  <div ref="rootRef" class="vm-root" :class="mode === 'grid' ? 'vm-grid' : 'vm-masonry'" :style="rootStyle">
    <div
      v-for="(col, ci) in columns"
      :key="ci"
      class="vm-col"
      :style="{ flexBasis: colWidth + 'px', flexGrow: 0, flexShrink: 1, minWidth: 0 }"
    >
      <div :style="{ height: col.topPad + 'px' }" aria-hidden="true"></div>
      <div
        v-for="entry in col.items"
        :key="entry.item.fid"
        class="vm-card-slot"
        :style="slotStyle(entry, col)"
        :data-fid="entry.item.fid"
      >
        <slot :item="entry.item" />
      </div>
      <div :style="{ height: col.bottomPad + 'px' }" aria-hidden="true"></div>
    </div>
  </div>
</template>

<script setup>
/**
 * VirtualMasonry —— 瀑布流/网格保守窗口渲染
 *
 * 设计取舍（见 B7 报告）：
 * 原画廊用 CSS multi-column（columns-N + break-inside-avoid）做瀑布流，
 * 浏览器靠列高平衡排布，无法在不重排全部列的前提下裁掉屏外卡片。本组件把
 * 「列」显式化：按 estimateHeight 贪心把卡片分到最短列（masonry）或按行
 * 均分（grid），每列只渲染视口上下各 buffer px 窗口内的卡片，其余由
 * 上下占位 div 撑起总高。视觉样式（列数断点、16px 间隙、卡片 class）与
 * 旧实现保持一致，卡片内容由默认作用域插槽原样传入。
 *
 * 屏外节点从 DOM 移除（不仅是跳过绘制），长会话数千卡片只保留
 * （视口+缓冲）内的真实节点；图片懒加载行为不变。
 *
 * 高度修正：卡片挂载后 ResizeObserver 量真实高度修正预估值，避免占位偏差
 * 导致的重叠；列分配不在滚动/加载后重平衡（避免卡片跳列），仅修正占位。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  items: { type: Array, default: () => [] },
  mode: { type: String, default: 'masonry' }, // 'masonry' | 'grid'
  // 滚动容器（LibraryView 的 scrollContainerRef）
  scrollContainer: { type: [Object, null], default: null },
  // (item, colWidth) => 卡片预估总高 px
  estimateHeight: { type: Function, required: true },
  gap: { type: Number, default: 16 },
  // 视口上下各多渲染的缓冲
  buffer: { type: Number, default: 900 },
  // 安全阀：异常估算下单列最多挂载的卡片数
  maxRenderPerCol: { type: Number, default: 400 },
});

const rootRef = ref(null);
const width = ref(0);
const viewportH = ref(0);
const scrollTop = ref(0);
const correctionVersion = ref(0);

// fid -> 实际高度 - 预估高度（masonry 用；grid 行高强制，不需要修正）
const corrections = new Map();

// ---- 列数：复刻 Tailwind 断点（基于视口宽度，与旧 class 行为一致） ----
function colsForMode(mode, w) {
  if (mode === 'grid') {
    if (w >= 1280) return 6;
    if (w >= 1024) return 5;
    if (w >= 640) return 4;
    return 2;
  }
  // masonry: base 2 / sm 2 / md 3 / lg 4 / xl 5 / 2xl 6
  if (w >= 1536) return 6;
  if (w >= 1280) return 5;
  if (w >= 1024) return 4;
  if (w >= 768) return 3;
  return 2;
}
const colCount = computed(() => colsForMode(props.mode, typeof window === 'undefined' ? 1280 : window.innerWidth));
const colWidth = computed(() => {
  if (!width.value || colCount.value <= 1) return width.value;
  return (width.value - (colCount.value - 1) * props.gap) / colCount.value;
});

// ---- 分布：每张卡片带上预估值；masonry 贪心最短列，grid 按行取最大高 ----
const distribution = computed(() => {
  const cols = colCount.value;
  const columns = Array.from({ length: cols }, () => ({ items: [], h: 0 }));
  if (props.mode === 'grid') {
    for (let r = 0; r < props.items.length; r += cols) {
      const rowItems = props.items.slice(r, r + cols);
      let rowH = 0;
      for (const it of rowItems) {
        const h = Math.max(40, props.estimateHeight(it, colWidth.value || 0));
        if (h > rowH) rowH = h;
      }
      rowItems.forEach((it, j) => {
        columns[j].items.push({ item: it, est: rowH });
        columns[j].h += rowH;
      });
    }
  } else {
    for (const item of props.items) {
      const h = Math.max(40, props.estimateHeight(item, colWidth.value || 0));
      let target = 0;
      for (let c = 1; c < cols; c++) {
        if (columns[c].h < columns[target].h) target = c;
      }
      columns[target].items.push({ item, est: h });
      columns[target].h += h;
    }
  }
  return columns;
});

function entryH(entry) {
  if (props.mode === 'grid') return entry.est;
  const c = corrections.get(entry.item.fid) || 0;
  return entry.est + c;
}

// pos(i) = 第 i 张卡片顶部偏移（含其之前每张卡片的 gap）
function buildPositions(col) {
  const pos = new Array(col.items.length + 1);
  pos[0] = 0;
  for (let i = 0; i < col.items.length; i++) {
    pos[i + 1] = pos[i] + entryH(col.items[i]) + props.gap;
  }
  // 末张卡片后没有 gap：总高在最后一张底部
  return pos;
}

function lowerBound(pos, target) {
  let lo = 0, hi = pos.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pos[mid] < target) lo = mid + 1; else hi = mid;
  }
  return Math.max(0, lo - 1);
}

const rendered = computed(() => {
  // 依赖修正版本号：真实高度变化后重算窗口与占位
  void correctionVersion.value;
  const container = props.scrollContainer;
  const root = rootRef.value;
  const result = distribution.value.map((col) => {
    const out = { items: [], topPad: 0, bottomPad: 0, totalH: 0 };
    if (!col.items.length) return out;
    const pos = buildPositions(col);
    const totalH = pos[col.items.length] - props.gap;
    out.totalH = totalH;
    // 首帧（宽度未测出/容器未就绪）保守渲染前一屏，避免闪现全量
    if (!root || !container || width.value <= 0) {
      const warm = Math.min(col.items.length, 12);
      out.items = col.items.slice(0, warm);
      out.topPad = 0;
      out.bottomPad = Math.max(0, totalH - (pos[warm] - props.gap));
      return out;
    }
    const cRect = container.getBoundingClientRect();
    const rRect = root.getBoundingClientRect();
    const sectionTop = rRect.top - cRect.top + scrollTop.value;
    const localTop = scrollTop.value - props.buffer - sectionTop;
    const localBottom = scrollTop.value + viewportH.value + props.buffer - sectionTop;
    let k = lowerBound(pos, localTop);
    let end = k;
    while (end < col.items.length && pos[end] < localBottom) end++;
    if (end === k) end = Math.min(col.items.length, k + 1);
    // 安全阀
    if (end - k > props.maxRenderPerCol) end = k + props.maxRenderPerCol;
    out.items = col.items.slice(k, end);
    const renderedH = pos[end] - pos[k] - props.gap;
    out.topPad = Math.max(0, pos[k]);
    out.bottomPad = Math.max(0, totalH - pos[k] - renderedH);
    return out;
  });
  return result;
});

// 模板用：列数据合并渲染切片
const columns = computed(() => distribution.value.map((col, ci) => {
  const slice = rendered.value[ci];
  return {
    items: slice.items,
    topPad: slice.topPad,
    bottomPad: slice.bottomPad,
  };
}));

const rootHeight = computed(() => {
  const r = rendered.value;
  let max = 0;
  for (const c of r) if (c.totalH > max) max = c.totalH;
  return max;
});

const rootStyle = computed(() => ({
  columnGap: props.gap + 'px',
  height: rootHeight.value ? rootHeight.value + 'px' : 'auto',
}));

function slotStyle(entry, col) {
  const idx = col.items.indexOf(entry);
  return {
    height: props.mode === 'grid' ? entry.est + 'px' : 'auto',
    marginTop: idx > 0 ? props.gap + 'px' : 0,
  };
}

// ---- 真实高度测量：post-render 对账当前窗口里的卡片，避免函数 ref 抖动 ----
let resizeObs = null;
const cardEls = new Map(); // fid -> slot 元素

function reconcileCardObservers() {
  if (!resizeObs || !rootRef.value) return;
  if (props.mode === 'grid') return; // 行高强制，无需修正
  const estByFid = new Map();
  for (const col of distribution.value) {
    for (const e of col.items) estByFid.set(e.item.fid, e.est);
  }
  const live = rootRef.value.querySelectorAll('.vm-card-slot');
  const liveFids = new Set();
  for (const el of live) {
    const fid = el.dataset.fid;
    liveFids.add(fid);
    const est = estByFid.get(fid);
    if (!cardEls.has(fid)) {
      el.__vmFid = fid;
      el.__vmEst = est;
      cardEls.set(fid, el);
      measuredEls.add(el);
      resizeObs.observe(el);
    } else {
      el.__vmEst = est;
    }
  }
  for (const [fid, el] of cardEls) {
    if (!liveFids.has(fid)) {
      resizeObs.unobserve(el);
      measuredEls.delete(el);
      cardEls.delete(fid);
    }
  }
}

let measureQueued = false;
function flushMeasures() {
  measureQueued = false;
  if (props.mode === 'grid') return;
  let changed = false;
  for (const el of measuredEls) {
    const fid = el.__vmFid;
    if (fid == null) continue;
    const real = el.offsetHeight;
    if (real > 0) {
      const delta = real - el.__vmEst;
      const prev = corrections.get(fid) || 0;
      if (Math.abs(delta - prev) > 1) {
        corrections.set(fid, delta);
        changed = true;
      }
    }
  }
  if (changed) correctionVersion.value++;
}
const measuredEls = new Set();

function scheduleMeasure() {
  if (measureQueued) return;
  measureQueued = true;
  requestAnimationFrame(flushMeasures);
}

// ---- 共享滚动帧：同容器多实例每帧只统一更新一次 ----
const hosts = new Set();
let frameQueued = false;
function queueHostFrame() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    for (const host of hosts) host();
  });
}

function updateMetrics() {
  const container = props.scrollContainer || fallbackContainer();
  if (!container || !rootRef.value) return;
  width.value = rootRef.value.clientWidth;
  const vh = container.clientHeight;
  if (vh) viewportH.value = vh;
  scrollTop.value = container.scrollTop || 0;
}

let rootObserver = null;
let mediaListener = null;

function fallbackContainer() {
  return rootRef.value ? rootRef.value.closest('.library-scroll') : null;
}

function onScroll() {
  queueHostFrame();
}

onMounted(() => {
  updateMetrics();

  resizeObs = new ResizeObserver((entries) => {
    for (const e of entries) measuredEls.add(e.target);
    scheduleMeasure();
  });

  rootObserver = new ResizeObserver(() => {
    width.value = rootRef.value ? rootRef.value.clientWidth : 0;
    queueHostFrame();
  });
  rootObserver.observe(rootRef.value);

  const container = props.scrollContainer || fallbackContainer();
  if (container) {
    container.addEventListener('scroll', onScroll, { passive: true });
    // 容器自身尺寸（侧栏折叠/窗口高度变化）
    rootObserver.observe(container);
  }

  mediaListener = () => queueHostFrame();
  window.addEventListener('resize', mediaListener);

  hosts.add(updateMetrics);
  // 首帧布局后再算一次（此时宽度/位置才真实），并补挂首批卡片的测量
  requestAnimationFrame(() => {
    updateMetrics();
    reconcileCardObservers();
  });
});

onBeforeUnmount(() => {
  hosts.delete(updateMetrics);
  const container = props.scrollContainer || fallbackContainer();
  if (container) container.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', mediaListener);
  if (resizeObs) resizeObs.disconnect();
  if (rootObserver) rootObserver.disconnect();
  measuredEls.clear();
  cardEls.clear();
});

// 渲染窗口变化后对账卡片高度观察者（post：DOM 已更新）
watch(rendered, () => reconcileCardObservers(), { flush: 'post' });

// 模式/列数/宽度变化使历史实测高度失效（列宽变了，卡片高度随之变化）
watch([() => props.mode, colCount, width], () => {
  corrections.clear();
  correctionVersion.value++;
  queueHostFrame();
});

// 追加分页/刷新数据：保留已有高度修正，仅重排窗口
watch(() => props.items, () => {
  queueHostFrame();
});
</script>

<style>
/* 结构样式全局化（vm- 前缀防冲突）：保持与旧 columns/grid 布局相同的列间隙 */
.vm-root {
  display: flex;
  align-items: flex-start;
  width: 100%;
}
.vm-col {
  min-width: 0;
}
.vm-card-slot {
  width: 100%;
}
/* grid 模式：行内卡片等高（旧 CSS grid align-stretch 行为） */
.vm-grid .vm-card-slot > * {
  height: 100%;
}
</style>
