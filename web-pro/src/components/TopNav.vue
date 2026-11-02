<template>
  <header class="top-bar" role="banner">
    <div class="top-brand">
      <div class="top-logo" aria-hidden="true">
        <StudioIcon name="sparkles" :size="18" />
      </div>
      <span class="sr-only">灵感空间</span>
    </div>

    <!-- 顶部主板块导航胶囊 (滑块平移跟随) -->
    <div class="top-nav-slot">
      <nav ref="sectionNav" class="top-nav" aria-label="主要板块导航">
        <div class="nav-indicator" :style="indicatorStyle" aria-hidden="true" />
        <template v-for="s in sections" :key="s.key">
          <div
            v-if="s.key === 'library'"
            class="lane-anchor"
            @mouseenter="openLaneMenu"
            @mouseleave="scheduleCloseLaneMenu"
          >
            <button
              :ref="(el) => setSectionEl(s.key, el)"
              type="button"
              class="section-tab"
              :class="{ 'is-on': activeTab === 'library' }"
              aria-haspopup="menu"
              :aria-expanded="laneMenuOpen"
              @click="chooseTab('library')"
            >
              素材库
            </button>
            <div
              v-show="laneMenuOpen"
              class="lane-panel"
              role="menu"
              aria-label="素材库一级"
              @mouseenter="openLaneMenu"
              @mouseleave="scheduleCloseLaneMenu"
            >
              <div v-for="col in laneColumns" :key="col.title" class="lane-col">
                <p class="lane-col-title">{{ col.title }}</p>
                <button
                  v-for="lane in col.items"
                  :key="lane.key"
                  type="button"
                  role="menuitem"
                  class="lane-item"
                  :class="{ 'is-on': libraryLane === lane.key }"
                  @click="chooseLane(lane.key)"
                >
                  <span class="lane-item-title">{{ lane.label }}</span>
                  <span class="lane-item-desc">{{ lane.desc }}</span>
                </button>
              </div>
            </div>
          </div>
          <button
            v-else
            :ref="(el) => setSectionEl(s.key, el)"
            type="button"
            class="section-tab"
            :class="{ 'is-on': activeTab === s.key }"
            @click="chooseTab(s.key)"
          >
            {{ s.label }}
          </button>
        </template>
      </nav>
    </div>

    <!-- 右侧系统运行指标与状态 -->
    <div class="top-tools">
      <button
        type="button"
        class="top-icon-btn"
        :class="{ 'is-on': seniorMode }"
        :aria-pressed="seniorMode"
        :title="seniorMode ? '适老关怀已开启，点击关闭' : '开启适老关怀'"
        @click="toggleSeniorMode"
      >
        <StudioIcon name="a11y" :size="20" />
        <span class="sr-only">适老关怀</span>
      </button>

      <div ref="themeNav" class="theme-switch" role="radiogroup" aria-label="主题">
        <div class="nav-indicator" :style="themeIndicator" aria-hidden="true" />
        <button
          v-for="theme in themes"
          :key="theme.key"
          :ref="(el) => setThemeEl(theme.key, el)"
          type="button"
          role="radio"
          class="section-tab theme-tab"
          :class="{ 'is-on': currentTheme === theme.key }"
          :aria-checked="currentTheme === theme.key"
          @click="setTheme(theme.key)"
        >
          {{ theme.label }}
        </button>
      </div>

      <button
        type="button"
        class="user-btn"
        :title="username ? '退出登录' : '登录'"
        @click="emit('logout')"
      >
        {{ username || '未登录' }}
      </button>
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
  activeTab: { type: String, default: 'studio' },
  libraryLane: { type: String, default: 'image' },
  username: { type: String, default: '' }
});

const emit = defineEmits(['update:activeTab', 'update:libraryLane', 'logout']);

const laneColumns = [
  {
    title: '浏览',
    items: [
      { key: 'image', label: '图片', desc: '室内外、人像、服装和单品' },
      { key: 'video', label: '视频', desc: '漫游、展示、特写和短片' },
      { key: 'audio', label: '音频', desc: '背景乐和环境音' }
    ]
  },
  {
    title: '库',
    items: [
      { key: 'base', label: '基础素材', desc: '材质、做法、选品和风格方案' },
      { key: 'clip', label: '剪辑工程', desc: '工程引用和导出成片' },
      { key: 'trash', label: '回收站', desc: '闸门拦截和人工删除' }
    ]
  }
];
const laneMenuOpen = ref(false);
let laneCloseTimer = null;
function openLaneMenu() {
  clearTimeout(laneCloseTimer);
  laneMenuOpen.value = true;
}
function scheduleCloseLaneMenu() {
  clearTimeout(laneCloseTimer);
  laneCloseTimer = setTimeout(() => { laneMenuOpen.value = false; }, 400);
}
const themes = [
  { key: 'dark', label: '暗黑' },
  { key: 'light', label: '明朗' },
  { key: 'eye-care', label: '护眼' }
];
const themeNav = ref(null);
const themeEls = {};
const themeIndicator = ref({ opacity: 0 });
function setThemeEl(key, el) {
  if (el) themeEls[key] = el;
}
function placeThemeIndicator() {
  const nav = themeNav.value;
  const el = themeEls[currentTheme.value];
  if (!nav || !el) return;
  const parent = nav.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  themeIndicator.value = {
    opacity: 1,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    transform: `translate(${rect.left - parent.left}px, ${rect.top - parent.top}px)`
  };
}
function chooseLane(key) {
  clearTimeout(laneCloseTimer);
  laneMenuOpen.value = false;
  emit('update:libraryLane', key);
  emit('update:activeTab', 'library');
  nextTick(placeIndicator);
}

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
  nextTick(() => { placeIndicator(); placeThemeIndicator(); });
  window.addEventListener('resize', placeNavIndicators);

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

function placeNavIndicators() {
  placeIndicator();
  placeThemeIndicator();
}

onUnmounted(() => {
  clearTimeout(laneCloseTimer);
  window.removeEventListener('resize', placeNavIndicators);
  if (stopStatusWatch) stopStatusWatch();
});

watch(() => props.activeTab, () => nextTick(placeIndicator));

function setTheme(theme) {
  currentTheme.value = theme;
  localStorage.setItem('material_theme', theme);
  const el = document.documentElement;
  el.classList.remove('dark', 'light', 'eye-care');
  el.classList.add(theme);
  nextTick(placeThemeIndicator);
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
