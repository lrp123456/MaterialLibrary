<template>
  <header class="h-[56px] bg-studio-900 border-b border-studio-700 px-4 flex items-center gap-3 select-none z-50 shrink-0 font-sans whitespace-nowrap overflow-hidden">
    <div class="flex items-center gap-2 shrink-0">
      <div class="w-9 h-9 rounded-xl bg-studio-accent flex items-center justify-center shadow-sm">
        <StudioIcon name="wand" :size="20" />
      </div>
      <span class="text-base font-extrabold tracking-tight text-slate-100">工坊</span>
    </div>

    <nav ref="sectionNav" class="relative flex items-center gap-1 p-1 rounded-xl border border-studio-700 bg-studio-950 shrink-0">
      <span class="nav-indicator" :style="indicatorStyle"></span>
      <button
        v-for="tab in sections"
        :key="tab.key"
        :ref="(el) => setSectionEl(tab.key, el)"
        type="button"
        class="section-tab"
        :class="{ 'is-on': activeTab === tab.key }"
        @click="chooseTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <!-- 右侧系统运行指标与状态 -->
    <div class="ml-auto flex items-center gap-2 text-sm shrink-0">
      <!-- 适老化大字关怀开关 (默认开启) -->
      <button
        @click="toggleSeniorMode"
        :class="[
          'px-3 py-1.5 rounded-xl border transition-all flex items-center space-x-1.5 cursor-pointer font-bold text-xs',
          seniorMode
            ? 'bg-studio-accent/20 border-studio-accent text-studio-accent shadow-xs'
            : 'bg-studio-850 border-studio-700 text-slate-400 hover:text-slate-200'
        ]"
        title="开启/关闭 适老关怀大字模式 (护眼大字、增大按钮，降低眼疲劳)"
      >
        <span>适老{{ seniorMode ? '开' : '关' }}</span>
      </button>

      <!-- 主题切换下拉胶囊 (暗黑 / 明朗 / 护眼) -->
      <div class="flex items-center bg-studio-850 p-1 rounded-xl border border-studio-700 text-xs font-bold">
        <button
          @click="setTheme('dark')"
          :class="[
            'px-2.5 py-1 rounded-lg transition-all flex items-center space-x-1 cursor-pointer',
            currentTheme === 'dark' ? 'bg-studio-accent text-white shadow font-bold' : 'text-slate-400 hover:text-slate-200'
          ]"
          title="专业暗黑模式"
        >
          <span>暗黑</span>
        </button>

        <button
          @click="setTheme('light')"
          :class="[
            'px-2.5 py-1 rounded-lg transition-all flex items-center space-x-1 cursor-pointer',
            currentTheme === 'light' ? 'bg-studio-accent text-white shadow font-bold' : 'text-slate-400 hover:text-slate-200'
          ]"
          title="清爽明朗高对比模式"
        >
          <span>明朗</span>
        </button>

        <button
          @click="setTheme('eye-care')"
          :class="[
            'px-2.5 py-1 rounded-lg transition-all flex items-center space-x-1 cursor-pointer',
            currentTheme === 'eye-care' ? 'bg-studio-accent text-white shadow font-bold' : 'text-slate-400 hover:text-slate-200'
          ]"
          title="低蓝光温润护眼模式 (适合老年人与长时间作业)"
        >
          <span>护眼</span>
        </button>
      </div>

      <!-- 引擎状态 -->
      <div class="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-studio-850 border border-studio-700 text-slate-200">
        <span class="w-2.5 h-2.5 rounded-full bg-studio-emerald animate-pulse"></span>
        <span class="font-mono text-xs font-semibold text-emerald-400">网关</span>
      </div>

      <!-- 用户身份 -->
      <div class="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-studio-850 border border-studio-700">
        <StudioIcon name="user" :size="15" class="text-slate-300" />
        <span class="text-slate-100 text-xs font-semibold">设计管理员</span>
      </div>
    </div>
  </header>
</template>

<script setup>
import { ref, onMounted, nextTick, watch } from 'vue';
import StudioIcon from './StudioIcon.vue';

const props = defineProps({
  activeTab: { type: String, required: true }
});

const emit = defineEmits(['update:activeTab']);

const sections = [
  { key: 'library', label: '素材库' },
  { key: 'studio', label: '创作' },
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

onMounted(() => {
  const saved = localStorage.getItem('material_theme') || 'dark';
  setTheme(saved);

  const savedSenior = localStorage.getItem('ml_senior_mode');
  seniorMode.value = savedSenior === null ? true : savedSenior === 'true';
  applySeniorMode(seniorMode.value);
  nextTick(placeIndicator);
  window.addEventListener('resize', placeIndicator);
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
  if (enabled) {
    el.classList.add('senior-mode');
  } else {
    el.classList.remove('senior-mode');
  }
}
</script>
