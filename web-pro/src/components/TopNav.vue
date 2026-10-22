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
      <!-- 适老关怀开关：只放大字号与控件（整页 zoom 缩放已于 2026-10-22 下架） -->
      <button
        type="button"
        @click="toggleSeniorMode"
        :title="seniorMode ? '适老关怀已开启，点击关闭' : '开启适老关怀大字模式'"
        :class="[
          'flex items-center rounded-xl border bg-studio-850 border-studio-700 shrink-0 px-3 py-1.5 cursor-pointer font-bold text-xs transition-all shadow-xs',
          seniorMode ? 'text-studio-accent' : 'text-slate-400 hover:text-slate-200'
        ]"
      >
        <span>适老{{ seniorMode ? '开' : '关' }}</span>
      </button>

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
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
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

// ===== 三级回退状态（同源网关 → 本机 → 局域网/公网）=====
const online = ref(true);
const probing = ref(false);
const serverLabelText = ref(serverLabel());
const candidatesText = listCandidates().join(' → ');
let stopStatusWatch = null;

onMounted(() => {
  const saved = localStorage.getItem('material_theme') || 'dark';
  setTheme(saved);

  // 适老关怀首次默认开；用户关掉后记住。编辑器 iframe 的 theme-sync 读同一个 key，
  // 这里把解析结果写回存储，避免"外壳开、独立打开的编辑器关"的不一致。
  seniorMode.value = localStorage.getItem('ml_senior_mode') !== 'false';
  localStorage.setItem('ml_senior_mode', seniorMode.value ? 'true' : 'false');

  applySeniorMode(seniorMode.value);
  nextTick(placeIndicator);
  window.addEventListener('resize', placeIndicator);

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
  if (stopStatusWatch) stopStatusWatch();
});

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
  applySeniorMode(seniorMode.value);
}

function applySeniorMode(enabled) {
  const el = document.documentElement;
  /*
   * 适老化不再使用 zoom（2026-10-22 下架缩放）：
   * zoom 会把 100vh / calc(100vh - Npx) 的布局整体撑溢出，页面"变形"，
   * 而且外壳缩放 + iframe 再缩放会双重放大。
   * 现在只放大文字与控件（见 style.css 的 html.senior-mode 字号规则），
   * 编辑器画布保持 100% 精确渲染。
   */
  if (enabled) {
    el.classList.add('senior-mode');
  } else {
    el.classList.remove('senior-mode');
  }
  // 全局广播通知（包括 iframe 联动）
  try {
    window.dispatchEvent(new CustomEvent('ml_senior_zoom_changed', {
      detail: { enabled, zoom: 1 }
    }));
  } catch (_) {}
}
</script>
