<template>
  <div class="base-attr-picker flex flex-col h-full text-slate-200 text-xs select-none">
    <!-- 1. 装修面切换与分类 -->
    <div class="p-3 border-b border-studio-800 bg-studio-900/40">
      <div class="flex items-center justify-between mb-2">
        <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">装修面货架</span>
        <span v-if="inferredSurface" class="text-[10px] px-1.5 py-0.5 rounded bg-studio-accent/20 text-studio-cyan font-mono">
          JEV 识别: {{ surfaceLabel(inferredSurface) }}
        </span>
      </div>
      <div class="grid grid-cols-4 gap-1.5">
        <button
          v-for="s in surfaces"
          :key="s.key"
          type="button"
          @click="changeSurface(s.key)"
          class="px-2 py-1.5 rounded-lg text-center font-medium transition cursor-pointer text-[11px] truncate"
          :class="activeSurface === s.key ? 'bg-studio-accent text-white font-bold shadow-xs' : 'bg-studio-850 text-slate-400 hover:text-slate-200'"
        >
          {{ s.label }}
        </button>
      </div>

      <!-- 子类切换 (若该面有多个子类) -->
      <div v-if="currentSurfaceSubclasses.length > 1" class="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-studio-800/60">
        <button
          v-for="sub in currentSurfaceSubclasses"
          :key="sub.key"
          type="button"
          @click="changeSubclass(sub.key)"
          class="px-2 py-1 rounded-md text-[10px] transition cursor-pointer"
          :class="activeSubclass === sub.key ? 'bg-white/20 text-white font-bold' : 'bg-studio-800/80 text-slate-400 hover:text-slate-200'"
        >
          {{ sub.label }}
        </button>
      </div>
    </div>

    <!-- 2. 仓库内容选择区 -->
    <div class="flex-1 overflow-y-auto p-3 space-y-3">
      <!-- 2.1 色号仓库 -->
      <div v-if="currentWarehouse === 'paint'" class="space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold text-slate-400">选择乳胶漆色号</span>
          <span v-if="paints.length > 0" class="text-[10px] text-slate-500 font-mono">{{ paints.length }} 款色号</span>
        </div>

        <!-- 真实色号列表 -->
        <div v-if="paints.length > 0" class="grid grid-cols-3 gap-2">
          <div
            v-for="p in paints"
            :key="p.id"
            @click="selectPaint(p)"
            class="p-1.5 rounded-xl border transition cursor-pointer flex flex-col justify-between"
            :class="selectedAssetId === p.id ? 'bg-studio-850 border-studio-accent ring-1 ring-studio-accent' : 'bg-studio-900 border-studio-800 hover:border-studio-700'"
          >
            <div class="w-full aspect-square rounded-lg mb-1 overflow-hidden relative">
              <img :src="authedUrl(p.swatch_url)" class="w-full h-full object-cover" />
            </div>
            <div class="text-[10px] font-bold font-mono text-white truncate">{{ p.code }}</div>
            <div class="text-[9px] text-slate-400 truncate">{{ p.name_zh || p.name_en }}</div>
          </div>
        </div>

        <!-- 库空时兜底芯片 (纯 HEX，不带 SVG) -->
        <div v-else class="space-y-2">
          <div class="text-[10px] text-amber-400/90 font-medium">色号库正在收录中，使用常用标准调色卡：</div>
          <div class="grid grid-cols-4 gap-1.5">
            <button
              v-for="c in fallbackPaints"
              :key="c.name"
              type="button"
              @click="selectFallbackColor(c)"
              class="p-1.5 rounded-lg border text-center transition cursor-pointer"
              :class="selectedHex === c.hex ? 'border-studio-accent bg-studio-800' : 'border-studio-800 bg-studio-900 hover:border-studio-700'"
            >
              <div class="w-full h-6 rounded mb-1" :style="{ backgroundColor: c.hex }"></div>
              <div class="text-[9px] text-slate-200 truncate">{{ c.name }}</div>
            </button>
          </div>
        </div>

        <!-- 底色壳勾选 (若当前选中色号支持 shell_material_id) -->
        <div v-if="selectedPaintMeta?.shell_material_id" class="p-2.5 rounded-xl bg-studio-850 border border-studio-750 flex items-center justify-between">
          <div>
            <div class="text-xs font-bold text-white">叠加底色艺术质感壳</div>
            <div class="text-[10px] text-slate-400">保留乳胶漆微水泥质感纹理与自然颗粒</div>
          </div>
          <input type="checkbox" v-model="useShell" @change="emitSelection" class="rounded bg-studio-800 text-studio-accent" />
        </div>
      </div>

      <!-- 2.2 材质仓库 -->
      <div v-else-if="currentWarehouse === 'material'" class="space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold text-slate-400">选择 1K 底色参考贴图</span>
          <span v-if="materials.length > 0" class="text-[10px] text-slate-500 font-mono">{{ materials.length }} 款材质</span>
        </div>

        <!-- 真实材质列表 -->
        <div v-if="materials.length > 0" class="grid grid-cols-3 gap-2">
          <div
            v-for="m in materials"
            :key="m.id"
            @click="selectMaterial(m)"
            class="p-1.5 rounded-xl border transition cursor-pointer flex flex-col justify-between"
            :class="selectedAssetId === m.id ? 'bg-studio-850 border-studio-accent ring-1 ring-studio-accent' : 'bg-studio-900 border-studio-800 hover:border-studio-700'"
          >
            <div class="w-full aspect-square rounded-lg mb-1 overflow-hidden relative bg-studio-950">
              <img :src="authedUrl(m.thumb_url)" class="w-full h-full object-cover" />
            </div>
            <div class="text-[10px] font-bold text-white truncate">{{ m.name_cn }}</div>
            <div class="text-[9px] text-slate-500 truncate">{{ m.credit }}</div>
          </div>
        </div>

        <!-- 库空时文字预设兜底 (不塞 SVG) -->
        <div v-else class="space-y-2">
          <div class="text-[10px] text-slate-400">材质仓库当前子类尚无参考图，使用文字肌理预置：</div>
          <div class="grid grid-cols-3 gap-1.5">
            <button
              v-for="slot in fallbackSlots"
              :key="slot.id"
              type="button"
              @click="selectFallbackSlot(slot)"
              class="p-2 rounded-xl border text-center transition cursor-pointer"
              :class="selectedPresetId === slot.id ? 'border-studio-accent bg-studio-800 text-white font-bold' : 'border-studio-800 bg-studio-900 text-slate-300 hover:border-studio-700'"
            >
              <div class="text-xs">{{ slot.name }}</div>
            </button>
          </div>
        </div>
      </div>

      <!-- 2.3 灯具仓库 -->
      <div v-else-if="currentWarehouse === 'light'" class="space-y-4">
        <div class="p-3 rounded-xl bg-studio-900 border border-studio-800 text-center">
          <div class="text-xs font-bold text-white mb-1">灯具属性配置</div>
          <div class="text-[11px] text-slate-400">灯具选区不替换 3D 模型实体，光线方向与色温将在全局光照中映射控制。</div>
        </div>
      </div>

      <!-- 2.4 模型仓库 (空态契约) -->
      <div v-else-if="currentWarehouse === 'model'" class="space-y-4">
        <div class="p-6 rounded-2xl bg-studio-900/60 border border-studio-800 text-center flex flex-col items-center">
          <StudioIcon name="cube" :size="28" class="text-slate-500 mb-2" />
          <div class="text-xs font-bold text-amber-400 mb-1">这一版不替换模型</div>
          <div class="text-[10px] text-slate-500 max-w-xs">当前版本仅支持材质与色号精细重着色，模型实体替换功能保留接口标准。</div>
        </div>
      </div>

      <!-- 3. 光泽度与粗糙度滑块 (保留原有高级微调) -->
      <div class="pt-3 border-t border-studio-800 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold text-slate-400">表面光泽</span>
          <div class="flex gap-1">
            <button
              v-for="f in ['matte', 'satin', 'gloss']"
              :key="f"
              type="button"
              @click="finish = f; emitSelection()"
              class="px-2 py-0.5 rounded text-[10px] transition cursor-pointer"
              :class="finish === f ? 'bg-studio-accent text-white font-bold' : 'bg-studio-850 text-slate-400 hover:text-slate-200'"
            >
              {{ f === 'matte' ? '哑光' : (f === 'satin' ? '柔抛' : '高光') }}
            </button>
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between text-[11px] mb-1">
            <span class="text-slate-400">肌理微距粗糙度</span>
            <span class="text-white font-mono">{{ roughness }}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            v-model.number="roughness"
            @input="emitSelection"
            class="w-full accent-studio-accent h-1 bg-studio-800 rounded-lg cursor-pointer"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import StudioIcon from './StudioIcon.vue';
import { getToken } from '../api';

const props = defineProps({
  inferredSurface: { type: String, default: '' },
  initialSurface: { type: String, default: 'wall' },
  initialSubclass: { type: String, default: 'wall_paint' },
  modelValue: { type: Object, default: () => ({}) }
});

const emit = defineEmits(['update:modelValue', 'change']);

const surfaces = ref([]);
const activeSurface = ref(props.initialSurface || 'wall');
const activeSubclass = ref(props.initialSubclass || 'wall_paint');

const paints = ref([]);
const materials = ref([]);
const selectedAssetId = ref('');
const selectedHex = ref('');
const selectedPresetId = ref('');
const selectedPaintMeta = ref(null);
const useShell = ref(false);
const finish = ref('matte');
const roughness = ref(15);

// 兜底常用单色 (纯 HEX，不再塞 SVG)
const fallbackPaints = [
  { name: '羊脂白', hex: '#F7F6F2' },
  { name: '石灰白', hex: '#EAE8E1' },
  { name: '冷灰', hex: '#BCC3C8' },
  { name: '暖灰', hex: '#BEB7AE' },
  { name: '鼠尾草绿', hex: '#9CAF88' },
  { name: '焦糖棕', hex: '#9E5B32' },
  { name: '黑曜石', hex: '#222325' }
];

// 兜底文字预设槽 (纯文字，不再塞 SVG)
const fallbackSlots = [
  { id: 'micro_cement', name: '浅灰微水泥' },
  { id: 'travertine_stone', name: '米黄洞石' },
  { id: 'walnut_wood', name: '胡桃木纹' },
  { id: 'linen_fabric', name: '亚麻粗纺' },
  { id: 'brushed_brass', name: '拉丝黄铜' },
  { id: 'tinted_glass', name: '高级灰玻' }
];

function authedUrl(url) {
  if (!url) return '';
  const token = getToken();
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

function surfaceLabel(key) {
  const match = surfaces.value.find(s => s.key === key);
  return match ? match.label : key;
}

const currentSurfaceObj = computed(() => {
  return surfaces.value.find(s => s.key === activeSurface.value) || null;
});

const currentSurfaceSubclasses = computed(() => {
  return currentSurfaceObj.value?.subclasses || [];
});

const currentSubclassObj = computed(() => {
  return currentSurfaceSubclasses.value.find(sub => sub.key === activeSubclass.value) || currentSurfaceSubclasses.value[0] || null;
});

const currentWarehouse = computed(() => {
  return currentSubclassObj.value?.warehouses?.[0] || 'material';
});

async function loadTaxonomy() {
  try {
    const res = await fetch('/api/base-library/taxonomy', {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const json = await res.json();
    if (json.success && json.data?.surfaces) {
      surfaces.value = json.data.surfaces;
    }
  } catch (e) {
    console.warn('分类法加载失败:', e);
  }
}

async function loadWarehouseData() {
  const token = getToken();
  const wh = currentWarehouse.value;
  selectedAssetId.value = '';
  selectedPaintMeta.value = null;

  try {
    if (wh === 'paint') {
      const res = await fetch(`/api/base-library/paints?subclass=${encodeURIComponent(activeSubclass.value)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success) paints.value = json.data || [];
    } else if (wh === 'material') {
      const res = await fetch(`/api/base-library/materials?subclass=${encodeURIComponent(activeSubclass.value)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success) materials.value = json.data || [];
    }
  } catch (e) {
    console.warn('加载仓库资源失败:', e);
  }
}

function changeSurface(sKey) {
  activeSurface.value = sKey;
  const match = surfaces.value.find(s => s.key === sKey);
  if (match && match.subclasses?.length > 0) {
    activeSubclass.value = match.subclasses[0].key;
  }
  loadWarehouseData();
  emitSelection();
}

function changeSubclass(subKey) {
  activeSubclass.value = subKey;
  loadWarehouseData();
  emitSelection();
}

function selectPaint(p) {
  selectedAssetId.value = p.id;
  selectedPaintMeta.value = p;
  selectedHex.value = p.hex;
  useShell.value = Boolean(p.shell_material_id);
  emitSelection();
}

function selectFallbackColor(c) {
  selectedAssetId.value = '';
  selectedPaintMeta.value = null;
  selectedHex.value = c.hex;
  emitSelection();
}

function selectMaterial(m) {
  selectedAssetId.value = m.id;
  emitSelection();
}

function selectFallbackSlot(slot) {
  selectedAssetId.value = '';
  selectedPresetId.value = slot.id;
  emitSelection();
}

function emitSelection() {
  const payload = {
    surface: activeSurface.value,
    subclass: activeSubclass.value,
    warehouse: currentWarehouse.value,
    asset_id: selectedAssetId.value || null,
    use_shell: useShell.value,
    hex: selectedHex.value || null,
    preset_id: selectedPresetId.value || null,
    finish: finish.value,
    roughness: roughness.value
  };
  emit('update:modelValue', payload);
  emit('change', payload);
}

watch(() => props.inferredSurface, (newVal) => {
  if (newVal && surfaces.value.some(s => s.key === newVal)) {
    // 门槛 >= 0.75 且用户尚未手动选定具体资产或色值时自动展开该装修面货架
    if (!selectedAssetId.value && !selectedHex.value && !selectedPresetId.value) {
      changeSurface(newVal);
    }
  }
});

onMounted(async () => {
  await loadTaxonomy();
  await loadWarehouseData();
});
</script>
