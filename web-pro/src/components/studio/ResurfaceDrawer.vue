<template>
  <div class="flex flex-col gap-3 text-xs min-w-0 select-none">
    <!-- 1. 顶部：部位识别状态与 8 大部位切换 -->
    <div class="flex flex-col gap-2 p-2.5 rounded-xl bg-studio-900 border border-studio-750">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0 flex items-center gap-1.5">
          <span class="inline-block w-2 h-2 rounded-full" :class="uncertain ? 'bg-amber-400' : 'bg-emerald-400'"></span>
          <span class="font-bold text-slate-100 truncate">
            {{ headerTitle }}
          </span>
          <span v-if="!uncertain && confidencePercent" class="text-[10px] text-slate-400 font-mono">
            {{ confidencePercent }}%
          </span>
        </div>
        <button
          type="button"
          class="text-[11px] text-studio-cyan shrink-0 cursor-pointer hover:underline"
          @click="showPartSelector = !showPartSelector"
        >
          {{ showPartSelector ? '收起部位' : '切换部位' }}
        </button>
      </div>

      <!-- 8 部位快捷选择网格 -->
      <div v-if="showPartSelector || uncertain || !activePart" class="grid grid-cols-4 gap-1 pt-1 border-t border-studio-800">
        <button
          v-for="p in PARTS"
          :key="p.key"
          type="button"
          class="px-2 py-1.5 rounded-lg text-[11px] font-medium transition cursor-pointer truncate"
          :class="activePart === p.key ? 'bg-studio-accent text-white font-bold' : 'bg-studio-800 text-slate-300 hover:bg-studio-750'"
          @click="selectPart(p.key)"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <!-- 2. 第一层：只换色 (mode: 'recolor') 默认激活 -->
    <div class="space-y-3 p-3 rounded-xl bg-studio-950/70 border border-studio-800">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <span class="font-bold text-slate-200">第一层 · 只换色</span>
          <span class="text-[10px] text-slate-500">保持原材质纹理与褶皱</span>
        </div>
        <!-- 顶面专属：显示全色系开关 (Patch 6) -->
        <label v-if="activePart === 'ceiling'" class="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
          <input type="checkbox" v-model="ceilingShowAll" class="rounded bg-studio-800 border-studio-700 text-studio-accent text-[10px]" />
          <span>墙顶同色全系</span>
        </label>
      </div>

      <!-- 色板：精选策展色号网格 -->
      <div v-if="loadingPaints" class="text-[11px] text-slate-500 py-3 text-center">
        正在读取精选色卡…
      </div>
      <div v-else class="space-y-2">
        <!-- 色系切换 Tab -->
        <div class="flex flex-wrap gap-1">
          <button
            v-for="fam in availableFamilies"
            :key="fam.key"
            type="button"
            class="px-2 py-0.5 rounded text-[10px] transition cursor-pointer"
            :class="selectedFamilyKey === fam.key ? 'bg-studio-accent/20 text-studio-cyan font-bold border border-studio-cyan/40' : 'bg-studio-850 text-slate-400 hover:text-slate-200'"
            @click="selectedFamilyKey = fam.key"
          >
            {{ fam.label }}
          </button>
        </div>

        <!-- 当前色系下的颜色卡片 -->
        <div class="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto pr-1">
          <button
            v-for="paint in filteredPaints"
            :key="paint.id"
            type="button"
            class="group relative flex flex-col items-center p-1.5 rounded-lg border transition cursor-pointer text-left"
            :class="activeHex === paint.hex ? 'border-studio-cyan bg-studio-cyan/10 ring-1 ring-studio-cyan' : 'border-studio-800 bg-studio-850 hover:border-studio-700'"
            @click="pickColor(paint)"
          >
            <div
              class="w-full h-7 rounded shadow-inner border border-black/20 mb-1"
              :style="{ backgroundColor: paint.hex }"
            ></div>
            <div class="w-full truncate text-[10px] font-medium text-slate-200 text-center">
              {{ paint.display_name }}
            </div>
            <div class="text-[9px] text-slate-400 font-mono">
              L{{ Math.round(paint.lrv || 0) }}
            </div>
          </button>
        </div>
      </div>

      <!-- 工艺胶囊 (仅涂层/艺术漆或墙顶出现) -->
      <div v-if="showProcessOptions" class="space-y-1.5 pt-2 border-t border-studio-850">
        <div class="text-[10px] font-medium text-slate-400">施工工法工艺</div>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="proc in PROCESS_OPTIONS"
            :key="proc.key"
            type="button"
            class="px-2 py-1 rounded text-[10px] cursor-pointer transition"
            :class="selectedProcess === proc.key ? 'bg-studio-accent text-white font-bold' : 'bg-studio-850 text-slate-300 hover:bg-studio-800'"
            @click="pickProcess(proc.key)"
          >
            {{ proc.label }}
          </button>
        </div>
      </div>

      <!-- 光泽控制 (简化为哑光 / 丝光) -->
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

    <!-- 3. 第二层：换材质 (mode: 'rematerial') 默认折叠 -->
    <div class="rounded-xl bg-studio-950/70 border border-studio-800 overflow-hidden">
      <button
        type="button"
        class="w-full px-3 py-2.5 flex items-center justify-between text-left hover:bg-studio-900 transition cursor-pointer"
        @click="layer2Expanded = !layer2Expanded"
      >
        <div class="flex items-center gap-1.5">
          <span class="font-bold text-slate-200">第二层 · 换成别的材料</span>
          <span v-if="activeAssetId" class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
            已选材质
          </span>
        </div>
        <span class="text-slate-400 text-xs transform transition" :class="layer2Expanded ? 'rotate-180' : ''">▼</span>
      </button>

      <div v-if="layer2Expanded" class="p-3 space-y-3 border-t border-studio-850">
        <!-- 柜体专属：3 枚分类子类胶囊 (Patch 7 按原材质排序) -->
        <div v-if="activePart === 'millwork'" class="flex gap-1.5">
          <button
            v-for="sub in millworkCapsules"
            :key="sub.key"
            type="button"
            class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer"
            :class="selectedSubclass === sub.key ? 'bg-studio-cyan/20 text-studio-cyan border border-studio-cyan/40 font-bold' : 'bg-studio-850 text-slate-300 hover:bg-studio-800'"
            @click="selectedSubclass = sub.key; refreshMaterials();"
          >
            {{ sub.label }}
          </button>
        </div>

        <!-- 轨道 B 具象材质卡片 (球预览 + 铺法) -->
        <div v-if="loadingMaterials" class="text-[11px] text-slate-500 py-3 text-center">
          正在读取材质库…
        </div>
        <div v-else-if="filteredMaterials.length === 0" class="text-[11px] text-slate-500 py-3 text-center">
          该部位暂无适配的轨道 B 材质贴图
        </div>
        <div v-else class="grid grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
          <button
            v-for="mat in filteredMaterials"
            :key="mat.id"
            type="button"
            class="flex flex-col rounded-lg border p-1 text-left transition cursor-pointer group"
            :class="activeAssetId === mat.id ? 'border-amber-400 bg-amber-400/10 ring-1 ring-amber-400' : 'border-studio-800 bg-studio-850 hover:border-studio-700'"
            @click="pickMaterial(mat)"
          >
            <div class="w-full aspect-square rounded overflow-hidden bg-black/40 mb-1">
              <img
                v-if="mat.preview_url"
                :src="mat.preview_url"
                :alt="mat.name_cn"
                class="w-full h-full object-cover group-hover:scale-105 transition"
              />
              <div v-else class="w-full h-full flex items-center justify-center text-[10px] text-slate-500">
                无球图
              </div>
            </div>
            <div class="truncate text-[10px] font-bold text-slate-200">
              {{ mat.name_cn }}
            </div>
            <div class="text-[9px] text-slate-400 truncate">
              {{ mat.tone || '中性' }} · {{ mat.layout || '平铺' }}
            </div>
          </button>
        </div>

        <!-- 轨道 B 预染色配置 (可选 HEX) -->
        <div v-if="activeAssetId" class="pt-2 border-t border-studio-850 space-y-1.5">
          <div class="flex items-center justify-between text-[10px]">
            <span class="text-slate-400">材质预染色 (明度残差不爆噪)</span>
            <button
              v-if="tintHex"
              type="button"
              class="text-studio-cyan hover:underline cursor-pointer"
              @click="tintHex = ''; emitChange();"
            >
              清除染色 (用贴图固有色)
            </button>
          </div>
          <div class="flex items-center gap-2">
            <input
              type="color"
              v-model="tintHex"
              class="w-7 h-7 rounded border border-studio-700 bg-transparent cursor-pointer"
              @change="emitChange"
            />
            <span class="font-mono text-slate-300 text-[11px]">{{ tintHex || '无染色（原材质固有色）' }}</span>
          </div>
        </div>

        <!-- 返回第一层只换色按钮 -->
        <button
          v-if="activeAssetId"
          type="button"
          class="w-full py-1 text-center text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer"
          @click="clearMaterialToLayer1"
        >
          取消材质，切回只换色
        </button>
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

const PARTS = [
  { key: 'ceiling', label: '顶面' },
  { key: 'wall', label: '墙面' },
  { key: 'floor', label: '地面' },
  { key: 'millwork', label: '定制柜体' },
  { key: 'upholstery', label: '软体沙发' },
  { key: 'hard_furniture', label: '硬家具' },
  { key: 'curtain_bedding', label: '窗帘床品' },
  { key: 'rug', label: '地毯地垫' }
];

const PROCESS_OPTIONS = [
  { key: 'roller_matte', label: '标准滚涂哑光' },
  { key: 'eggshell', label: '丝光蛋壳光' },
  { key: 'trowel_microcement', label: '批刮微水泥' },
  { key: 'velvet', label: '天鹅绒艺术漆' },
  { key: 'lime_rammed', label: '粗粝石灰夯土' }
];

const ALL_FAMILIES = [
  { key: 'warm_white', label: '暖白' },
  { key: 'cream', label: '奶油' },
  { key: 'ivory', label: '象牙' },
  { key: 'greige', label: '原麻灰米' },
  { key: 'earth', label: '大地侘寂' },
  { key: 'cool_gray', label: '现代冷灰' },
  { key: 'morandi', label: '莫兰迪' },
  { key: 'caramel', label: '焦糖' },
  { key: 'ink', label: '静谧深色' }
];

const showPartSelector = ref(false);
const layer2Expanded = ref(false);
const ceilingShowAll = ref(false);

const activePart = ref('wall');
const materialFamily = ref('paint');
const activeHex = ref('');
const activeDisplayName = ref('');
const selectedFamilyKey = ref('warm_white');
const selectedProcess = ref('roller_matte');
const selectedGloss = ref('matte');

const activeAssetId = ref('');
const selectedSubclass = ref('');
const tintHex = ref('');

const paints = ref([]);
const materials = ref([]);
const loadingPaints = ref(false);
const loadingMaterials = ref(false);
const policies = ref({});

const uncertain = computed(() => {
  return props.inferredProb < 0.75 && !props.guide?.part;
});

const confidencePercent = computed(() => {
  return Math.round((props.inferredProb || 0) * 100);
});

const headerTitle = computed(() => {
  if (uncertain.value && !activePart.value) return '先选这框是什么';
  const partObj = PARTS.find(p => p.key === activePart.value);
  const partName = partObj ? partObj.label : '选区';
  const famMap = {
    paint: '乳胶漆',
    art_coat: '艺术漆',
    wood: '木质',
    stone: '石材岩板',
    leather: '真皮',
    fabric: '布艺',
    metal: '金属',
    glass: '玻璃'
  };
  const matName = famMap[materialFamily.value] || '表面';
  return `${partName} · ${matName}`;
});

const availableFamilies = computed(() => {
  if (activePart.value === 'ceiling' && !ceilingShowAll.value) {
    return ALL_FAMILIES.filter(f => ['warm_white', 'cream', 'cool_gray'].includes(f.key));
  }
  return ALL_FAMILIES;
});

const filteredPaints = computed(() => {
  return paints.value.filter(p => {
    if (selectedFamilyKey.value && p.family_key !== selectedFamilyKey.value) return false;
    if (activePart.value === 'ceiling' && !ceilingShowAll.value) {
      return (p.lrv || 0) >= 70;
    }
    return true;
  });
});

const showProcessOptions = computed(() => {
  if (['upholstery', 'curtain_bedding', 'rug', 'floor'].includes(activePart.value)) {
    return false;
  }
  return ['paint', 'art_coat'].includes(materialFamily.value) || ['ceiling', 'wall'].includes(activePart.value);
});

const millworkCapsules = computed(() => {
  const list = [
    { key: 'mill_lacquer', label: '柜门-烤漆' },
    { key: 'mill_veneer', label: '柜门-木皮' },
    { key: 'mill_stone', label: '台面-石材岩板' }
  ];
  if (materialFamily.value === 'stone') {
    return [list[2], list[0], list[1]];
  }
  return list;
});

const filteredMaterials = computed(() => {
  return materials.value.filter(m => {
    if (selectedSubclass.value) {
      return (m.tags || []).some(t => t.subclass === selectedSubclass.value);
    }
    return true;
  });
});

async function loadPolicies() {
  try {
    const res = await fetch('/api/base-library/part-policy', {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    const json = await res.json();
    if (json.success && json.data) {
      policies.value = json.data.parts || {};
    }
  } catch (_) {}
}

async function loadCuratedPaints() {
  loadingPaints.value = true;
  try {
    const res = await fetch('/api/base-library/paints?curated=1&limit=100', {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    const json = await res.json();
    if (json.success) {
      paints.value = json.data || [];
    }
  } catch (_) {}
  finally {
    loadingPaints.value = false;
  }
}

async function refreshMaterials() {
  loadingMaterials.value = true;
  try {
    const res = await fetch('/api/base-library/materials?track=B&limit=100', {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    const json = await res.json();
    if (json.success) {
      materials.value = json.data || [];
    }
  } catch (_) {}
  finally {
    loadingMaterials.value = false;
  }
}

function selectPart(partKey) {
  activePart.value = partKey;
  showPartSelector.value = false;
  // 清空已选材质资产
  activeAssetId.value = '';
  tintHex.value = '';

  // 设定默认色系
  if (partKey === 'ceiling') {
    selectedFamilyKey.value = 'warm_white';
  } else if (partKey === 'upholstery') {
    selectedFamilyKey.value = 'caramel';
  } else if (partKey === 'floor') {
    selectedFamilyKey.value = 'caramel';
  }

  emit('surface', partKey);
  emitChange();
}

function pickColor(paint) {
  if (activeHex.value === paint.hex) {
    activeHex.value = '';
    activeDisplayName.value = '';
  } else {
    activeHex.value = paint.hex;
    activeDisplayName.value = paint.display_name;
  }
  emit('color', { hex: activeHex.value, name: activeDisplayName.value });
  emitChange();
}

function pickProcess(procKey) {
  selectedProcess.value = procKey;
  emitChange();
}

function pickMaterial(mat) {
  activeAssetId.value = mat.id;
  selectedSubclass.value = (mat.tags && mat.tags[0] && mat.tags[0].subclass) || '';
  emit('material', { id: mat.id, name: mat.name_cn });
  emit('subclass', selectedSubclass.value);
  emitChange();
}

function clearMaterialToLayer1() {
  activeAssetId.value = '';
  tintHex.value = '';
  emitChange();
}

function emitChange() {
  const isRematerial = Boolean(activeAssetId.value);
  const guidePayload = {
    type: 'resurface',
    mode: isRematerial ? 'rematerial' : 'recolor',
    part: activePart.value,
    materialFamily: materialFamily.value,
    displayName: isRematerial
      ? (materials.value.find(m => m.id === activeAssetId.value)?.name_cn || '')
      : activeDisplayName.value,
    hex: isRematerial ? tintHex.value : activeHex.value,
    colorHex: isRematerial ? tintHex.value : activeHex.value,
    process: isRematerial ? '' : selectedProcess.value,
    gloss: selectedGloss.value,
    track: isRematerial ? 'B' : 'A',
    assetId: activeAssetId.value || '',
    reference: null
  };

  emit('update:guide', guidePayload);
  emit('change', guidePayload);
}

// 监听外界 guide 变动
watch(
  () => props.guide,
  (newG) => {
    if (!newG) return;
    if (newG.part && newG.part !== activePart.value) activePart.value = newG.part;
    if (newG.materialFamily) materialFamily.value = newG.materialFamily;
    if (newG.hex) activeHex.value = newG.hex;
    if (newG.displayName) activeDisplayName.value = newG.displayName;
    if (newG.assetId) activeAssetId.value = newG.assetId;
  },
  { immediate: true }
);

watch(
  () => props.surface,
  (newS) => {
    if (newS && PARTS.some(p => p.key === newS) && newS !== activePart.value) {
      activePart.value = newS;
    }
  }
);

onMounted(async () => {
  await Promise.all([loadPolicies(), loadCuratedPaints(), refreshMaterials()]);
});
</script>
