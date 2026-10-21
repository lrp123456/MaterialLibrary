<template>
  <header
    class="h-14 border-b border-studio-800 bg-studio-950/80 backdrop-blur-md px-4 flex items-center gap-3 shrink-0 select-none z-30 transition-all flex-wrap"
    role="banner"
  >
    <!-- 左侧 Logo 与品牌标识 -->
    <div class="flex items-center space-x-3 shrink-0">
      <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-studio-accent to-emerald-400 flex items-center justify-center text-white shadow-lg shadow-studio-accent/20">
        <StudioIcon name="sparkles" :size="18" />
      </div>
      <div>
        <h1 class="text-sm font-bold text-slate-100 tracking-wide flex items-center space-x-1.5">
          <span>灵感空间 · 室内设计素材库</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-studio-800 text-studio-accent font-mono">PRO</span>
        </h1>
      </div>
    </div>

    <!-- 顶部主板块导航胶囊 (滑块平移跟随) -->
    <nav
      ref="sectionNav"
      class="relative ml-2 flex items-center rounded-2xl bg-studio-900/90 p-1 border border-studio-800 shrink-0"
      aria-label="主要板块导航"
    >
      <div
        class="nav-indicator pointer-events-none absolute rounded-xl bg-studio-800 border border-studio-700/80 shadow-md shadow-black/40 transition-all duration-300 ease-out"
        :style="indicatorStyle"
        aria-hidden="true"
      />
      <button
        v-for="s in sections"
        :key="s.key"
        :ref="(el) => setSectionEl(s.key, el)"
        type="button"
        @click="chooseTab(s.key)"
        :class="[
          'relative z-10 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer select-none',
          activeTab === s.key ? 'text-white' : 'text-slate-400 hover:text-slate-200'
        ]"
      >
        {{ s.label }}
      </button>
    </nav>

    <!-- 右侧系统运行指标与状态 -->
    <div class="ml-auto flex items-center gap-2 text-sm shrink-0 relative">
      <!-- 适老化关怀：开关 + 自定义字号调节浮层（所有区域等比例缩放） -->
      <div class="relative flex items-center">
        <div
          class="flex items-center rounded-xl border bg-studio-850 border-studio-700 shrink-0 overflow-hidden shadow-xs"
          :title="seniorMode ? `适老关怀已开启 (${zoomPercent}%)，点击齿轮或 A− / A+ 调整全局大小` : '开启适老关怀大字模式'"
        >
          <button
            @click="toggleSeniorMode"
            :class="[
              'px-3 py-1.5 transition-all flex items-center space-x-1.5 cursor-pointer font-bold text-xs border-r border-studio-700',
              seniorMode
                ? 'bg-studio-accent/20 text-studio-accent'
                : 'text-slate-400 hover:text-slate-200'
            ]"
          >
            <span>适老{{ seniorMode ? '开' : '关' }}</span>
          </button>

          <template v-if="seniorMode">
            <button
              type="button"
              class="px-2 py-1.5 text-slate-300 hover:text-white hover:bg-studio-800 transition cursor-pointer text-sm font-bold leading-none"
              :disabled="zoomIndex === 0"
              :class="{ 'opacity-30 cursor-not-allowed': zoomIndex === 0 }"
              title="缩小 (步进 15%)"
              @click="changeZoom(-1)"
            >A−</button>

            <!-- 点击展开高级滑块浮层 -->
            <button
              type="button"
              @click="showZoomPanel = !showZoomPanel"
              class="px-2 py-1 text-[11px] font-mono text-studio-accent hover:bg-studio-800 min-w-[50px] text-center select-none cursor-pointer flex items-center justify-center gap-0.5"
              title="点击展开自定义大小滑块与快捷档位"
            >
              <span>{{ zoomPercent }}%</span>
              <span class="text-[9px]">▾</span>
            </button>

            <button
              type="button"
              class="px-2 py-1.5 text-slate-300 hover:text-white hover:bg-studio-800 transition cursor-pointer text-base font-bold leading-none border-l border-studio-700"
              :disabled="zoomIndex === ZOOM_STEPS.length - 1"
              :class="{ 'opacity-30 cursor-not-allowed': zoomIndex === ZOOM_STEPS.length - 1 }"
              title="放大 (步进 15%)"
              @click="changeZoom(1)"
            >A+</button>
          </template>
        </div>

        <!-- 自定义适老大小高级调节弹层 -->
        <div
          v-if="seniorMode && showZoomPanel"
          class="absolute top-full right-0 mt-2 p-4 w-72 rounded-2xl bg-studio-900 border border-studio-700 shadow-2xl z-50 text-slate-200 flex flex-col gap-3 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
        >
          <div class="flex items-center justify-between border-b border-studio-800 pb-2">
            <div class="flex items-center gap-1.5 font-bold text-xs text-white">
              <span>🔍 全局等比例适老缩放</span>
            </div>
            <span class="font-mono text-xs px-2 py-0.5 rounded bg-studio-accent/20 text-studio-accent font-bold">
              {{ zoomPercent }}%
            </span>
          </div>

          <!-- 无级滑块 -->
          <div class="flex flex-col gap-1.5">
            <div class="flex justify-between text-[11px] text-slate-400">
              <span>标准 100%</span>
              <span>特大 175%</span>
            </div>
            <input
              type="range"
              min="1"
              max="1.75"
              step="0.05"
              :value="seniorZoom"
              @input="onSliderChange($event)"
              class="w-full accent-studio-accent cursor-pointer h-2 bg-studio-800 rounded-lg"
            />
          </div>

          <!-- 6个快捷大字档位 -->
          <div class="flex flex-col gap-1">
            <span class="text-[11px] text-slate-400">预设档位推荐：</span>
            <div class="grid grid-cols-3 gap-1.5">
              <button
                v-for="step in ZOOM_PRESETS"
                :key="step.val"
                type="button"
                @click="setExactZoom(step.val)"
                :class="[
                  'px-2 py-1.5 rounded-lg text-xs font-bold transition-all text-center cursor-pointer',
                  Math.abs(seniorZoom - step.val) < 0.02
                    ? 'bg-studio-accent text-white shadow-xs'
                    : 'bg-studio-800 text-slate-300 hover:bg-studio-750 hover:text-white'
                ]"
              >
                {{ step.label }}
              </button>
            </div>
          </div>

          <!-- 提示说明 -->
          <div class="text-[10px] text-slate-400 bg-studio-950/60 p-2 rounded-lg border border-studio-800/80 leading-relaxed">
            💡 调整后，主系统与剪辑台内所有文字、按钮、图标与弹窗将全域等比放大，遇到屏幕边界将自适应换行排列。
          </div>
        </div>
      </div>

      <!-- 主题切换下拉胶囊 (暗黑 / 明朗 / 护眼) -->
      <div class="relative group">
        <button
          class="px-2.5 py-1.5 rounded-xl border bg-studio-850 border-studio-700 hover:border-studio-600 transition-all flex items-center space-x-1.5 text-slate-300 hover:text-white cursor-pointer"
          title="切换界面主题配色"
        >
          <span class="text-xs">
            <template v-if="currentTheme === 'dark'">🌙 暗黑</template>
            <template v-else-if="currentTheme === 'light'">☀️ 明朗</template>
            <template v-else>🍵 护眼</template>
          </span>
          <span class="text-[10px] text-slate-400">▾</span>
        </button>

        <div class="absolute right-0 top-full mt-1.5 w-28 py-1 bg-studio-850 border border-studio-700 rounded-xl shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all z-50">
          <button
            @click="setTheme('dark')"
            class="w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-studio-750 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <span>🌙</span>
            <span>暗黑模式</span>
          </button>
          <button
            @click="setTheme('light')"
            class="w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-studio-750 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <span>☀️</span>
            <span>明朗模式</span>
          </button>
          <button
            @click="setTheme('eye-care')"
            class="w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-studio-750 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <span>🍵</span>
            <span>护眼模式</span>
          </button>
        </div>
      </div>

      <!-- 后台网关连通性指示器 -->
      <div
        class="flex items-center space-x-2 px-2.5 py-1 rounded-xl border bg-studio-850 border-studio-700/80"
        :title="`候选网关: ${candidatesText}`"
      >
        <span
          class="w-2 h-2 rounded-full transition-colors"
          :class="{
            'bg-emerald-400 shadow-sm shadow-emerald-400/50': online && !probing,
            'bg-amber-400 animate-pulse': probing,
            'bg-rose-500 shadow-sm shadow-rose-500/50': !online && !probing
          }"
        />
        <span class="text-[11px] font-mono text-slate-300">
          {{ serverLabelText }}
        </span>
      </div>
    </div>
  </header>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import StudioIcon from './StudioIcon.vue';
import {
  ensureServerBase,
  listCandidates,
  // server-resolve 导出的是原名，别名只在 api.js 里做；这里直接按原名导入
  onStatusChange as onServerStatusChange,
  currentLabel as serverLabel
} from '../server-resolve.js';

const props = defineProps({
  activeTab: {
    type: String,
    default: 'studio'
  }
});

const emit = defineEmits(['update:activeTab']);

const sections = [
  { key: 'studio', label: '空间创作' },
  { key: 'library', label: '素材库' },
  { key: 'media', label: '剪辑' },
  { key: 'settings', label: '设置' }
];

const sectionNav = ref(null);
const sectionEls = {};
const indicatorStyle = ref({ opacity: 0 });

function setSectionEl(key, el) {
  if (el) sectionEls[key] = el;
}

function placeIndicator() {
  const nav = sectionNav.value;
  const el = sectionEls[props.activeTab];
  if (!nav || !el) return;
  const parent = nav.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  indicatorStyle.value = {
    opacity: 1,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    transform: `translate(${rect.left - parent.left}px, ${rect.top - parent.top}px)`
  };
}

function chooseTab(key) {
  emit('update:activeTab', key);
  nextTick(placeIndicator);
}

const currentTheme = ref('dark');
const seniorMode = ref(true);
const showZoomPanel = ref(false);

// 自定义适老缩放档位：扩大缩放范围至 100% ~ 175%
const ZOOM_STEPS = [1, 1.15, 1.3, 1.45, 1.6, 1.75];
const ZOOM_PRESETS = [
  { val: 1.0, label: '100% 标准' },
  { val: 1.15, label: '115% 紧凑' },
  { val: 1.3, label: '130% 舒适' },
  { val: 1.45, label: '145% 适老' },
  { val: 1.6, label: '160% 大字' },
  { val: 1.75, label: '175% 特大' },
];

const seniorZoom = ref(1.3); // 开启适老默认放大至 130%

const zoomIndex = computed(() => {
  let closest = 0;
  let minDiff = 999;
  for (let i = 0; i < ZOOM_STEPS.length; i++) {
    const diff = Math.abs(ZOOM_STEPS[i] - seniorZoom.value);
    if (diff < minDiff) {
      minDiff = diff;
      closest = i;
    }
  }
  return closest;
});

const zoomPercent = computed(() => Math.round(seniorZoom.value * 100));

// ===== 三级回退状态（同源网关 → 本机 → 局域网/公网）=====
const online = ref(true);
const probing = ref(false);
const serverLabelText = ref(serverLabel());
const candidatesText = listCandidates().join(' → ');
let stopStatusWatch = null;

onMounted(() => {
  const saved = localStorage.getItem('material_theme') || 'dark';
  setTheme(saved);

  const savedSenior = localStorage.getItem('ml_senior_mode');
  seniorMode.value = savedSenior === null ? true : savedSenior === 'true';

  const savedZoom = Number(localStorage.getItem('ml_senior_zoom'));
  if (savedZoom >= 1 && savedZoom <= 2.2) {
    seniorZoom.value = savedZoom;
  } else {
    seniorZoom.value = seniorMode.value ? 1.3 : 1;
  }

  applySeniorMode(seniorMode.value);
  nextTick(placeIndicator);
  window.addEventListener('resize', placeIndicator);

  // 点击外部收起面板
  window.addEventListener('click', onWindowClick);

  stopStatusWatch = onServerStatusChange((detail) => {
    online.value = !detail.allDown;
    serverLabelText.value = detail.label || serverLabel();
  });

  probing.value = true;
  ensureServerBase()
    .then((r) => { online.value = !r.allDown; serverLabelText.value = serverLabel(); })
    .catch(() => { online.value = false; })
    .finally(() => { probing.value = false; });
});

onUnmounted(() => {
  window.removeEventListener('resize', placeIndicator);
  window.removeEventListener('click', onWindowClick);
  if (stopStatusWatch) stopStatusWatch();
});

function onWindowClick(e) {
  if (showZoomPanel.value && !e.target.closest('.relative')) {
    showZoomPanel.value = false;
  }
}

watch(() => props.activeTab, () => nextTick(placeIndicator));

function setTheme(theme) {
  currentTheme.value = theme;
  localStorage.setItem('material_theme', theme);
  const el = document.documentElement;
  el.classList.remove('dark', 'light', 'eye-care');
  el.classList.add(theme);
}

function toggleSeniorMode() {
  seniorMode.value = !seniorMode.value;
  localStorage.setItem('ml_senior_mode', seniorMode.value ? 'true' : 'false');
  if (seniorMode.value && seniorZoom.value <= 1) {
    seniorZoom.value = 1.3;
    localStorage.setItem('ml_senior_zoom', '1.3');
  }
  applySeniorMode(seniorMode.value);
}

function changeZoom(dir) {
  const targetIdx = Math.min(ZOOM_STEPS.length - 1, Math.max(0, zoomIndex.value + dir));
  const next = ZOOM_STEPS[targetIdx];
  setExactZoom(next);
}

function onSliderChange(e) {
  const val = parseFloat(e.target.value);
  if (!isNaN(val)) {
    setExactZoom(val);
  }
}

function setExactZoom(val) {
  seniorZoom.value = val;
  localStorage.setItem('ml_senior_zoom', String(val));
  applySeniorMode(seniorMode.value);
}

function applySeniorMode(enabled) {
  const el = document.documentElement;
  const effectiveZoom = seniorZoom.value > 1 ? seniorZoom.value : 1;
  if (enabled) {
    el.classList.add('senior-mode');
    el.style.zoom = String(effectiveZoom);
    el.style.setProperty('--senior-scale', String(effectiveZoom));
  } else {
    el.classList.remove('senior-mode');
    el.style.zoom = '';
    el.style.removeProperty('--senior-scale');
  }
  // 全局广播通知（包括 iframe 联动）
  try {
    window.dispatchEvent(new CustomEvent('ml_senior_zoom_changed', {
      detail: { enabled, zoom: enabled ? effectiveZoom : 1 }
    }));
  } catch (_) {}
}
</script>
