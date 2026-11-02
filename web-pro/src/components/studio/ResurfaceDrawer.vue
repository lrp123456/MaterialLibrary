<template>
  <div class="flex flex-col gap-3 text-xs min-w-0 select-none">
    <!-- 1. 顶部：部位识别状态与快捷切换 -->
    <div class="flex flex-col gap-2 p-2.5 rounded-xl bg-studio-900 border border-studio-750">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0 flex items-center gap-1.5">
          <span class="inline-block w-2 h-2 rounded-full" :class="uncertain && !activePart ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'"></span>
          <span class="font-bold text-slate-100 truncate">
            {{ headerTitle }}
          </span>
          <span v-if="confidencePercent" class="text-[10px] text-slate-400 font-mono">
            {{ confidencePercent }}%
          </span>
        </div>
        <div class="flex items-center gap-2">
          <!-- JEV 备选推荐胶囊 (如检测到家具时一键切硬家具) -->
          <button
            v-if="alternativePart"
            type="button"
            class="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-medium hover:bg-amber-500/25 transition cursor-pointer"
            @click="selectPart(alternativePart)"
          >
            切为 {{ getPartLabel(alternativePart) }}
          </button>
          <button
            type="button"
            class="text-[11px] text-studio-cyan shrink-0 cursor-pointer hover:underline"
            @click="showPartSelector = !showPartSelector"
          >
            {{ showPartSelector ? '收起部位' : '切换部位' }}
          </button>
        </div>
      </div>

      <!-- 8 部位快捷选择网格 -->
      <div v-if="showPartSelector || !activePart" class="grid grid-cols-4 gap-1 pt-1 border-t border-studio-800">
        <button
          v-for="p in allParts"
          :key="p.id"
          type="button"
          class="px-2 py-1.5 rounded-lg text-[11px] font-medium transition cursor-pointer truncate text-center"
          :class="activePart === p.id ? 'bg-studio-accent text-white font-bold shadow-sm' : 'bg-studio-800 text-slate-300 hover:bg-studio-750'"
          @click="selectPart(p.id)"
        >
          {{ p.name_zh.split('/')[0] }}
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

    <!-- 3. 主面板：当前基材的专属色卡与花色资产 -->
    <div class="space-y-3 p-3 rounded-xl bg-studio-950/70 border border-studio-800">
      <!-- 顶部：自定义调色盘 + 吸管取色 (AI 识色入库) -->
      <div class="flex flex-col gap-2 p-2 rounded-lg bg-studio-900 border border-studio-800">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <input
              type="color"
              :value="activeHex || '#8B4A2B'"
              @input="pickCustomColor($event.target.value)"
              class="w-6 h-6 rounded border border-studio-700 bg-transparent cursor-pointer"
              title="点击打开系统调色盘"
            />
            <span class="text-[11px] text-slate-300 font-medium">调色盘 / 吸管取色</span>
          </div>

          <div class="flex items-center gap-1.5">
            <button
              type="button"
              @click="triggerEyeDropper"
              class="px-2 py-0.5 rounded bg-studio-800 hover:bg-studio-700 text-studio-cyan text-[10px] font-medium flex items-center gap-1 cursor-pointer transition border border-studio-700"
              title="使用屏幕吸管取色，并由 VLM 自动识别室内美学色名"
            >
              <span>🎯 吸管取色 (AI识色)</span>
            </button>
            <input
              type="text"
              :value="activeHex || ''"
              placeholder="#HEX"
              maxlength="9"
              @change="pickCustomColor($event.target.value)"
              class="w-18 px-1.5 py-0.5 rounded bg-studio-850 border border-studio-700 font-mono text-[10px] text-slate-200 uppercase text-center"
            />
            <span v-if="activeHex" class="w-3.5 h-3.5 rounded-full border border-black/30 shadow-sm shrink-0" :style="{ backgroundColor: activeHex }"></span>
          </div>
        </div>

        <!-- 选区原色提取建议按钮 (如果有裁剪图主色) -->
        <div v-if="sampledDominantHex" class="flex items-center justify-between pt-1.5 border-t border-studio-800/80 text-[10px]">
          <span class="text-slate-400 flex items-center gap-1">
            <span>🎯 选区原图主色:</span>
            <span class="font-mono text-slate-200 font-bold">{{ sampledDominantHex }}</span>
            <span v-if="sampledDominantName" class="text-studio-cyan">({{ sampledDominantName }})</span>
          </span>
          <button
            type="button"
            class="text-amber-400 hover:underline cursor-pointer font-bold"
            @click="applySampledHex"
          >
            一键设为基色
          </button>
        </div>
      </div>

      <!-- AI 识色与入库临时卡片 (取色后展开确认) -->
      <div v-if="vlmCard" class="p-2.5 rounded-lg bg-studio-900 border border-amber-500/40 space-y-2 animate-fadeIn">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <span class="text-amber-400">✨</span>
            <span class="font-bold text-xs text-slate-100">AI 室内设计色彩识别</span>
          </div>
          <button type="button" class="text-slate-500 hover:text-slate-300 text-xs cursor-pointer" @click="vlmCard = null">✕</button>
        </div>
        <div class="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <div class="text-[10px] text-slate-500">美学色名</div>
            <input
              v-model="vlmCard.name_zh"
              type="text"
              class="w-full mt-0.5 px-1.5 py-0.5 rounded bg-studio-850 border border-studio-700 text-slate-200 text-xs font-bold"
            />
          </div>
          <div>
            <div class="text-[10px] text-slate-500">近似品牌色号</div>
            <div class="mt-1 text-slate-300 font-mono text-[10px] truncate">
              {{ (vlmCard.closest_brand_matches && vlmCard.closest_brand_matches[0]?.name_zh) || '专属定制' }}
            </div>
          </div>
        </div>
        <!-- 备选美学名推荐 -->
        <div v-if="vlmCard.poetic_alternatives && vlmCard.poetic_alternatives.length" class="flex items-center gap-1 flex-wrap">
          <span class="text-[9px] text-slate-500">备选色名:</span>
          <button
            v-for="alt in vlmCard.poetic_alternatives"
            :key="alt"
            type="button"
            @click="vlmCard.name_zh = alt"
            class="px-1.5 py-0.5 rounded bg-studio-800 text-[9px] text-slate-300 hover:text-white cursor-pointer"
          >
            {{ alt }}
          </button>
        </div>
        <button
          type="button"
          @click="saveVlmSwatchAndApply"
          class="w-full py-1.5 rounded-lg bg-studio-accent hover:brightness-110 text-white font-bold text-xs shadow transition cursor-pointer"
        >
          保存到我的专属色卡并立即应用
        </button>
      </div>

      <!-- 专属色卡库：色系分类切换 + 搜索 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-1">
          <div class="flex flex-wrap gap-1">
            <button
              v-for="fam in COLOR_FAMILIES"
              :key="fam.key"
              type="button"
              class="px-2 py-0.5 rounded text-[10px] transition cursor-pointer"
              :class="selectedFamilyKey === fam.key ? 'bg-studio-accent/20 text-studio-cyan font-bold border border-studio-cyan/40' : 'bg-studio-850 text-slate-400 hover:text-slate-200'"
              @click="selectedFamilyKey = selectedFamilyKey === fam.key ? '' : fam.key"
            >
              {{ fam.label }}
            </button>
          </div>
        </div>

        <!-- 专属色卡与花色网格 (只展示当前基材品类拥有的资产) -->
        <div v-if="loadingDictionary" class="text-[11px] text-slate-500 py-6 text-center">
          正在读取基材专属色卡…
        </div>
        <div v-else-if="filteredSwatches.length === 0" class="text-[11px] text-slate-500 py-6 text-center">
          当前基材品类暂无专属色卡，可使用上方「吸管取色」即时录入
        </div>
        <div v-else class="grid grid-cols-4 gap-1.5 max-h-56 overflow-y-auto pr-1 scrollbar-thin">
          <button
            v-for="swatch in filteredSwatches"
            :key="swatch.id"
            type="button"
            class="group relative flex flex-col items-center p-1.5 rounded-lg border transition cursor-pointer text-left"
            :class="activeSwatchId === swatch.id || activeHex === swatch.hex ? 'border-studio-cyan bg-studio-cyan/10 ring-1 ring-studio-cyan' : 'border-studio-800 bg-studio-850 hover:border-studio-700'"
            @click="pickSwatch(swatch)"
          >
            <!-- 纹理贴图预览 / 纯色色块 -->
            <div
              v-if="swatch.item_type === 'texture_map' && swatch.texture_1k_path"
              class="w-full h-8 rounded shadow-inner border border-black/20 mb-1 bg-cover bg-center"
              :style="{ backgroundImage: `url(${swatch.preview_path || swatch.texture_1k_path})` }"
            ></div>
            <div
              v-else
              class="w-full h-8 rounded shadow-inner border border-black/20 mb-1"
              :style="{ backgroundColor: swatch.hex }"
            ></div>

            <div class="w-full truncate text-[10px] font-medium text-slate-200 text-center" :title="swatch.name_zh">
              {{ swatch.name_zh }}
            </div>
            <div class="text-[9px] text-slate-400 font-mono truncate max-w-full">
              {{ swatch.code || ('L' + Math.round(swatch.lrv || 0)) }}
            </div>
          </button>
        </div>
      </div>

      <!-- 4. 专属表面工艺 / 铺法 / 肌理 (由当前基材动态决定：真皮出纳帕/油蜡，木地板出工字/人字拼，乳胶漆出滚涂/蛋壳光) -->
      <div v-if="currentCategory && currentCategory.finishes && currentCategory.finishes.length" class="space-y-1.5 pt-2 border-t border-studio-850">
        <div class="flex items-center justify-between text-[10px]">
          <span class="font-medium text-slate-400">专属表面工艺 / 铺贴肌理</span>
          <span class="text-studio-cyan text-[9px]">{{ currentFinishName }}</span>
        </div>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="fin in currentCategory.finishes"
            :key="fin.id"
            type="button"
            class="px-2 py-1 rounded text-[10px] cursor-pointer transition"
            :class="selectedFinishId === fin.id ? 'bg-studio-accent text-white font-bold shadow-xs' : 'bg-studio-850 text-slate-300 hover:bg-studio-800'"
            @click="selectFinish(fin.id)"
          >
            {{ fin.name_zh }}
          </button>
        </div>
      </div>

      <!-- 5. 表面光泽感控制 -->
      <div class="flex items-center justify-between pt-2 border-t border-studio-850 text-[10px] text-slate-400">
        <span>表面光泽感</span>
        <div class="flex gap-1">
          <button
            type="button"
            class="px-2.5 py-0.5 rounded transition cursor-pointer"
            :class="selectedGloss === 'matte' ? 'bg-studio-800 text-studio-cyan font-bold' : 'text-slate-400'"
            @click="selectedGloss = 'matte'; emitChange();"
          >
            自然哑光
          </button>
          <button
            type="button"
            class="px-2.5 py-0.5 rounded transition cursor-pointer"
            :class="selectedGloss === 'satin' ? 'bg-studio-800 text-studio-cyan font-bold' : 'text-slate-400'"
            @click="selectedGloss = 'satin'; emitChange();"
          >
            柔光丝光
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { getToken } from '../../api';

const props = defineProps({
  guide: {
    type: Object,
    default: () => ({})
  },
  surface: {
    type: String,
    default: 'wall'
  },
  subclass: {
    type: String,
    default: ''
  },
  inferredProb: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits([
  'update:guide',
  'change',
  'surface',
  'subclass',
  'material',
  'color',
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

// 状态定义
const loadingDictionary = ref(false);
const showPartSelector = ref(false);

const allParts = ref([]);
const allCategories = ref([]);
const swatchesMap = ref({});

const activePart = ref('wall');
const alternativePart = ref('');
const selectedCategoryId = ref('');
const activeSwatchId = ref('');
const activeHex = ref('#8B4A2B');
const activeDisplayName = ref('');
const selectedFamilyKey = ref('');
const selectedFinishId = ref('');
const selectedGloss = ref('matte');

const sampledDominantHex = ref('');
const sampledDominantName = ref('');
const vlmCard = ref(null);

const uncertain = computed(() => {
  return (!props.guide?.part && !activePart.value) || props.inferredProb < 0.75;
});

const confidencePercent = computed(() => {
  return Math.round((props.inferredProb || 0) * 100);
});

const headerTitle = computed(() => {
  if (uncertain.value && !activePart.value) return '❓ 待确认部位（请点选下方部位）';
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

const filteredSwatches = computed(() => {
  if (!selectedCategoryId.value) return [];
  const list = swatchesMap.value[selectedCategoryId.value] || [];
  if (!selectedFamilyKey.value) return list;
  return list.filter(s => s.color_family === selectedFamilyKey.value);
});

function getPartLabel(partKey) {
  const p = allParts.value.find(item => item.id === partKey);
  return p ? p.name_zh.split('/')[0] : partKey;
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
        allCategories.value = json.data.all_categories || json.data.categories || [];
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

function selectPart(partKey) {
  activePart.value = partKey;
  alternativePart.value = '';
  showPartSelector.value = false;

  // 联动切换该部位下的首选品类
  const available = allCategories.value.filter(c => (c.allowed_parts || []).includes(partKey));
  if (available.length > 0) {
    selectedCategoryId.value = available[0].id;
    selectedFinishId.value = available[0].default_finish_id || (available[0].finishes && available[0].finishes[0]?.id) || '';
    // 默认高亮第一个专属色卡
    const swatches = swatchesMap.value[selectedCategoryId.value] || [];
    if (swatches.length > 0) {
      pickSwatch(swatches[0]);
    } else {
      emitChange();
    }
  } else {
    emitChange();
  }
}

function selectCategory(catId) {
  selectedCategoryId.value = catId;
  const cat = allCategories.value.find(c => c.id === catId);
  if (cat) {
    selectedFinishId.value = cat.default_finish_id || (cat.finishes && cat.finishes[0]?.id) || '';
  }
  const swatches = swatchesMap.value[catId] || [];
  if (swatches.length > 0) {
    pickSwatch(swatches[0]);
  } else {
    emitChange();
  }
}

function selectFinish(finishId) {
  selectedFinishId.value = finishId;
  emitChange();
}

function pickSwatch(swatch) {
  activeSwatchId.value = swatch.id;
  activeHex.value = swatch.hex;
  activeDisplayName.value = swatch.name_zh;
  if (swatch.finish_override) {
    selectedFinishId.value = swatch.finish_override;
  }
  emitChange();
}

function pickCustomColor(hex) {
  if (!hex) return;
  activeHex.value = hex.toUpperCase();
  activeSwatchId.value = '';
  activeDisplayName.value = '自定义色';
  emitChange();
}

function applySampledHex() {
  if (!sampledDominantHex.value) return;
  pickCustomColor(sampledDominantHex.value);
  if (sampledDominantName.value) {
    activeDisplayName.value = sampledDominantName.value;
  }
}

// 屏幕原生吸管取色 + VLM 识色
async function triggerEyeDropper() {
  let hex = '';
  if (window.EyeDropper) {
    try {
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();
      hex = result?.sRGBHex || '';
    } catch (_) {
      // 用户取消取色
      return;
    }
  } else {
    hex = prompt('请输入你要识别的 HEX 颜色代码（如 #8B4A2B）：', activeHex.value || '#8B4A2B') || '';
  }

  if (!hex) return;
  hex = hex.trim().toUpperCase();
  pickCustomColor(hex);

  // 调用 VLM 识色接口
  try {
    const token = getToken();
    const res = await fetch('/api/base-library/swatches/recognize-vlm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({
        hex,
        partHint: activePart.value || 'upholstery'
      })
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.data) {
        vlmCard.value = json.data;
        if (json.data.name_zh) {
          activeDisplayName.value = json.data.name_zh;
        }
      }
    }
  } catch (err) {
    console.warn('[ResurfaceDrawer] recognize-vlm error:', err.message);
  }
}

async function saveVlmSwatchAndApply() {
  if (!vlmCard.value) return;
  try {
    const token = getToken();
    const payload = {
      category_id: vlmCard.value.recommended_category_id || selectedCategoryId.value,
      name_zh: vlmCard.value.name_zh || '灵感美学色',
      hex: vlmCard.value.hex || activeHex.value,
      brand: '灵感AI取色',
      code: (vlmCard.value.closest_brand_matches && vlmCard.value.closest_brand_matches[0]?.code) || '',
      color_family: vlmCard.value.color_family,
      style_tags: vlmCard.value.style_tags || [],
      finish_override: vlmCard.value.recommended_finish_id || ''
    };
    const res = await fetch('/api/base-library/swatches', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.data) {
        // 重新拉取字典并应用该色卡
        await fetchMasterDictionary();
        pickSwatch(json.data);
        vlmCard.value = null;
      }
    }
  } catch (err) {
    alert('保存色卡失败：' + err.message);
  }
}

function emitChange() {
  const currentCat = currentCategory.value;
  const currentFin = currentCat?.finishes?.find(f => f.id === selectedFinishId.value);

  const payload = {
    mode: currentCat?.track_mode === 'track_b' ? 'rematerial' : 'recolor',
    part: activePart.value,
    surface: activePart.value,
    category_id: selectedCategoryId.value,
    category_name: currentCat?.name_zh || '',
    finish_id: selectedFinishId.value,
    finish: selectedGloss.value,
    finish_prompt: currentFin?.prompt_zh || '',
    swatch_id: activeSwatchId.value,
    color_name: activeDisplayName.value,
    display_name: activeDisplayName.value,
    hex: activeHex.value,
    process: selectedFinishId.value,
    material_family: currentCat?.track_mode === 'track_b' ? 'texture' : 'color'
  };

  emit('change', payload);
  emit('color', activeHex.value);
  emit('surface', activePart.value);
  emit('finish', selectedGloss.value);
}

// 监听 props
watch(() => props.guide, (g) => {
  if (g) {
    if (g.part) activePart.value = g.part;
    if (g.alternatives && g.alternatives.length) {
      alternativePart.value = g.alternatives[0];
    }
    if (g.hex) activeHex.value = g.hex;
    if (g.display_name || g.color_name) activeDisplayName.value = g.display_name || g.color_name;
    if (g.cropDataUrl || g.crop_base64) {
      // 触发物理采样
      fetch('/api/base-library/swatches/recognize-vlm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: getToken() ? `Bearer ${getToken()}` : ''
        },
        body: JSON.stringify({
          cropDataUrl: g.cropDataUrl || g.crop_base64,
          partHint: activePart.value
        })
      }).then(r => r.json()).then(j => {
        if (j && j.data && j.data.hex) {
          sampledDominantHex.value = j.data.hex;
          sampledDominantName.value = j.data.name_zh || '';
        }
      }).catch(() => {});
    }
  }
}, { immediate: true, deep: true });

onMounted(async () => {
  await fetchMasterDictionary();
  emitChange();
});
</script>

<style scoped>
.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 9999px;
}
</style>
