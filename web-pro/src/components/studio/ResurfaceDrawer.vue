<template>
  <div class="resurface-drawer flex flex-col gap-3 text-slate-100 select-none text-xs">
    <!-- 1. 顶部：部位指示与切换 (含 JEV 快速候选胶囊) -->
    <div class="p-2.5 rounded-xl bg-studio-900 border border-studio-800 flex flex-col gap-1.5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full" :class="uncertain ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'"></span>
          <span class="font-bold text-slate-200 text-xs">{{ headerTitle }}</span>
          <span v-if="!uncertain && confidencePercent" class="text-[10px] font-mono text-studio-cyan bg-studio-cyan/10 px-1.5 py-0.2 rounded border border-studio-cyan/20">
            {{ confidencePercent }}% 置信度
          </span>
        </div>
        <button
          type="button"
          class="text-[11px] text-studio-cyan hover:underline cursor-pointer font-medium"
          @click="showPartSelector = !showPartSelector"
        >
          {{ showPartSelector ? '收起' : '切换部位' }}
        </button>
      </div>

      <!-- 快速候选胶囊 (如 JEV 识别家具时提示切为 硬质家具) -->
      <div v-if="alternativePart" class="flex items-center gap-1.5 pt-1 text-[11px] text-slate-400">
        <span>建议候选:</span>
        <button
          type="button"
          class="px-2 py-0.5 rounded-full bg-studio-800 hover:bg-studio-700 text-amber-300 border border-amber-400/30 text-[10px] cursor-pointer"
          @click="selectPart(alternativePart)"
        >
          切为 {{ getPartLabel(alternativePart) }}
        </button>
      </div>

      <!-- 下拉选择全部部位 -->
      <div v-if="showPartSelector" class="pt-2 border-t border-studio-800/80 grid grid-cols-2 gap-1.5">
        <button
          v-for="p in allParts"
          :key="p.id"
          type="button"
          class="px-2.5 py-1.5 rounded-lg text-left text-[11px] transition cursor-pointer flex items-center justify-between"
          :class="activePart === p.id ? 'bg-studio-accent text-white font-bold' : 'bg-studio-850 text-slate-300 hover:bg-studio-800'"
          @click="selectPart(p.id)"
        >
          <span>{{ p.name_zh.split('/')[0] }}</span>
          <span v-if="activePart === p.id" class="text-xs">✓</span>
        </button>
      </div>
    </div>

    <!-- 2. 基材品类切换 Tab (严格受当前部位白名单限定：选沙发只出真皮/布艺，选墙面只出乳胶漆/艺术漆/护墙板/大理石) -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between text-[11px] text-slate-400 px-0.5">
        <span class="font-bold text-slate-300">基材品类</span>
        <span class="text-[10px] text-slate-500 font-mono">色随材走 · 材随位定</span>
      </div>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="cat in availableCategories"
          :key="cat.id"
          type="button"
          class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer"
          :class="selectedCategoryId === cat.id ? 'bg-studio-accent text-white font-bold shadow-sm' : 'bg-studio-900 border border-studio-800 text-slate-300 hover:bg-studio-800'"
          @click="selectCategory(cat.id)"
        >
          {{ cat.name_zh.split('/')[0] }}
        </button>
      </div>
    </div>

    <!-- 3. 主面板：当前基材的专属色卡、调色盘与工艺 -->
    <div class="space-y-3 p-3 rounded-xl bg-studio-950/70 border border-studio-800">
      <!-- A. 可视化调色盘与实时色彩大卡片 (杜绝纵向单字挤压) -->
      <div class="flex flex-col gap-2.5 p-2.5 rounded-lg bg-studio-900 border border-studio-800">
        <!-- 实时色彩预览大色块 + 色名/HEX展示 + 吸管工具 -->
        <div class="flex items-center justify-between gap-2.5">
          <div class="relative w-11 h-11 rounded-lg border-2 border-white/20 shadow-inner shrink-0 overflow-hidden" :style="{ backgroundColor: activeHex || '#8B4A2B' }">
            <input
              type="color"
              :value="activeHex || '#8B4A2B'"
              @input="onNativeColorInput($event.target.value)"
              class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              title="点击唤起系统调色盘"
            />
          </div>

          <div class="flex-1 min-w-0">
            <div class="font-bold text-slate-100 text-xs truncate" :title="activeDisplayName || '自定义色彩'">
              {{ activeDisplayName || '自定义色彩' }}
            </div>
            <div class="text-[10px] font-mono text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span>{{ activeHex || '#8B4A2B' }}</span>
              <span class="text-slate-500">·</span>
              <span>LRV {{ currentLrv }}%</span>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              @click="triggerEyeDropper"
              class="px-2.5 py-1 rounded-lg bg-studio-800 hover:bg-studio-700 text-studio-cyan text-[10px] font-medium flex items-center gap-1 cursor-pointer transition border border-studio-700"
              title="使用屏幕吸管取色，并由 AI 自动赋名入库"
            >
              <span>🎯 吸管取色</span>
            </button>
          </div>
        </div>

        <!-- 交互式色相光谱滑条 (Hue 0~360°) -->
        <div class="space-y-1">
          <div class="flex items-center justify-between text-[10px] text-slate-400">
            <span>色相 Spectrum</span>
            <span class="font-mono text-[9px]">{{ currentHue }}°</span>
          </div>
          <input
            type="range"
            min="0"
            max="360"
            step="1"
            :value="currentHue"
            @input="onHueSliderInput(Number($event.target.value))"
            class="w-full h-2 rounded-lg appearance-none cursor-pointer hue-slider"
          />
        </div>

        <!-- 交互式明度滑条 (Lightness 10%~95%) -->
        <div class="space-y-1">
          <div class="flex items-center justify-between text-[10px] text-slate-400">
            <span>明度 Lightness</span>
            <span class="font-mono text-[9px]">{{ currentLightness }}%</span>
          </div>
          <input
            type="range"
            min="10"
            max="95"
            step="1"
            :value="currentLightness"
            @input="onLightnessSliderInput(Number($event.target.value))"
            class="w-full h-2 rounded-lg appearance-none cursor-pointer lightness-slider"
            :style="{ background: lightnessSliderGradient }"
          />
        </div>

        <!-- HEX 文本直接修改与选区原色快捷按钮 -->
        <div class="flex items-center justify-between pt-1 border-t border-studio-800/60 text-[10px]">
          <div class="flex items-center gap-1">
            <span class="text-slate-400">输入HEX:</span>
            <input
              type="text"
              :value="activeHex || ''"
              placeholder="#HEX"
              maxlength="9"
              @change="onHexTextInput($event.target.value)"
              class="w-20 px-1.5 py-0.5 rounded bg-studio-850 border border-studio-700 font-mono text-[10px] text-slate-200 uppercase text-center focus:border-studio-cyan outline-none"
            />
          </div>

          <div v-if="sampledDominantHex" class="flex items-center gap-1">
            <span class="text-slate-400">选区原色:</span>
            <button
              type="button"
              class="font-mono text-amber-300 font-bold hover:underline cursor-pointer flex items-center gap-1"
              @click="applySampledHex"
              title="点击一键设为基色"
            >
              <span class="w-2 h-2 rounded-full inline-block border border-black/40" :style="{ backgroundColor: sampledDominantHex }"></span>
              <span>{{ sampledDominantHex }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- B. ✨ 框选区域智能建议配色 (随部位与基材动态联动) -->
      <div class="p-2.5 rounded-lg bg-studio-900/90 border border-studio-800 space-y-2">
        <div class="flex items-center justify-between">
          <span class="font-bold text-slate-200 text-[11px] flex items-center gap-1">
            <span class="text-amber-400">✨</span>
            <span>框选区域建议配色</span>
          </span>
          <span class="text-[10px] text-slate-500">随材质联动</span>
        </div>

        <p v-if="regionAdviceText" class="text-[10px] text-slate-400 leading-tight">
          {{ regionAdviceText }}
        </p>

        <!-- 建议配色胶囊 -->
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="rec in regionRecommendations"
            :key="rec.id"
            type="button"
            class="px-2 py-1 rounded-lg border text-[11px] flex items-center gap-1.5 transition cursor-pointer group"
            :class="activeHex === rec.hex ? 'bg-studio-800 border-amber-400 text-white shadow-xs' : 'bg-studio-850 border-studio-700/80 text-slate-300 hover:border-studio-600'"
            @click="pickSwatch(rec)"
            :title="rec.recommend_reason || rec.name_zh"
          >
            <span class="w-2.5 h-2.5 rounded-full border border-black/30 shrink-0" :style="{ backgroundColor: rec.hex }"></span>
            <span class="truncate max-w-[85px]">{{ rec.name_zh }}</span>
            <span v-if="rec.badge" class="px-1 py-0.2 rounded text-[9px] font-normal" :class="rec.badge === '原色同频' ? 'bg-amber-400/20 text-amber-300' : 'bg-studio-cyan/20 text-studio-cyan'">
              {{ rec.badge }}
            </span>
          </button>
        </div>
      </div>

      <!-- C. 表面专属表面工艺 -->
      <div v-if="currentCategory && currentCategory.finishes && currentCategory.finishes.length" class="space-y-1.5">
        <div class="flex items-center justify-between text-[11px] text-slate-400 px-0.5">
          <span class="font-medium text-slate-300">表面工艺</span>
          <span class="text-[10px] text-studio-cyan truncate max-w-[180px]">{{ currentFinishName }}</span>
        </div>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="fin in currentCategory.finishes"
            :key="fin.id"
            type="button"
            class="px-2.5 py-1 rounded-lg text-[10px] transition cursor-pointer"
            :class="selectedFinishId === fin.id ? 'bg-studio-accent text-white font-bold' : 'bg-studio-900 border border-studio-800 text-slate-400 hover:text-white'"
            @click="selectFinish(fin.id)"
            :title="fin.prompt_zh"
          >
            {{ fin.name_zh }}
          </button>
        </div>
      </div>

      <!-- D. 专属常用色卡库 (色随材走) -->
      <div class="space-y-2">
        <div class="flex items-center justify-between text-[11px] text-slate-300 px-0.5">
          <span class="font-bold flex items-center gap-1.5">
            <span>专属常用色卡</span>
            <span class="text-[10px] text-slate-500 font-mono">({{ activeCategorySwatches.length }}款)</span>
          </span>
          <button
            type="button"
            @click="openAddSwatchModal"
            class="text-[10px] text-studio-cyan hover:underline cursor-pointer font-medium"
          >
            + 新建色卡
          </button>
        </div>

        <!-- 色系筛选 Tab (动态计算：自动隐藏数量为 0 的空色系 Tab) -->
        <div class="flex flex-wrap gap-1">
          <button
            type="button"
            class="px-2 py-0.5 rounded text-[10px] transition cursor-pointer"
            :class="!selectedFamilyKey ? 'bg-studio-accent text-white font-bold' : 'bg-studio-900 border border-studio-800 text-slate-400 hover:text-white'"
            @click="selectedFamilyKey = ''"
          >
            全部 ({{ activeCategorySwatches.length }})
          </button>
          <button
            v-for="fam in dynamicActiveFamilies"
            :key="fam.key"
            type="button"
            class="px-2 py-0.5 rounded text-[10px] transition cursor-pointer"
            :class="selectedFamilyKey === fam.key ? 'bg-studio-accent text-white font-bold' : 'bg-studio-900 border border-studio-800 text-slate-400 hover:text-white'"
            @click="selectedFamilyKey = fam.key"
          >
            {{ fam.label }} ({{ fam.count }})
          </button>
        </div>

        <!-- 色卡网格 -->
        <div v-if="filteredSwatches.length === 0" class="py-6 text-center text-slate-500 text-[11px]">
          当前基材暂无该色系色卡，可使用上方「吸管取色」即时录入
        </div>
        <div v-else class="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-56 overflow-y-auto pr-0.5 scrollbar-thin">
          <div
            v-for="swatch in filteredSwatches"
            :key="swatch.id"
            class="p-1.5 rounded-lg border flex flex-col gap-1 cursor-pointer transition relative group"
            :class="activeSwatchId === swatch.id ? 'border-amber-400 bg-studio-850 shadow-xs' : 'border-studio-800 bg-studio-900/80 hover:border-studio-700'"
            @click="pickSwatch(swatch)"
          >
            <!-- 色块预览 -->
            <div class="w-full aspect-[4/3] rounded border border-black/20 flex items-center justify-center relative overflow-hidden" :style="{ backgroundColor: swatch.hex }">
              <span v-if="swatch.pinned" class="absolute top-0.5 right-0.5 text-[8px] bg-black/60 text-amber-300 px-1 rounded">常用</span>
            </div>
            <!-- 信息 -->
            <div class="min-w-0">
              <div class="font-bold text-[10px] text-slate-200 truncate" :title="swatch.name_zh">{{ swatch.name_zh }}</div>
              <div class="text-[9px] font-mono text-slate-400 truncate">{{ swatch.code || swatch.hex }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- E. 1K 具象肌理贴图 (当基材支持纹理贴图时清晰展示，支持叠加选色) -->
      <div v-if="textureSwatches.length > 0" class="pt-2 border-t border-studio-800 space-y-2">
        <div class="flex items-center justify-between text-[11px] text-slate-300 px-0.5">
          <span class="font-bold">具象肌理贴图 (1K)</span>
          <label class="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
            <input type="checkbox" v-model="applyTintToTexture" @change="emitChange" />
            <span>叠加所选颜色预染色</span>
          </label>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div
            v-for="tex in textureSwatches"
            :key="tex.id"
            class="p-1.5 rounded-lg border flex flex-col gap-1 cursor-pointer transition relative"
            :class="activeTextureCode === tex.code ? 'border-studio-cyan bg-studio-850' : 'border-studio-800 bg-studio-900/60 hover:border-studio-700'"
            @click="pickTexture(tex)"
          >
            <div class="w-full aspect-[4/3] rounded overflow-hidden bg-studio-950 flex items-center justify-center border border-white/10">
              <img
                v-if="tex.preview_path"
                :src="tex.preview_path"
                class="w-full h-full object-cover"
                :alt="tex.name_zh"
                @error="$event.target.style.display='none'"
              />
              <span v-else class="text-xs font-mono text-slate-500">1K贴图</span>
            </div>
            <div class="font-medium text-[10px] text-slate-200 truncate">{{ tex.name_zh }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { getToken } from '../../api';

const props = defineProps({
  guide: { type: Object, default: () => ({}) },
  surface: { type: String, default: '' },
  subclass: { type: String, default: '' },
  inferredProb: { type: Number, default: 0 }
});

const emit = defineEmits([
  'update:guide',
  'change',
  'color',
  'surface',
  'finish',
  'roughness',
  'aging'
]);

const COLOR_FAMILIES = [
  { key: 'off_white', label: '暖白奶油' },
  { key: 'beige_brown', label: '米杏大地' },
  { key: 'warm_gray', label: '暖灰侘寂' },
  { key: 'cool_gray', label: '冷灰现代' },
  { key: 'green_blue', label: '自然绿蓝' },
  { key: 'terracotta_red', label: '赤陶暖红' },
  { key: 'yellow_gold', label: '黄铜金属' }
];

// 核心字典数据
const loadingDictionary = ref(false);
const showPartSelector = ref(false);

const allParts = ref([]);
const allCategories = ref([]);
const swatchesMap = ref({});

// 选定状态
const activePart = ref('wall');
const alternativePart = ref('');
const selectedCategoryId = ref('');
const activeSwatchId = ref('');
const activeHex = ref('#8B4A2B');
const activeDisplayName = ref('意式马鞍棕');
const selectedFamilyKey = ref('');
const selectedFinishId = ref('');
const selectedGloss = ref('matte');

// 纹理模式
const isTextureMode = ref(false);
const activeTextureCode = ref('');
const activeTextureSwatch = ref(null);
const applyTintToTexture = ref(true);

// 调色盘滑条状态 (HSL)
const currentHue = ref(20);
const currentLightness = ref(36);
const currentLrv = ref(14);

// 选区智能推荐与原色
const sampledDominantHex = ref('');
const regionRecommendations = ref([]);
const regionAdviceText = ref('');

const uncertain = computed(() => {
  return (!props.guide?.part && !activePart.value) || (props.inferredProb > 0 && props.inferredProb < 0.75);
});

const confidencePercent = computed(() => {
  return Math.round((props.inferredProb || 0.85) * 100);
});

const headerTitle = computed(() => {
  const partObj = allParts.value.find(p => p.id === activePart.value);
  const partName = partObj ? partObj.name_zh.split('/')[0] : '选区部位';
  const catName = currentCategory.value ? currentCategory.value.name_zh.split('/')[0] : '表面';
  return `${partName} · ${catName}`;
});

const availableCategories = computed(() => {
  if (!activePart.value) return allCategories.value;
  return allCategories.value.filter(c => (c.allowed_parts || []).includes(activePart.value));
});

const currentCategory = computed(() => {
  return allCategories.value.find(c => c.id === selectedCategoryId.value) || availableCategories.value[0] || null;
});

const currentFinishName = computed(() => {
  if (!currentCategory.value || !currentCategory.value.finishes) return '';
  const match = currentCategory.value.finishes.find(f => f.id === selectedFinishId.value);
  return match ? match.name_zh : '';
});

const activeCategorySwatches = computed(() => {
  if (!selectedCategoryId.value) return [];
  const list = swatchesMap.value[selectedCategoryId.value] || [];
  return list.filter(s => s.item_type !== 'texture_map');
});

const dynamicActiveFamilies = computed(() => {
  const swatches = activeCategorySwatches.value;
  return COLOR_FAMILIES.map(fam => {
    const count = swatches.filter(s => s.color_family === fam.key).length;
    return { ...fam, count };
  }).filter(f => f.count > 0);
});

const filteredSwatches = computed(() => {
  const list = activeCategorySwatches.value;
  if (!selectedFamilyKey.value) return list;
  return list.filter(s => s.color_family === selectedFamilyKey.value);
});

const textureSwatches = computed(() => {
  if (!selectedCategoryId.value) return [];
  const list = swatchesMap.value[selectedCategoryId.value] || [];
  return list.filter(s => s.item_type === 'texture_map');
});

const lightnessSliderGradient = computed(() => {
  const hue = currentHue.value;
  return `linear-gradient(to right, #000000 0%, hsl(${hue}, 70%, 50%) 50%, #ffffff 100%)`;
});

function getPartLabel(partKey) {
  const p = allParts.value.find(item => item.id === partKey);
  return p ? p.name_zh.split('/')[0] : partKey;
}

// 颜色工具转换
function hexToHsl(hex) {
  let c = hex.replace(/^#/, '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  const r = (num >> 16) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

function hslToHex(h, s, l) {
  h = h / 360;
  s = s / 100;
  l = l / 100;
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = x => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function approxLrv(hex) {
  let c = hex.replace(/^#/, '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  const r = (num >> 16) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  const srgb = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const Y = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  return Math.round(Y * 100);
}

// 统一字典拉取
async function fetchMasterDictionary() {
  loadingDictionary.value = true;
  try {
    const token = getToken();
    const res = await fetch(`/api/base-library/dictionary?part=${encodeURIComponent(activePart.value || '')}`, {
      headers: { Authorization: token ? `Bearer ${token}` : '' }
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.data) {
        allParts.value = json.data.parts || [];
        allCategories.value = json.data.categories || [];
        swatchesMap.value = json.data.swatches || {};

        // 智能初始化当前品类
        const available = availableCategories.value;
        if (available.length > 0 && (!selectedCategoryId.value || !available.some(c => c.id === selectedCategoryId.value))) {
          selectedCategoryId.value = available[0].id;
          selectedFinishId.value = available[0].default_finish_id || (available[0].finishes && available[0].finishes[0]?.id) || '';
        }
      }
    }
  } catch (e) {
    console.warn('[ResurfaceDrawer] fetchMasterDictionary error:', e.message);
  } finally {
    loadingDictionary.value = false;
  }
}

// 拉取区域配色建议
async function fetchRegionRecommendations() {
  try {
    const token = getToken();
    const res = await fetch('/api/base-library/swatches/recommend-for-region', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({
        part: activePart.value,
        category_id: selectedCategoryId.value,
        dominant_hex: sampledDominantHex.value
      })
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.data) {
        regionRecommendations.value = json.data.swatches || [];
        regionAdviceText.value = json.data.advice_zh || '';
      }
    }
  } catch (_) {}
}

function selectPart(partKey) {
  activePart.value = partKey;
  alternativePart.value = '';
  showPartSelector.value = false;

  const available = allCategories.value.filter(c => (c.allowed_parts || []).includes(partKey));
  if (available.length > 0) {
    selectedCategoryId.value = available[0].id;
    selectedFinishId.value = available[0].default_finish_id || (available[0].finishes && available[0].finishes[0]?.id) || '';
    const swatches = (swatchesMap.value[selectedCategoryId.value] || []).filter(s => s.item_type !== 'texture_map');
    if (swatches.length > 0) {
      pickSwatch(swatches[0]);
    } else {
      emitChange();
    }
  } else {
    emitChange();
  }
  fetchRegionRecommendations();
}

function selectCategory(catId) {
  selectedCategoryId.value = catId;
  selectedFamilyKey.value = '';
  isTextureMode.value = false;
  activeTextureCode.value = '';
  activeTextureSwatch.value = null;

  const cat = allCategories.value.find(c => c.id === catId);
  if (cat) {
    selectedFinishId.value = cat.default_finish_id || (cat.finishes && cat.finishes[0]?.id) || '';
  }

  const swatches = (swatchesMap.value[catId] || []).filter(s => s.item_type !== 'texture_map');
  if (swatches.length > 0) {
    pickSwatch(swatches[0]);
  } else {
    emitChange();
  }
  fetchRegionRecommendations();
}

function selectFinish(finishId) {
  selectedFinishId.value = finishId;
  emitChange();
}

function pickSwatch(swatch) {
  if (!swatch) return;
  activeSwatchId.value = swatch.id;
  activeHex.value = swatch.hex.toUpperCase();
  activeDisplayName.value = swatch.name_zh;
  currentLrv.value = typeof swatch.lrv === 'number' ? swatch.lrv : approxLrv(swatch.hex);

  // 同步 HSL 滑条
  const hsl = hexToHsl(swatch.hex);
  currentHue.value = hsl.h;
  currentLightness.value = hsl.l;

  emitChange();
}

function pickTexture(tex) {
  if (!tex) return;
  isTextureMode.value = true;
  activeTextureCode.value = tex.code;
  activeTextureSwatch.value = tex;
  if (!applyTintToTexture.value) {
    activeHex.value = tex.hex || '';
    activeDisplayName.value = tex.name_zh;
  }
  emitChange();
}

function onNativeColorInput(newHex) {
  applyNewHex(newHex);
}

function onHexTextInput(val) {
  let hex = String(val || '').trim();
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    applyNewHex(hex);
  }
}

function onHueSliderInput(h) {
  currentHue.value = h;
  const hex = hslToHex(currentHue.value, 60, currentLightness.value);
  applyNewHex(hex, false);
}

function onLightnessSliderInput(l) {
  currentLightness.value = l;
  const hex = hslToHex(currentHue.value, 60, currentLightness.value);
  applyNewHex(hex, false);
}

function applyNewHex(hex, syncHsl = true) {
  hex = hex.toUpperCase();
  activeHex.value = hex;
  currentLrv.value = approxLrv(hex);

  if (syncHsl) {
    const hsl = hexToHsl(hex);
    currentHue.value = hsl.h;
    currentLightness.value = hsl.l;
  }

  // 尝试在当前分类中寻找匹配的最相近色名
  const swatches = activeCategorySwatches.value;
  const exact = swatches.find(s => s.hex.toUpperCase() === hex);
  if (exact) {
    activeDisplayName.value = exact.name_zh;
    activeSwatchId.value = exact.id;
  } else {
    activeDisplayName.value = `自定义色 (${hex})`;
    activeSwatchId.value = '';
  }

  emitChange();
}

function applySampledHex() {
  if (!sampledDominantHex.value) return;
  applyNewHex(sampledDominantHex.value);
}

async function triggerEyeDropper() {
  if (window.EyeDropper) {
    try {
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();
      if (result && result.sRGBHex) {
        applyNewHex(result.sRGBHex);
        // 调用 VLM 识别赋名
        fetch('/api/base-library/swatches/recognize-vlm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: getToken() ? `Bearer ${getToken()}` : ''
          },
          body: JSON.stringify({
            hex: result.sRGBHex,
            partHint: activePart.value
          })
        }).then(r => r.json()).then(j => {
          if (j && j.data && j.data.name_zh) {
            activeDisplayName.value = j.data.name_zh;
            emitChange();
          }
        }).catch(() => {});
      }
    } catch (_) {}
  } else {
    const input = prompt('请输入您要吸取的十六进制颜色值 (如 #8B4A2B):', activeHex.value);
    if (input) onHexTextInput(input);
  }
}

function openAddSwatchModal() {
  const name = prompt('请输入新色卡名称 (如：高级复古焦糖):');
  if (!name) return;
  const token = getToken();
  fetch('/api/base-library/swatches', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : ''
    },
    body: JSON.stringify({
      category_id: selectedCategoryId.value,
      name_zh: name,
      hex: activeHex.value,
      brand: '自建色卡',
      code: 'CUSTOM-' + Date.now().toString().slice(-4),
      item_type: 'solid_color',
      pinned: 1
    })
  }).then(r => r.json()).then(j => {
    if (j && j.data) {
      if (!swatchesMap.value[selectedCategoryId.value]) swatchesMap.value[selectedCategoryId.value] = [];
      swatchesMap.value[selectedCategoryId.value].unshift(j.data);
      pickSwatch(j.data);
    }
  }).catch(() => {});
}

function emitChange() {
  const currentCat = currentCategory.value;
  const currentFin = currentCat?.finishes?.find(f => f.id === selectedFinishId.value);
  const isTex = isTextureMode.value && activeTextureSwatch.value;

  const matName = isTex
    ? `${activeTextureSwatch.value?.name_zh || currentCat?.name_zh}${activeHex.value && applyTintToTexture.value ? ' (' + (activeDisplayName.value || activeHex.value) + ')' : ''}`
    : `${currentCat?.name_zh?.split('/')[0] || ''} · ${activeDisplayName.value || activeHex.value}`;

  const guidePatch = {
    type: 'resurface',
    mode: isTex ? 'rematerial' : 'recolor',
    track: isTex ? 'B' : 'A',
    part: activePart.value,
    surface: activePart.value,
    category_id: selectedCategoryId.value,
    category_name: currentCat?.name_zh?.split('/')[0] || '',
    finish_id: selectedFinishId.value,
    finish_name: currentFin?.name_zh || '',
    finish_prompt: currentFin?.prompt_zh || '',
    process: selectedFinishId.value,
    gloss: selectedGloss.value,
    finish: selectedGloss.value,
    swatch_id: activeSwatchId.value,
    assetId: isTex ? activeTextureSwatch.value.code : activeSwatchId.value,
    materialName: matName,
    displayName: activeDisplayName.value,
    color_name: activeDisplayName.value,
    colorHex: activeHex.value,
    hex: activeHex.value
  };

  emit('update:guide', guidePatch);
  emit('change', guidePatch);
  emit('color', activeHex.value);
  emit('surface', activePart.value);
  emit('finish', selectedGloss.value);
}

// 监听 props.guide，处理异步识别回填
watch(() => props.guide, (g) => {
  if (g) {
    if (g.part && g.part !== activePart.value) {
      selectPart(g.part);
    }
    if (g.alternatives && g.alternatives.length) {
      alternativePart.value = g.alternatives[0];
    }
    if (g.dominant_hex) {
      sampledDominantHex.value = g.dominant_hex;
    }
    if (g.recommended_swatches && g.recommended_swatches.length) {
      regionRecommendations.value = g.recommended_swatches;
    }
    if (g.advice_zh) {
      regionAdviceText.value = g.advice_zh;
    }
    if (g.colorHex || g.hex) {
      activeHex.value = (g.colorHex || g.hex).toUpperCase();
      const hsl = hexToHsl(activeHex.value);
      currentHue.value = hsl.h;
      currentLightness.value = hsl.l;
      currentLrv.value = approxLrv(activeHex.value);
    }
    if (g.displayName || g.color_name) {
      activeDisplayName.value = g.displayName || g.color_name;
    }
  }
}, { immediate: true, deep: true });

onMounted(async () => {
  await fetchMasterDictionary();
  emitChange();
  fetchRegionRecommendations();
});
</script>

<style scoped>
.hue-slider {
  background: linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%);
}
.hue-slider::-webkit-slider-thumb,
.lightness-slider::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid #000000;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 9999px;
}
</style>
