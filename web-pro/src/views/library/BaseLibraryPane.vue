<template>
  <div class="h-full flex flex-col bg-studio-950 text-slate-100 overflow-hidden">
    <!-- 头部工具栏 -->
    <div class="p-4 border-b border-studio-800 bg-studio-900/60 backdrop-blur-md flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center space-x-3">
        <div class="w-8 h-8 rounded-lg bg-studio-accent/20 border border-studio-accent/40 flex items-center justify-center text-studio-accent font-bold">
          <StudioIcon :name="warehouseIcon" :size="18" />
        </div>
        <div>
          <h2 class="text-sm font-bold text-white flex items-center gap-2">
            {{ warehouseTitle }}
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-studio-800 text-slate-400 font-normal">基础素材</span>
            <span v-if="warehouse === 'model'" class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-normal border border-amber-500/30">409契约就绪</span>
          </h2>
          <p class="text-[11px] text-slate-400">{{ warehouseSubtitle }}</p>
        </div>
      </div>

      <!-- 右侧控制区 -->
      <div class="flex items-center space-x-3">
        <!-- 搜索框 -->
        <div v-if="warehouse === 'material' || warehouse === 'paint' || warehouse === 'model'" class="relative">
          <input
            v-model="localSearchQuery"
            type="text"
            :placeholder="searchPlaceholderText"
            @keyup.enter="refreshList"
            class="w-64 pl-8 pr-3 py-1.5 rounded-xl bg-studio-850 border border-studio-750 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-studio-accent"
          />
          <div class="absolute left-2.5 top-2 text-slate-500">
            <StudioIcon name="search" :size="14" />
          </div>
        </div>

        <!-- 色号库独有筛选：品牌与置顶 -->
        <template v-if="warehouse === 'paint'">
          <select
            v-model="localBrand"
            @change="onBrandChange"
            class="px-2.5 py-1.5 rounded-xl bg-studio-850 border border-studio-750 text-xs text-slate-200 focus:outline-none"
          >
            <option value="">全部品牌</option>
            <option value="nippon-paint">立邦 (Nippon Paint)</option>
            <option value="dulux">多乐士 (Dulux)</option>
          </select>
          <label class="flex items-center space-x-1.5 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" v-model="localPinnedOnly" @change="onPinnedChange" class="rounded bg-studio-800 text-studio-accent" />
            <span>仅置顶</span>
          </label>
        </template>

        <!-- 管理员远程搜索入库入口 (PR5) -->
        <button
          v-if="isAdmin && (warehouse === 'material' || warehouse === 'paint')"
          @click="showSearchModal = true"
          class="px-3 py-1.5 rounded-xl bg-studio-accent hover:bg-studio-accent/90 text-white text-xs font-bold flex items-center space-x-1 transition shadow-sm cursor-pointer"
        >
          <StudioIcon name="plus" :size="14" />
          <span>{{ warehouse === 'material' ? '从开源站收录材质' : '管理色号镜像' }}</span>
        </button>
      </div>
    </div>

    <!-- 装修面筛选芯片条 (仅材质有效) -->
    <div
      v-if="warehouse === 'material'"
      class="px-4 py-2.5 border-b border-studio-800/80 bg-studio-900/30 flex items-center space-x-2 overflow-x-auto scrollbar-none"
    >
      <span class="text-xs text-slate-400 font-medium whitespace-nowrap mr-1">装修面货架:</span>
      <button
        type="button"
        @click="selectSurface('')"
        class="px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer"
        :class="localSurface === '' ? 'bg-studio-accent text-white shadow-xs' : 'bg-studio-850 text-slate-400 hover:text-slate-200'"
      >
        全部装修面
      </button>
      <button
        v-for="s in surfaces"
        :key="s.key"
        type="button"
        @click="selectSurface(s.key)"
        class="px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer flex items-center space-x-1"
        :class="localSurface === s.key ? 'bg-studio-accent text-white shadow-xs' : 'bg-studio-850 text-slate-400 hover:text-slate-200'"
      >
        <span>{{ s.label }}</span>
      </button>
    </div>

    <!-- 色系筛选芯片条 (仅色号库有效) -->
    <div
      v-if="warehouse === 'paint'"
      class="px-4 py-2.5 border-b border-studio-800/80 bg-studio-900/30 flex items-center space-x-2 overflow-x-auto scrollbar-none"
    >
      <span class="text-xs text-slate-400 font-medium whitespace-nowrap mr-1">色系货架:</span>
      <button
        type="button"
        @click="selectFamily('')"
        class="px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer"
        :class="localFamily === '' ? 'bg-studio-accent text-white shadow-xs' : 'bg-studio-850 text-slate-400 hover:text-slate-200'"
      >
        全部色系
      </button>
      <button
        v-for="fam in PAINT_FAMILIES"
        :key="fam.key"
        type="button"
        @click="selectFamily(fam.key)"
        class="px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer"
        :class="localFamily === fam.key ? 'bg-studio-accent text-white shadow-xs' : 'bg-studio-850 text-slate-400 hover:text-slate-200'"
      >
        <span>{{ fam.label }}</span>
      </button>
    </div>

    <!-- 主展示区域 -->
    <div class="flex-1 overflow-y-auto p-4">
      <!-- 1. 材质库网格 -->
      <template v-if="warehouse === 'material'">
        <div v-if="loading" class="h-64 flex items-center justify-center text-slate-500 text-xs">
          正在加载材质仓库...
        </div>
        <div v-else-if="filteredMaterials.length === 0" class="h-64 flex flex-col items-center justify-center text-slate-500 text-xs">
          <StudioIcon name="image" :size="32" class="mb-2 opacity-40" />
          <span>暂无符合条件的材质资产</span>
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          <div
            v-for="mat in filteredMaterials"
            :key="mat.id"
            class="rounded-xl bg-studio-900 border border-studio-800 hover:border-studio-accent/60 overflow-hidden flex flex-col group transition shadow-sm"
          >
            <div class="relative aspect-square bg-studio-950 overflow-hidden">
              <img :src="authedUrl(mat.thumb_url)" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              <div v-if="mat.is_shell" class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-amber-500/80 text-black text-[10px] font-bold">
                底色壳
              </div>
            </div>
            <div class="p-2.5 flex-1 flex flex-col justify-between">
              <div>
                <div class="text-xs font-bold text-white truncate" :title="mat.name_cn">{{ mat.name_cn }}</div>
                <div class="flex flex-wrap gap-1 mt-1.5">
                  <span
                    v-for="t in mat.tags"
                    :key="t.surface + '_' + t.subclass"
                    class="text-[9px] px-1 py-0.5 rounded bg-studio-800 text-slate-300 font-mono"
                  >
                    {{ t.subclass }}
                  </span>
                </div>
              </div>
              <!-- 来源 CC0 署名 -->
              <div class="mt-3 pt-1.5 border-t border-studio-800/60 flex items-center justify-between text-[10px] text-slate-500">
                <span class="truncate">{{ mat.credit }}</span>
                <a
                  v-if="mat.source === 'polyhaven' && mat.source_id"
                  :href="`https://polyhaven.com/a/${mat.source_id}`"
                  target="_blank"
                  class="text-studio-accent hover:underline ml-1"
                >来源</a>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 2. 色号库网格 -->
      <template v-else-if="warehouse === 'paint'">
        <div v-if="loading" class="h-64 flex items-center justify-center text-slate-500 text-xs">
          正在加载色号仓库...
        </div>
        <div v-else-if="filteredPaints.length === 0" class="h-64 flex flex-col items-center justify-center text-slate-500 text-xs">
          <StudioIcon name="palette" :size="32" class="mb-2 opacity-40" />
          <span>色号库未同步或无匹配色号</span>
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          <div
            v-for="p in filteredPaints"
            :key="p.id"
            class="rounded-xl bg-studio-900 border border-studio-800 hover:border-studio-accent/60 overflow-hidden flex flex-col group transition shadow-sm"
          >
            <!-- 动态生成的 256x256 色块 -->
            <div class="relative aspect-4/3 bg-studio-950 flex items-center justify-center overflow-hidden">
              <img :src="authedUrl(p.swatch_url)" class="w-full h-full object-cover" />
              <div v-if="p.pinned" class="absolute top-1.5 right-1.5 px-1 py-0.5 rounded bg-amber-500 text-black text-[9px] font-bold">
                置顶
              </div>
            </div>
            <div class="p-2 flex-1 flex flex-col justify-between">
              <div>
                <div class="text-xs font-bold text-white font-mono truncate">{{ p.code }}</div>
                <div class="text-[11px] text-slate-300 truncate mt-0.5">{{ p.name_zh || p.name_en }}</div>
                <div class="text-[9px] text-slate-500 uppercase mt-0.5">{{ p.brand }} · {{ p.hex }}</div>
              </div>
              <div class="mt-2 pt-1 border-t border-studio-800/60 flex items-center justify-between text-[9px] text-slate-500">
                <span>{{ p.family || '色卡' }}</span>
                <a
                  v-if="p.source_url"
                  :href="p.source_url"
                  target="_blank"
                  class="text-studio-accent hover:underline"
                >PaintDB</a>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 3. 灯具库预设 -->
      <template v-else-if="warehouse === 'light'">
        <div class="max-w-4xl mx-auto space-y-6">
          <div class="p-4 rounded-2xl bg-studio-900 border border-studio-800">
            <h3 class="text-sm font-bold text-white mb-1 flex items-center gap-1.5">
              <StudioIcon name="sun" :size="16" class="text-amber-400" />
              五档投光朝向预设
            </h3>
            <p class="text-xs text-slate-400 mb-4">精准空间全局光线入射方位，作为提示词光向算子映射</p>
            <div class="grid grid-cols-5 gap-3">
              <div
                v-for="d in filteredLightDirections"
                :key="d.id"
                class="p-3 rounded-xl border text-center flex flex-col items-center justify-center transition"
                :class="localDirection && localDirection === d.direction_key ? 'bg-studio-accent/20 border-studio-accent' : 'bg-studio-850 border-studio-750'"
              >
                <div class="w-8 h-8 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold text-xs mb-2">
                  {{ d.sort / 10 }}
                </div>
                <div class="text-xs font-bold text-white">{{ d.label_zh }}</div>
                <div class="text-[10px] text-slate-400 font-mono mt-0.5">{{ d.direction_key }}</div>
              </div>
            </div>
          </div>

          <div class="p-4 rounded-2xl bg-studio-900 border border-studio-800">
            <h3 class="text-sm font-bold text-white mb-1 flex items-center gap-1.5">
              <StudioIcon name="sliders" :size="16" class="text-blue-400" />
              五档色温色标预设
            </h3>
            <p class="text-xs text-slate-400 mb-4">色温物理锚点 Kelvin 档位预置</p>
            <div class="grid grid-cols-5 gap-3">
              <div
                v-for="c in filteredLightCcts"
                :key="c.id"
                class="p-3 rounded-xl border text-center flex flex-col items-center justify-center transition"
                :class="localCct && Number(localCct) === c.kelvin ? 'bg-blue-500/20 border-blue-400' : 'bg-studio-850 border-studio-750'"
              >
                <div class="text-sm font-bold text-white font-mono mb-1">{{ c.kelvin }}K</div>
                <div class="text-xs text-slate-300">{{ c.label_zh }}</div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 4. 模型库完整架构与资产范畴 -->
      <template v-else-if="warehouse === 'model'">
        <div class="space-y-6 max-w-6xl mx-auto">
          <!-- 顶部说明卡片 -->
          <div class="p-4 rounded-2xl bg-studio-900 border border-studio-800 flex items-start justify-between">
            <div>
              <div class="flex items-center space-x-2">
                <div class="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <StudioIcon name="cube" :size="16" />
                </div>
                <h3 class="text-sm font-bold text-white">模型仓库资产架构与范畴</h3>
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">409契约防护已就绪</span>
              </div>
              <p class="text-xs text-slate-400 mt-2 max-w-2xl leading-relaxed">
                模型库覆盖<strong>活动家具</strong>、<strong>定制柜体与木作</strong>、<strong>卫浴与厨电五金</strong>、<strong>软装陈设与绿植</strong>四大品类。当前版本完整承接标准化资产检索、规范格式（GLB/FBX/OBJ）与尺寸参数；主替换生成管线遵循 409 契约响应，待 3D 拓扑替换管线全量上线。
              </p>
            </div>
            <div class="text-right">
              <span class="text-xs text-slate-500 font-mono">共 {{ modelCategories.length }} 大品类资产</span>
            </div>
          </div>

          <!-- 品类切换芯片 -->
          <div class="flex items-center space-x-2 overflow-x-auto pb-1">
            <button
              v-for="cat in modelCategories"
              :key="cat.key"
              type="button"
              @click="localModelCategory = cat.key"
              class="px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer"
              :class="localModelCategory === cat.key ? 'bg-studio-accent text-white shadow-xs' : 'bg-studio-850 text-slate-400 hover:text-slate-200'"
            >
              <StudioIcon :name="cat.icon" :size="14" />
              <span>{{ cat.label }}</span>
              <span class="text-[10px] opacity-75 font-mono">({{ cat.items.length }})</span>
            </button>
          </div>

          <!-- 模型资产展示网格 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <div
              v-for="item in activeModelItems"
              :key="item.id"
              class="p-3.5 rounded-2xl bg-studio-900 border border-studio-800 hover:border-studio-accent/60 transition flex flex-col justify-between group shadow-sm"
            >
              <div>
                <div class="relative aspect-4/3 rounded-xl bg-studio-950 flex flex-col items-center justify-center overflow-hidden mb-3 border border-studio-800">
                  <StudioIcon :name="item.icon || 'cube'" :size="36" class="text-slate-600 group-hover:text-studio-accent/80 transition-colors" />
                  <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-studio-800/80 text-[10px] text-slate-300 font-mono">
                    {{ item.format }}
                  </div>
                  <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-mono">
                    {{ item.polycount }}
                  </div>
                  <div class="absolute bottom-1.5 left-2 text-[10px] text-slate-500 font-mono">
                    {{ item.dimensions }}
                  </div>
                </div>
                <h4 class="text-xs font-bold text-white truncate" :title="item.name">{{ item.name }}</h4>
                <p class="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{{ item.description }}</p>
                <div class="flex flex-wrap gap-1 mt-2">
                  <span
                    v-for="sub in item.subclasses"
                    :key="sub"
                    class="text-[9px] px-1.5 py-0.5 rounded bg-studio-850 text-slate-300 font-mono"
                  >
                    {{ sub }}
                  </span>
                </div>
              </div>

              <div class="mt-3 pt-2 border-t border-studio-800/60 flex items-center justify-between text-[10px] text-slate-500">
                <span>{{ item.categoryLabel }}</span>
                <span class="text-amber-400/90 font-medium">409 契约响应</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 弹窗：收录与搜索 (PR5) -->
    <BaseLibrarySearch
      v-if="showSearchModal"
      :warehouse="warehouse"
      @close="showSearchModal = false"
      @imported="onImported"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import StudioIcon from '../../components/StudioIcon.vue';
import BaseLibrarySearch from './BaseLibrarySearch.vue';
import { getToken, getCurrentUser } from '../../api';

const props = defineProps({
  warehouse: {
    type: String,
    default: 'material' // 'material' | 'paint' | 'light' | 'model'
  },
  surface: {
    type: String,
    default: ''
  },
  matSource: {
    type: String,
    default: ''
  },
  shellOnly: {
    type: Boolean,
    default: false
  },
  brand: {
    type: String,
    default: ''
  },
  family: {
    type: String,
    default: ''
  },
  pinnedOnly: {
    type: Boolean,
    default: false
  },
  direction: {
    type: String,
    default: ''
  },
  cct: {
    type: [String, Number],
    default: ''
  },
  modelCategory: {
    type: String,
    default: 'furniture'
  },
  searchQuery: {
    type: String,
    default: ''
  }
});

const emit = defineEmits([
  'update:surface',
  'update:brand',
  'update:family',
  'update:pinnedOnly',
  'update:modelCategory'
]);

const currentUser = getCurrentUser();
const isAdmin = computed(() => currentUser?.role === 'admin');

const loading = ref(false);
const localSearchQuery = ref(props.searchQuery || '');
const localSurface = ref(props.surface || '');
const localMatSource = ref(props.matSource || '');
const localShellOnly = ref(props.shellOnly || false);
const localBrand = ref(props.brand || '');
const localFamily = ref(props.family || '');
const localPinnedOnly = ref(props.pinnedOnly || false);
const localDirection = ref(props.direction || '');
const localCct = ref(props.cct || '');
const localModelCategory = ref(props.modelCategory || 'furniture');
const showSearchModal = ref(false);

const surfaces = ref([]);
const materials = ref([]);
const paints = ref([]);
const lights = ref({ directions: [], ccts: [] });

const PAINT_FAMILIES = [
  { key: 'off-white', label: '米白珍珠' },
  { key: 'beige', label: '暖调米咖' },
  { key: 'greige', label: '原麻灰米' },
  { key: 'gray', label: '现代冷灰' },
  { key: 'green', label: '复古草绿' },
  { key: 'ivory', label: '中性象牙' },
  { key: 'white', label: '纯净雪域' }
];

// 模型库标准化资产范畴规范数据 (解答用户关于模型库包含哪些的核心疑问)
const modelCategories = [
  {
    key: 'furniture',
    label: '活动家具',
    icon: 'home',
    items: [
      {
        id: 'mod_sofa_01',
        name: '意式极简直排三人真皮沙发',
        description: '头层纳帕真皮，超宽坐深模块化设计',
        categoryLabel: '活动家具',
        subclasses: ['沙发', '客厅'],
        format: 'GLB/FBX',
        polycount: '68K Polys',
        dimensions: '2600×950×780mm',
        icon: 'cube'
      },
      {
        id: 'mod_table_01',
        name: '天然白橡木实木茶几',
        description: '钝角防撞圆弧边，开放式环保木蜡油质感',
        categoryLabel: '活动家具',
        subclasses: ['茶几', '客厅'],
        format: 'GLB',
        polycount: '24K Polys',
        dimensions: '1200×600×420mm',
        icon: 'layers'
      },
      {
        id: 'mod_chair_01',
        name: '中古马鞍皮复古扶手单椅',
        description: '镀铬不锈钢骨架，手工缝线马鞍皮椅面',
        categoryLabel: '活动家具',
        subclasses: ['休闲单椅', '书房/客厅'],
        format: 'GLB/FBX',
        polycount: '42K Polys',
        dimensions: '750×780×820mm',
        icon: 'user'
      },
      {
        id: 'mod_bed_01',
        name: '极简软包双人悬浮大床',
        description: '亲肤高支棉麻软包靠背，隐藏式地灯悬浮底座',
        categoryLabel: '活动家具',
        subclasses: ['双人床', '卧室'],
        format: 'GLB',
        polycount: '85K Polys',
        dimensions: '2150×1880×920mm',
        icon: 'home'
      }
    ]
  },
  {
    key: 'millwork',
    label: '定制柜体木作',
    icon: 'grid',
    items: [
      {
        id: 'mod_wardrobe_01',
        name: '一门到顶无把手极简衣帽柜',
        description: '免漆护墙同色收口，内置感应斜照暖白灯带',
        categoryLabel: '定制木作',
        subclasses: ['衣柜', '主卧/衣帽间'],
        format: 'GLB',
        polycount: '18K Polys',
        dimensions: '2800×600×2700mm',
        icon: 'grid'
      },
      {
        id: 'mod_island_01',
        name: '鱼肚白岩板西厨中岛台',
        description: '45度倒角无缝拼接，带轨道插座与储物拉篮',
        categoryLabel: '定制木作',
        subclasses: ['岛台', '西厨/餐厅'],
        format: 'GLB/FBX',
        polycount: '32K Polys',
        dimensions: '2200×900×880mm',
        icon: 'layers'
      },
      {
        id: 'mod_tv_unit_01',
        name: '悬空大理石连体电视柜',
        description: '罗马洞石台面，哑光黑钛金属支撑托架',
        categoryLabel: '定制木作',
        subclasses: ['电视地柜', '客厅'],
        format: 'GLB',
        polycount: '15K Polys',
        dimensions: '3000×400×260mm',
        icon: 'monitor'
      }
    ]
  },
  {
    key: 'sanitary',
    label: '卫浴与厨电五金',
    icon: 'droplet',
    items: [
      {
        id: 'mod_bath_01',
        name: '亚克力一体成型独立浴缸',
        description: '人体工学弧线包裹，超薄溢流口设计',
        categoryLabel: '卫浴五金',
        subclasses: ['浴缸', '主卫'],
        format: 'GLB/OBJ',
        polycount: '54K Polys',
        dimensions: '1700×800×600mm',
        icon: 'droplet'
      },
      {
        id: 'mod_toilet_01',
        name: '壁挂式极简智能马桶',
        description: '暗装水箱同层排水，全功能感应冲水面板',
        categoryLabel: '卫浴五金',
        subclasses: ['马桶', '卫生间'],
        format: 'GLB',
        polycount: '28K Polys',
        dimensions: '560×370×380mm',
        icon: 'circle'
      },
      {
        id: 'mod_shower_01',
        name: '暗装预埋恒温大花洒系统',
        description: '枪灰色PVD真空镀膜，瀑布雨淋三档出水',
        categoryLabel: '厨卫五金',
        subclasses: ['花洒五金', '淋浴区'],
        format: 'GLB',
        polycount: '38K Polys',
        dimensions: '顶喷400×400mm',
        icon: 'sliders'
      }
    ]
  },
  {
    key: 'decor',
    label: '软装陈设与绿植',
    icon: 'sparkles',
    items: [
      {
        id: 'mod_plant_01',
        name: '侘寂高枝原生琴叶榕盆栽',
        description: '透气手工粗陶花盆，树形舒展自然',
        categoryLabel: '软装绿植',
        subclasses: ['大型绿植', '全空间适用'],
        format: 'GLB',
        polycount: '92K Polys',
        dimensions: 'Φ600×1900mm',
        icon: 'sun'
      },
      {
        id: 'mod_art_01',
        name: '大幅肌理砂岩抽象装饰画',
        description: '实木浮动外框，天然矿物颗粒立体堆叠',
        categoryLabel: '陈设摆件',
        subclasses: ['艺术挂画', '玄关/客厅'],
        format: 'GLB',
        polycount: '12K Polys',
        dimensions: '1200×1600×45mm',
        icon: 'image'
      },
      {
        id: 'mod_rug_01',
        name: '天然羊毛异形手工编织地毯',
        description: '高低绒毛肌理，大地原木色系拼色',
        categoryLabel: '布艺软装',
        subclasses: ['地毯', '客厅/茶歇区'],
        format: 'GLB',
        polycount: '48K Polys',
        dimensions: '3000×2000×18mm',
        icon: 'grid'
      }
    ]
  }
];

const activeModelItems = computed(() => {
  const cat = modelCategories.find(c => c.key === localModelCategory.value) || modelCategories[0];
  let list = cat.items;
  if (localSearchQuery.value && localSearchQuery.value.trim()) {
    const kw = localSearchQuery.value.trim().toLowerCase();
    list = list.filter(it => it.name.toLowerCase().includes(kw) || it.description.toLowerCase().includes(kw));
  }
  return list;
});

const warehouseTitle = computed(() => {
  switch (props.warehouse) {
    case 'material': return '材质库';
    case 'paint': return '色号库';
    case 'light': return '灯具库';
    case 'model': return '模型库';
    default: return '基础素材';
  }
});

const warehouseSubtitle = computed(() => {
  switch (props.warehouse) {
    case 'material': return '精准编辑读取的标准物理贴图仓库，装修面为货架标签';
    case 'paint': return '真实立邦、多乐士官方色卡与动态预览色块';
    case 'light': return '五档光向方位与五档物理色温 Kelvin 锚点预设';
    case 'model': return '包含活动家具、定制木作、厨卫五金、软装陈设四大资产架构';
    default: return '精准编辑读取的基础属性仓库';
  }
});

const warehouseIcon = computed(() => {
  switch (props.warehouse) {
    case 'material': return 'image';
    case 'paint': return 'palette';
    case 'light': return 'sun';
    case 'model': return 'cube';
    default: return 'layers';
  }
});

const searchPlaceholderText = computed(() => {
  switch (props.warehouse) {
    case 'material': return '搜索材质名称、来源ID...';
    case 'paint': return '搜索色号代码、名称、色系...';
    case 'model': return '搜索家具、柜体、五金洁具、软装...';
    default: return '搜索...';
  }
});

// 计算过滤后的材质列表
const filteredMaterials = computed(() => {
  let list = materials.value;
  if (localMatSource.value) {
    list = list.filter(m => m.source === localMatSource.value);
  }
  if (localShellOnly.value) {
    list = list.filter(m => m.is_shell);
  }
  return list;
});

// 计算过滤后的色号列表
const filteredPaints = computed(() => {
  let list = paints.value;
  if (localFamily.value) {
    list = list.filter(p => p.family === localFamily.value);
  }
  return list;
});

// 计算灯具方向过滤
const filteredLightDirections = computed(() => {
  const dirs = lights.value.directions || [];
  if (!localDirection.value) return dirs;
  return dirs.filter(d => d.direction_key === localDirection.value);
});

// 计算灯具色温过滤
const filteredLightCcts = computed(() => {
  const ccts = lights.value.ccts || [];
  if (!localCct.value) return ccts;
  return ccts.filter(c => Number(c.kelvin) === Number(localCct.value));
});

function authedUrl(url) {
  if (!url) return '';
  const token = getToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

async function loadTaxonomy() {
  try {
    const res = await fetch(`/api/base-library/taxonomy`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const json = await res.json();
    if (json.success && json.data?.surfaces) {
      surfaces.value = json.data.surfaces;
    }
  } catch (e) {
    console.warn('加载分类法失败:', e);
  }
}

async function refreshList() {
  loading.value = true;
  const token = getToken();
  try {
    if (props.warehouse === 'material') {
      const q = new URLSearchParams();
      if (localSurface.value) q.set('surface', localSurface.value);
      if (localMatSource.value) q.set('source', localMatSource.value);
      if (localShellOnly.value) q.set('is_shell', '1');
      if (localSearchQuery.value) q.set('q', localSearchQuery.value);
      const res = await fetch(`/api/base-library/materials?${q.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success) materials.value = json.data || [];
    } else if (props.warehouse === 'paint') {
      const q = new URLSearchParams();
      if (localBrand.value) q.set('brand', localBrand.value);
      if (localFamily.value) q.set('family', localFamily.value);
      if (localPinnedOnly.value) q.set('pinned', '1');
      if (localSearchQuery.value) q.set('q', localSearchQuery.value);
      const res = await fetch(`/api/base-library/paints?${q.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success) paints.value = json.data || [];
    } else if (props.warehouse === 'light') {
      const res = await fetch(`/api/base-library/lights`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success) lights.value = json.data || { directions: [], ccts: [] };
    }
  } catch (e) {
    console.warn('加载基础库数据失败:', e);
  } finally {
    loading.value = false;
  }
}

function selectSurface(key) {
  localSurface.value = key;
  emit('update:surface', key);
  refreshList();
}

function selectFamily(key) {
  localFamily.value = key;
  emit('update:family', key);
  refreshList();
}

function onBrandChange() {
  emit('update:brand', localBrand.value);
  refreshList();
}

function onPinnedChange() {
  emit('update:pinnedOnly', localPinnedOnly.value);
  refreshList();
}

function onImported() {
  showSearchModal.value = false;
  refreshList();
}

// 监听外部 Props 变化并与局部变量同步
watch(() => props.surface, (v) => {
  localSurface.value = v || '';
  refreshList();
});
watch(() => props.matSource, (v) => {
  localMatSource.value = v || '';
});
watch(() => props.shellOnly, (v) => {
  localShellOnly.value = !!v;
});
watch(() => props.brand, (v) => {
  localBrand.value = v || '';
  refreshList();
});
watch(() => props.family, (v) => {
  localFamily.value = v || '';
  refreshList();
});
watch(() => props.pinnedOnly, (v) => {
  localPinnedOnly.value = !!v;
  refreshList();
});
watch(() => props.direction, (v) => {
  localDirection.value = v || '';
});
watch(() => props.cct, (v) => {
  localCct.value = v || '';
});
watch(() => props.modelCategory, (v) => {
  localModelCategory.value = v || 'furniture';
});
watch(() => props.searchQuery, (v) => {
  localSearchQuery.value = v || '';
  refreshList();
});

watch(() => props.warehouse, () => {
  refreshList();
});

onMounted(async () => {
  await loadTaxonomy();
  await refreshList();
});
</script>
