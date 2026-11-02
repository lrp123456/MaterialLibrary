<template>
  <div v-if="open" class="fixed inset-0 z-[85] bg-studio-950 text-slate-100 flex flex-col">
    <header class="h-14 shrink-0 border-b border-studio-750 flex items-center justify-between px-5 bg-studio-900">
      <div>
        <h2 class="text-sm font-bold">基础属性工作台 · 精细风格 / 配色材质方案</h2>
        <p class="text-[11px] text-slate-400">方案只用于图生图换材质：替换颜色/材质，不改变结构、布局、透视和家具位置。</p>
      </div>
      <div class="flex items-center gap-2">
        <button type="button" class="px-3 py-1.5 rounded-lg bg-studio-800 border border-studio-700 text-xs font-bold hover:bg-studio-750" @click="$emit('extract')">提取材质</button>
        <button type="button" class="px-3 py-1.5 rounded-lg bg-studio-800 border border-studio-700 text-xs hover:bg-studio-750" @click="emit('close')">关闭</button>
      </div>
    </header>

    <div class="flex-1 min-h-0 grid grid-cols-[280px_1fr_360px]">
      <!-- 左：精细风格 -->
      <aside class="border-r border-studio-750 bg-studio-900/40 overflow-y-auto p-3 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-bold text-slate-300">精细风格</h3>
          <button type="button" class="text-[11px] px-2 py-1 rounded bg-studio-accent text-white font-bold" @click="startNewStyle">新建</button>
        </div>
        <div class="space-y-1">
          <button
            v-for="style in styles"
            :key="style.id"
            type="button"
            class="w-full text-left px-3 py-2 rounded-lg border text-xs"
            :class="selectedStyleId === style.id ? 'bg-studio-800 border-studio-accent text-white' : 'bg-studio-900 border-studio-800 hover:border-studio-700'"
            @click="selectStyle(style.id)"
          >
            <div class="font-bold truncate">{{ style.name_zh }}</div>
            <div class="text-[10px] text-slate-400 truncate">{{ parentLabel(style.parent_style_key) }} · {{ style.scheme_count }} 套方案</div>
          </button>
        </div>
      </aside>

      <!-- 中：方案槽位 -->
      <section class="overflow-y-auto p-4 space-y-4">
        <div v-if="!selectedStyle" class="h-full flex items-center justify-center text-sm text-slate-500">请选择或新建一个精细风格</div>
        <template v-else>
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-base font-bold">{{ selectedStyle.name_zh }}</h3>
              <p class="text-xs text-slate-400">{{ selectedStyle.description || '暂无描述' }}</p>
            </div>
            <div class="flex gap-2">
              <button type="button" class="px-3 py-1.5 rounded-lg bg-studio-800 border border-studio-700 text-xs" @click="startNewScheme">新建方案</button>
              <button type="button" class="px-3 py-1.5 rounded-lg bg-studio-800 border border-studio-700 text-xs" @click="editStyleDraft(selectedStyle)">编辑风格</button>
              <button type="button" class="px-3 py-1.5 rounded-lg bg-rose-900/60 border border-rose-800 text-xs" @click="removeStyle(selectedStyle.id)">删除</button>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              v-for="scheme in schemes"
              :key="scheme.id"
              type="button"
              class="px-3 py-1.5 rounded-lg border text-xs"
              :class="selectedSchemeId === scheme.id ? 'bg-studio-accent text-white border-studio-accent' : 'bg-studio-900 border-studio-750 hover:border-studio-600'"
              @click="selectScheme(scheme.id)"
            >
              {{ scheme.name_zh }}
            </button>
          </div>

          <div v-if="selectedScheme" class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <label class="text-xs space-y-1">
                <span class="text-slate-400">方案名称</span>
                <input v-model="schemeForm.name_zh" class="w-full rounded-lg bg-studio-950 border border-studio-700 p-2 text-white" />
              </label>
              <label class="text-xs space-y-1">
                <span class="text-slate-400">适用空间（逗号分隔）</span>
                <input v-model="spaceScopeText" class="w-full rounded-lg bg-studio-950 border border-studio-700 p-2 text-white" placeholder="living,bedroom" />
              </label>
            </div>
            <label class="block text-xs space-y-1">
              <span class="text-slate-400">方案说明</span>
              <textarea v-model="schemeForm.description" rows="2" class="w-full rounded-lg bg-studio-950 border border-studio-700 p-2 text-white"></textarea>
            </label>

            <div v-for="group in slotGroups" :key="group.key" class="rounded-xl border border-studio-750 bg-studio-900/50 overflow-hidden">
              <div class="px-3 py-2 bg-studio-900 text-xs font-bold">{{ group.label }}</div>
              <div class="divide-y divide-studio-800">
                <div v-for="row in group.rows" :key="row.key" class="grid grid-cols-[120px_1fr_auto] items-center gap-3 px-3 py-2">
                  <div class="text-xs">
                    <div class="font-bold">{{ row.roleLabel }}</div>
                    <div class="text-slate-500">{{ row.surfaceLabel }}</div>
                  </div>
                  <select v-model="slotSelection[row.key]" class="w-full rounded-lg bg-studio-950 border border-studio-700 p-2 text-xs text-white">
                    <option value="">不替换 / 留空</option>
                    <option v-for="item in (itemsCache[row.surface] || [])" :key="item.id" :value="item.id">
                      {{ item.name_zh }}<template v-if="itemWoodSuffix(item)"> · {{ itemWoodSuffix(item) }}</template><template v-if="item.brand || item.external_sku">（{{ [item.brand, item.external_sku].filter(Boolean).join(' ') }}）</template>
                    </option>
                  </select>
                  <img v-if="selectedItem(row.key)?.preview_rel" :src="itemPreviewUrl(selectedItem(row.key))" class="w-10 h-10 rounded object-cover border border-studio-700" />
                </div>
              </div>
            </div>

            <div class="flex justify-end gap-2">
              <button type="button" class="px-4 py-2 rounded-lg bg-studio-800 border border-studio-700 text-xs" @click="removeScheme(selectedScheme.id)">删除方案</button>
              <button type="button" class="px-4 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold" :disabled="saving" @click="saveScheme">{{ saving ? '保存中…' : '保存方案' }}</button>
            </div>
          </div>
        </template>
      </section>

      <!-- 右：风格表单 / AI 分析 -->
      <aside class="border-l border-studio-750 bg-studio-900/40 overflow-y-auto p-3 space-y-3">
        <h3 class="text-xs font-bold text-slate-300">风格信息</h3>
        <label class="block text-xs space-y-1">
          <span class="text-slate-400">名称</span>
          <input v-model="styleForm.name_zh" class="w-full rounded-lg bg-studio-950 border border-studio-700 p-2 text-white" placeholder="如：意式极简" />
        </label>
        <label class="block text-xs space-y-1">
          <span class="text-slate-400">筛选用父分类</span>
          <select v-model="styleForm.parent_style_key" class="w-full rounded-lg bg-studio-950 border border-studio-700 p-2 text-white">
            <option value="">不关联</option>
            <option v-for="p in parentStyles" :key="p.key" :value="p.key">{{ p.label }}</option>
          </select>
        </label>
        <label class="block text-xs space-y-1">
          <span class="text-slate-400">描述</span>
          <textarea v-model="styleForm.description" rows="3" class="w-full rounded-lg bg-studio-950 border border-studio-700 p-2 text-white"></textarea>
        </label>
        <button type="button" class="w-full px-3 py-2 rounded-lg bg-studio-accent text-white text-xs font-bold" :disabled="styleSaving" @click="saveStyle">{{ styleSaving ? '保存中…' : '保存风格' }}</button>

        <div class="pt-3 border-t border-studio-800 space-y-2">
          <h3 class="text-xs font-bold text-slate-300">AI 分析参考图</h3>
          <input type="file" accept="image/*" class="text-xs" @change="analyzeFile" />
          <p class="text-[10px] text-slate-500">AI 只产风格草稿与建议，确认后才入库。</p>
          <pre v-if="analysisNote" class="whitespace-pre-wrap text-[10px] text-amber-200 bg-studio-950 rounded p-2 max-h-40 overflow-auto">{{ analysisNote }}</pre>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { authFetch } from '../../api.js';

const props = defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(['close', 'saved', 'extract']);

const parentStyles = [
  { key: 'wabi_sabi', label: '侘寂' }, { key: 'song_aesthetic', label: '宋式美学' },
  { key: 'neo_chinese', label: '新中式' }, { key: 'classical_chinese', label: '古典中式' },
  { key: 'french', label: '法式' }, { key: 'italian', label: '意式' },
  { key: 'mediterranean', label: '地中海' }, { key: 'tuscan', label: '托斯卡纳' },
  { key: 'modern_minimal', label: '现代极简' }, { key: 'cream_style', label: '奶油风' },
  { key: 'mid_century', label: '中古风' }, { key: 'industrial', label: '工业风' },
  { key: 'american_modern', label: '现代美式' }, { key: 'american_country', label: '美式乡村' },
  { key: 'nanyang_resort', label: '南洋度假' },
  { key: 'natural_wood', label: '自然原木' }, { key: 'dark_wood', label: '深色原木' },
  { key: 'natural_vintage_wood', label: '自然复古原木' }, { key: 'dark_vintage_wood', label: '深色复古原木' },
  { key: 'other', label: '其他风格' }
];

const SLOT_GROUPS = [
  { key: 'base', label: '基础表面', rows: [
    { key: 'any:wall:base', space_key: 'any', surface: 'wall', role: 'base', roleLabel: '墙面基底', surfaceLabel: 'wall' },
    { key: 'any:ceiling:base', space_key: 'any', surface: 'ceiling', role: 'base', roleLabel: '顶面', surfaceLabel: 'ceiling' },
    { key: 'any:floor:any', space_key: 'any', surface: 'floor', role: 'any', roleLabel: '地面', surfaceLabel: 'floor' },
    { key: 'any:millwork:any', space_key: 'any', surface: 'millwork', role: 'any', roleLabel: '木作', surfaceLabel: 'millwork' },
    { key: 'any:metal:any', space_key: 'any', surface: 'metal', role: 'any', roleLabel: '金属饰面', surfaceLabel: 'metal' },
    { key: 'any:counter:any', space_key: 'any', surface: 'counter', role: 'any', roleLabel: '台面/石材', surfaceLabel: 'counter' }
  ]},
  { key: 'living', label: '软装 · 客厅', rows: [
    { key: 'living:soft:sofa', space_key: 'living', surface: 'soft', role: 'sofa', roleLabel: '沙发', surfaceLabel: 'soft' },
    { key: 'living:soft:curtain', space_key: 'living', surface: 'soft', role: 'curtain', roleLabel: '窗帘', surfaceLabel: 'soft' },
    { key: 'living:soft:rug', space_key: 'living', surface: 'soft', role: 'rug', roleLabel: '地毯', surfaceLabel: 'soft' }
  ]},
  { key: 'bedroom', label: '软装 · 卧室', rows: [
    { key: 'bedroom:soft:bed', space_key: 'bedroom', surface: 'soft', role: 'bed', roleLabel: '床/软包', surfaceLabel: 'soft' },
    { key: 'bedroom:soft:curtain', space_key: 'bedroom', surface: 'soft', role: 'curtain', roleLabel: '窗帘', surfaceLabel: 'soft' },
    { key: 'bedroom:soft:rug', space_key: 'bedroom', surface: 'soft', role: 'rug', roleLabel: '地毯', surfaceLabel: 'soft' }
  ]},
  { key: 'dining', label: '软装 · 餐厅', rows: [
    { key: 'dining:soft:chair', space_key: 'dining', surface: 'soft', role: 'chair', roleLabel: '餐椅', surfaceLabel: 'soft' },
    { key: 'dining:soft:curtain', space_key: 'dining', surface: 'soft', role: 'curtain', roleLabel: '窗帘', surfaceLabel: 'soft' },
    { key: 'dining:soft:rug', space_key: 'dining', surface: 'soft', role: 'rug', roleLabel: '地毯', surfaceLabel: 'soft' }
  ]},
  { key: 'study', label: '软装 · 书房', rows: [
    { key: 'study:soft:chair', space_key: 'study', surface: 'soft', role: 'chair', roleLabel: '座椅', surfaceLabel: 'soft' },
    { key: 'study:soft:curtain', space_key: 'study', surface: 'soft', role: 'curtain', roleLabel: '窗帘', surfaceLabel: 'soft' },
    { key: 'study:soft:rug', space_key: 'study', surface: 'soft', role: 'rug', roleLabel: '地毯', surfaceLabel: 'soft' }
  ]}
];

const styles = ref([]);
const schemes = ref([]);
const selectedStyleId = ref('');
const selectedSchemeId = ref('');
const styleForm = ref({ id: '', name_zh: '', parent_style_key: '', description: '' });
const schemeForm = ref({ id: '', name_zh: '', description: '' });
const spaceScopeText = ref('');
const slotSelection = ref({});
const itemsCache = ref({});
const saving = ref(false);
const styleSaving = ref(false);
const analysisNote = ref('');

const slotGroups = SLOT_GROUPS;
const selectedStyle = computed(() => styles.value.find((s) => s.id === selectedStyleId.value) || null);
const selectedScheme = computed(() => schemes.value.find((s) => s.id === selectedSchemeId.value) || null);

function parentLabel(key) {
  return parentStyles.find((p) => p.key === key)?.label || key || '未分组';
}

async function apiJson(url, options) {
  const res = await authFetch(url, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data;
}

async function loadStyles(selectId = '') {
  styles.value = await apiJson('/api/base-library/styles');
  if (selectId) selectedStyleId.value = selectId;
  if (!selectedStyleId.value && styles.value.length) selectedStyleId.value = styles.value[0].id;
  if (selectedStyleId.value) await loadSchemes(selectedStyleId.value);
}

async function loadSchemes(styleId) {
  schemes.value = await apiJson(`/api/base-library/schemes?style_id=${encodeURIComponent(styleId)}`);
}

async function selectStyle(id) {
  selectedStyleId.value = id;
  selectedSchemeId.value = '';
  await loadSchemes(id);
  const style = styles.value.find((s) => s.id === id);
  if (style) editStyleDraft(style);
}

function startNewStyle() {
  styleForm.value = { id: '', name_zh: '', parent_style_key: '', description: '' };
}

function editStyleDraft(style) {
  styleForm.value = {
    id: style.id,
    name_zh: style.name_zh || '',
    parent_style_key: style.parent_style_key || '',
    description: style.description || ''
  };
}

async function saveStyle() {
  if (!styleForm.value.name_zh.trim()) return alert('请填写风格名称');
  styleSaving.value = true;
  try {
    const saved = await apiJson('/api/base-library/styles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(styleForm.value)
    });
    await loadStyles(saved.id);
    emit('saved');
  } catch (e) {
    alert('保存风格失败: ' + e.message);
  } finally {
    styleSaving.value = false;
  }
}

async function removeStyle(id) {
  if (!confirm('删除该风格及其方案？')) return;
  await apiJson(`/api/base-library/styles/${encodeURIComponent(id)}`, { method: 'DELETE' });
  selectedStyleId.value = '';
  selectedSchemeId.value = '';
  await loadStyles();
  emit('saved');
}

function startNewScheme() {
  selectedSchemeId.value = '';
  schemeForm.value = { id: '', name_zh: `${selectedStyle.value?.name_zh || ''} 方案${schemes.value.length + 1}`, description: '' };
  spaceScopeText.value = 'living,bedroom';
  slotSelection.value = {};
}

function selectScheme(id) {
  const scheme = schemes.value.find((s) => s.id === id);
  if (!scheme) return;
  selectedSchemeId.value = id;
  schemeForm.value = { id: scheme.id, name_zh: scheme.name_zh, description: scheme.description || '' };
  spaceScopeText.value = (scheme.space_scope || []).join(',');
  const next = {};
  for (const slot of scheme.slots || []) {
    next[`${slot.space_key || 'any'}:${slot.surface}:${slot.role}`] = slot.item_id;
  }
  slotSelection.value = next;
}

function buildSlots() {
  const slots = [];
  for (const group of SLOT_GROUPS) {
    for (const row of group.rows) {
      const itemId = slotSelection.value[row.key];
      if (itemId) slots.push({ space_key: row.space_key, surface: row.surface, role: row.role, item_id: itemId });
    }
  }
  return slots;
}

async function saveScheme() {
  if (!schemeForm.value.name_zh.trim()) return alert('请填写方案名称');
  saving.value = true;
  try {
    const saved = await apiJson('/api/base-library/schemes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...schemeForm.value,
        style_id: selectedStyleId.value,
        style_leaf: selectedStyle.value?.parent_style_key || '',
        palette: [],
        space_scope: spaceScopeText.value.split(',').map((s) => s.trim()).filter(Boolean),
        slots: buildSlots()
      })
    });
    await loadSchemes(selectedStyleId.value);
    selectedSchemeId.value = saved.id;
    selectScheme(saved.id);
    await loadStyles(selectedStyleId.value);
    emit('saved');
  } catch (e) {
    alert('保存方案失败: ' + e.message);
  } finally {
    saving.value = false;
  }
}

async function removeScheme(id) {
  if (!confirm('删除这套方案？')) return;
  await apiJson(`/api/base-library/schemes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  selectedSchemeId.value = '';
  await loadSchemes(selectedStyleId.value);
  await loadStyles(selectedStyleId.value);
}

async function ensureItems(surface) {
  if (itemsCache.value[surface]) return;
  const data = await apiJson(`/api/base-library/items?has_preview=1&mount=${encodeURIComponent(surface)}`);
  itemsCache.value = { ...itemsCache.value, [surface]: data };
}

async function preloadItems() {
  await Promise.all(['wall', 'ceiling', 'floor', 'millwork', 'metal', 'soft', 'counter'].map(ensureItems));
}

function selectedItem(key) {
  const id = slotSelection.value[key];
  for (const group of SLOT_GROUPS) {
    for (const row of group.rows) {
      if (row.key === key) {
        return (itemsCache.value[row.surface] || []).find((i) => i.id === id) || null;
      }
    }
  }
  return null;
}

function itemPreviewUrl(item) {
  return `/api/base-library/items/${encodeURIComponent(item.id)}/preview?token=${localStorage.getItem('ml_token') || ''}`;
}

// 木纹 item 在下拉里追加：木种 / 纹理 / 拼法（固有属性，方向不旋转）
const WOOD_SPECIES_OPTION = {
  walnut: '胡桃木', white_oak: '白橡木', red_oak: '红橡木', ash: '白蜡木', cherry: '樱桃木',
  teak: '柚木', maple: '枫木', pine: '松木', rosewood: '玫瑰木', sapele: '沙比利',
  mahogany: '桃花心木', ebony: '黑檀', wenge: '鸡翅木', bamboo: '竹木', elm: '榆木',
  birch: '桦木', beech: '榉木', cedar: '杉木', olive: '橄榄木', okoume: '奥古曼',
  engineered: '工程木', mixed: '混拼木'
};
const WOOD_GRAIN_OPTION = {
  straight: '直纹', cathedral: '山纹', crossed: '交错', wavy: '波浪',
  ripple: '水波纹', ribbon: '丝带', knot: '结疤', distressed: '做旧'
};
const WOOD_LAYOUT_OPTION = {
  wide_plank: '宽板', narrow_plank: '窄板', herringbone: '人字拼',
  chevron: '鱼骨拼', parquet: '拼花', block: '方块'
};
function itemWoodSuffix(item) {
  if (!item || item.kind_key !== 'wood') return '';
  const bits = [];
  if (item.wood_species) bits.push(WOOD_SPECIES_OPTION[item.wood_species] || item.wood_species);
  if (item.grain_type) bits.push(WOOD_GRAIN_OPTION[item.grain_type] || item.grain_type);
  if (item.wood_layout && item.wood_layout !== 'plain') {
    bits.push(WOOD_LAYOUT_OPTION[item.wood_layout] || item.wood_layout);
  }
  return bits.slice(0, 3).join('/');
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function analyzeFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  analysisNote.value = 'AI 分析中…';
  try {
    const image_base64 = await readFileAsDataURL(file);
    const draft = await apiJson('/api/base-library/styles/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64 })
    });
    styleForm.value = {
      id: '',
      name_zh: draft.style?.name_zh || '',
      parent_style_key: draft.style?.parent_style_key || '',
      description: draft.style?.description || ''
    };
    analysisNote.value = `AI 建议：${draft.style?.name_zh}\n${draft.style?.description || ''}\n建议方案数：${(draft.schemes || []).length}`;
  } catch (err) {
    analysisNote.value = '分析失败：' + err.message;
  }
}

watch(() => props.open, (open) => {
  if (open) {
    loadStyles().catch((e) => alert(e.message));
    preloadItems().catch((e) => console.warn(e));
  }
});
</script>
