<template>
  <aside class="w-[380px] bg-studio-900 border-l border-studio-700 flex flex-col shrink-0 select-none z-20 h-full font-sans">
    <!-- 抽屉顶栏 -->
    <div class="h-14 px-4 border-b border-studio-700 flex items-center justify-between shrink-0 bg-studio-950/60">
      <div class="flex items-center gap-2">
        <StudioIcon name="sliders" :size="16" class="text-studio-accent" />
        <span class="font-bold text-sm text-white">全局配方</span>
      </div>
      <button
        type="button"
        @click="$emit('close')"
        class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-studio-800 cursor-pointer transition-colors"
        title="收起全局配方"
      >
        <StudioIcon name="close" :size="16" />
      </button>
    </div>

    <!-- 目标图指示条 -->
    <div class="px-4 py-2.5 bg-studio-950/80 border-b border-studio-800 flex items-center justify-between text-xs">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-slate-400 font-bold shrink-0">当前目标:</span>
        <span v-if="hasTargetImage" class="px-2 py-0.5 rounded bg-studio-cyan/15 text-studio-cyan font-mono font-bold text-xs shrink-0">
          {{ targetTag || '@图1' }}
        </span>
        <span v-else class="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 font-bold text-xs shrink-0 flex items-center gap-1">
          <StudioIcon name="alert-circle" :size="12" /> 未选参考图
        </span>
        <span v-if="targetImageName" class="text-slate-400 truncate text-[11px]" :title="targetImageName">
          {{ targetImageName }}
        </span>
        <span v-else-if="!hasTargetImage" class="text-rose-400/90 text-[11px] truncate">
          请先上传空间主图
        </span>
      </div>
      <div v-if="targetImageThumb" class="w-7 h-7 rounded border border-studio-700 overflow-hidden shrink-0">
        <img :src="targetImageThumb" class="w-full h-full object-cover" alt="" />
      </div>
    </div>

    <!-- 顶部 4 个功能 Tab 切换：风格、换空间、超分、去水印 -->
    <div class="p-3 border-b border-studio-800 shrink-0">
      <div class="grid grid-cols-4 gap-1 bg-studio-950 p-1 rounded-xl border border-studio-800 text-xs font-bold">
        <button
          type="button"
          @click="selectTab('style')"
          :class="[
            'py-2 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer',
            currentTab === 'style'
              ? 'bg-studio-850 text-white shadow-sm border border-studio-700'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          <StudioIcon name="palette" :size="13" />
          <span>风格</span>
        </button>

        <button
          type="button"
          @click="selectTab('space')"
          :class="[
            'py-2 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer',
            currentTab === 'space'
              ? 'bg-studio-850 text-white shadow-sm border border-studio-700'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          <StudioIcon name="refresh" :size="13" />
          <span>换空间</span>
        </button>

        <button
          type="button"
          @click="selectTab('upscale')"
          :class="[
            'py-2 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer',
            currentTab === 'upscale'
              ? 'bg-studio-850 text-white shadow-sm border border-studio-700'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          <StudioIcon name="maximize" :size="13" />
          <span>超分</span>
        </button>

        <button
          type="button"
          @click="selectTab('watermark')"
          :class="[
            'py-2 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer',
            currentTab === 'watermark'
              ? 'bg-studio-850 text-white shadow-sm border border-studio-700'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          <StudioIcon name="trash" :size="13" />
          <span>去水印</span>
        </button>
      </div>
    </div>

    <!-- 中部滚动区 -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
      <!-- ================= Tab 1: 风格转换 (基础素材 21 个精细风格) ================= -->
      <div v-if="currentTab === 'style'" class="space-y-3">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-300">基础素材精细风格 (21 款)</span>
          <span class="text-[10px] text-slate-500 font-mono">有方案即带真材质</span>
        </div>

        <!-- 21 风格列表 -->
        <div class="grid grid-cols-1 gap-2.5">
          <div
            v-for="st in fineStyles"
            :key="st.id"
            @click="selectFineStyle(st)"
            :class="[
              'rounded-xl border p-3 cursor-pointer transition-all space-y-2 select-none relative overflow-hidden',
              activeStyleId === st.id
                ? 'border-studio-accent bg-studio-accent/10 shadow-md ring-1 ring-studio-accent/30'
                : 'border-studio-800 bg-studio-950/70 hover:border-studio-700 hover:bg-studio-950'
            ]"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full" :class="st.scheme_count > 0 ? 'bg-emerald-400' : 'bg-slate-500'"></span>
                <span class="font-bold text-xs text-white">{{ st.name_zh }}</span>
              </div>
              <span
                v-if="st.scheme_count > 0"
                class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono font-bold"
              >
                {{ st.scheme_count }} 套真实方案
              </span>
              <span
                v-else
                class="text-[10px] px-2 py-0.5 rounded-full bg-studio-900 border border-studio-800 text-slate-500 font-mono"
              >
                暂无方案
              </span>
            </div>

            <p class="text-[11px] text-slate-400 leading-snug">
              {{ st.description || '保持原有空间结构、构图和主要家具位置。' }}
            </p>

            <!-- 选中展开区域 -->
            <div
              v-if="activeStyleId === st.id"
              class="pt-2 border-t border-studio-800/80 space-y-2 animate-in fade-in duration-150"
              @click.stop
            >
              <!-- 若该风格有真方案，列出方案卡片 -->
              <div v-if="st.scheme_count > 0 && styleSchemes[st.id]?.length" class="space-y-1.5">
                <span class="text-[11px] font-bold text-studio-cyan">选择落地方案:</span>
                <div class="space-y-1.5">
                  <div
                    v-for="scheme in styleSchemes[st.id]"
                    :key="scheme.id"
                    @click="applyScheme(st, scheme, false)"
                    :class="[
                      'p-2.5 rounded-lg border cursor-pointer transition-all flex flex-col gap-1.5',
                      activeSchemeId === scheme.id
                        ? 'border-studio-accent bg-studio-accent/20 text-white font-bold'
                        : 'border-studio-800 bg-studio-900/80 hover:border-studio-700 text-slate-300'
                    ]"
                  >
                    <div class="flex items-center justify-between">
                      <div class="text-xs">{{ scheme.name_zh }}</div>
                      <span v-if="activeSchemeId === scheme.id" class="text-studio-accent text-xs">✓ 已应用</span>
                    </div>
                    <div class="text-[10px] text-slate-400 leading-tight">{{ scheme.description || '各表面材质匹配方案' }}</div>
                    
                    <!-- 双模切换开关：纯文本轻量生图 vs 多图材质精准生图 -->
                    <div
                      v-if="activeSchemeId === scheme.id"
                      class="mt-1 pt-1.5 border-t border-studio-700/60 flex items-center justify-between text-[11px]"
                      @click.stop
                    >
                      <span class="text-slate-400 flex items-center gap-1 font-normal">
                        模式:
                        <span :class="schemeMountRefsMap[scheme.id] ? 'text-amber-300 font-bold' : 'text-studio-cyan font-bold'">
                          {{ schemeMountRefsMap[scheme.id] ? '多图参考 (精准质感)' : '纯文本配方 (轻量极速)' }}
                        </span>
                      </span>
                      <button
                        type="button"
                        @click="toggleMountRefs(st, scheme)"
                        class="px-2 py-0.5 rounded border text-[10px] font-bold transition-all cursor-pointer shadow-sm active:scale-95"
                        :class="schemeMountRefsMap[scheme.id]
                          ? 'border-amber-500/50 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                          : 'border-studio-cyan/50 bg-studio-cyan/20 text-studio-cyan hover:bg-studio-cyan/30'"
                      >
                        {{ schemeMountRefsMap[scheme.id] ? '切回纯文本' : '+ 引入材质参考图' }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 若该风格没有方案，明确提示，不编造方案 -->
              <div v-else-if="st.scheme_count === 0" class="p-2 rounded-lg bg-studio-900/60 border border-studio-800 text-[11px] text-slate-400 leading-relaxed">
                <span class="text-amber-400/90 font-bold">这个风格还没有方案。</span>
                已写入风格基础意向描述，不挂载空参考图。
              </div>

              <!-- 可微调的描述文本框 -->
              <div class="space-y-1">
                <div class="flex items-center justify-between text-[10px] text-slate-400">
                  <span class="font-bold text-slate-300">配方说明微调:</span>
                  <button
                    type="button"
                    @click="resetStyleDesc(st)"
                    class="text-[10px] text-slate-500 hover:text-slate-300 underline cursor-pointer"
                  >
                    恢复默认
                  </button>
                </div>
                <textarea
                  v-model="customizedStyleDesc"
                  rows="2"
                  @input="onStyleDescInput(st)"
                  class="w-full bg-studio-900 border border-studio-700 rounded-lg p-2 text-xs text-slate-100 font-sans outline-none focus:border-studio-accent leading-relaxed resize-none scrollbar-thin"
                ></textarea>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ================= Tab 2: 换空间 (结构化识别与 Lab 色差材质推荐) ================= -->
      <div v-else-if="currentTab === 'space'" class="space-y-3.5">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-300">换空间 (沿用材质与配色)</span>
          <span class="text-[10px] text-studio-cyan font-mono">互斥清空风格</span>
        </div>

        <!-- 目标空间类型选择 -->
        <div class="space-y-1">
          <label class="text-[11px] font-bold text-slate-400">目标空间类型</label>
          <div class="grid grid-cols-4 gap-1.5">
            <button
              v-for="sp in SPACE_OPTIONS"
              :key="sp.key"
              type="button"
              @click="targetSpaceKey = sp.key"
              :class="[
                'py-1.5 px-1 rounded-lg text-xs font-bold text-center cursor-pointer transition-colors truncate',
                targetSpaceKey === sp.key
                  ? 'bg-studio-accent text-white shadow-xs'
                  : 'bg-studio-950 border border-studio-800 text-slate-400 hover:text-slate-200'
              ]"
            >
              {{ sp.label }}
            </button>
          </div>
        </div>

        <!-- 原图结构化识别动作卡 -->
        <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-white flex items-center gap-1.5">
              <span>🔍 整图结构化表面读取</span>
            </span>
            <button
              type="button"
              @click="extractSurfacesFromImage"
              :disabled="extractingSurfaces"
              class="px-2.5 py-1 rounded-lg bg-studio-cyan/20 hover:bg-studio-cyan/30 text-studio-cyan border border-studio-cyan/40 text-xs font-bold cursor-pointer disabled:opacity-40 transition-colors flex items-center gap-1"
            >
              <StudioIcon v-if="extractingSurfaces" name="refresh" :size="12" class="animate-spin" />
              <span>{{ surfacesExtracted ? '重新识别' : '开始识别' }}</span>
            </button>
          </div>
          <p class="text-[11px] text-slate-400 leading-snug">
            自动读取原图的墙、顶、地、木作、软装、金属种类与色彩，按 Lab 色差给出推荐材质。
          </p>
        </div>

        <!-- 6 面材质推荐列表 (识别后展示) -->
        <div v-if="surfacesExtracted" class="space-y-3">
          <div
            v-for="item in spaceSurfaces"
            :key="item.key"
            class="p-2.5 rounded-xl bg-studio-950 border border-studio-800 space-y-2"
          >
            <!-- 表面标题行与识别信息 -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-full border border-white/20" :style="{ backgroundColor: item.hex }"></span>
                <span class="font-bold text-xs text-white">{{ item.label }}</span>
                <span class="text-[10px] text-slate-400">({{ item.desc || item.kind_key }})</span>
              </div>
              <span class="text-[10px] font-mono text-slate-400">{{ item.hex }}</span>
            </div>

            <!-- 子类切换行 -->
            <div class="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
              <button
                v-for="k in item.kinds"
                :key="k"
                type="button"
                @click="changeSurfaceKind(item, k)"
                :class="[
                  'px-2 py-0.5 rounded text-[10px] font-medium shrink-0 cursor-pointer transition-colors',
                  item.kind_key === k
                    ? 'bg-studio-cyan/20 text-studio-cyan border border-studio-cyan/40 font-bold'
                    : 'bg-studio-900 text-slate-400 hover:text-slate-200'
                ]"
              >
                {{ kindLabel(k) }}
              </button>
            </div>

            <!-- Lab 色差推荐材质条 -->
            <div class="space-y-1">
              <div class="text-[10px] text-slate-500 font-mono">建议采用 (色差最小):</div>
              <div class="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <div
                  v-for="rec in (spaceRecommendations[item.key] || [])"
                  :key="rec.id"
                  @click="item.selected = rec"
                  :class="[
                    'p-1.5 rounded-lg border shrink-0 w-24 cursor-pointer transition-all space-y-1',
                    item.selected?.id === rec.id
                      ? 'border-studio-accent bg-studio-accent/20 ring-1 ring-studio-accent'
                      : 'border-studio-800 bg-studio-900 hover:border-studio-700'
                  ]"
                  :title="`${rec.name_zh} (ΔE: ${rec.delta_e})`"
                >
                  <div class="w-full h-12 rounded bg-studio-950 overflow-hidden relative">
                    <img v-if="rec.preview_rel" :src="authedUrl(rec.preview_rel)" class="w-full h-full object-cover" />
                    <div v-else class="w-full h-full" :style="{ backgroundColor: rec.hex || '#666' }"></div>
                    <span v-if="rec.delta_e != null" class="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/60 text-[9px] font-mono text-emerald-300">
                      ΔE {{ rec.delta_e }}
                    </span>
                  </div>
                  <div class="text-[10px] font-bold text-white truncate">{{ rec.name_zh }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 确认写入配方按钮 -->
          <div class="pt-2">
            <button
              type="button"
              @click="confirmSpaceTransferRecipe"
              class="w-full py-2.5 rounded-xl bg-studio-accent hover:brightness-110 text-white text-xs font-bold shadow-md cursor-pointer transition-all flex items-center justify-center gap-2"
            >
              <StudioIcon name="check" :size="14" />
              <span>确认换空间配方并挂载材质图</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ================= Tab 3: 超分辨率 ================= -->
      <div v-else-if="currentTab === 'upscale'" class="space-y-3">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-300">图像细节放大增强</span>
          <span class="text-[10px] text-slate-500 font-mono">保持像素内容不变</span>
        </div>

        <div class="grid grid-cols-1 gap-2.5">
          <div
            v-for="scale in ['2K 高清增强', '4K 空间出版级', '8K 巨幕级']"
            :key="scale"
            @click="selectUpscale(scale)"
            :class="[
              'p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between',
              activeUpscale === scale
                ? 'border-studio-accent bg-studio-accent/15 text-white ring-1 ring-studio-accent'
                : 'border-studio-800 bg-studio-950/70 hover:border-studio-700 text-slate-300'
            ]"
          >
            <div>
              <div class="text-xs font-bold">{{ scale }}</div>
              <div class="text-[10px] text-slate-500 font-mono">增强清晰度与材质微肌理</div>
            </div>
            <span v-if="activeUpscale === scale" class="text-studio-accent font-bold text-xs">✓ 已选</span>
          </div>
        </div>
      </div>

      <!-- ================= Tab 4: 去水印 ================= -->
      <div v-else-if="currentTab === 'watermark'" class="space-y-3">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-300">画面无损去水印</span>
          <span class="text-[10px] text-slate-500 font-mono">智能擦除字样</span>
        </div>

        <div
          @click="selectWatermark"
          class="p-4 rounded-xl border border-studio-800 bg-studio-950/70 hover:border-studio-accent cursor-pointer transition-all text-center space-y-1.5"
        >
          <div class="text-xs font-bold text-white">去除当前目标图的所有水印与杂标</div>
          <div class="text-[11px] text-slate-400">保留空间原构图与全部材质质感，仅擦除水印标识</div>
        </div>
      </div>

      <!-- ================= 底部光照微调 (全局通用) ================= -->
      <div class="pt-3 border-t border-studio-800/80 space-y-3">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-300">光照一致性</span>
          <label class="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-400">
            <input type="checkbox" v-model="globalLightKeep" @change="onLightChange" class="accent-studio-accent" />
            <span>保持原图光照</span>
          </label>
        </div>

        <div v-if="!globalLightKeep" class="space-y-2.5 animate-in fade-in duration-150">
          <div class="space-y-1">
            <span class="text-[10px] text-slate-400 font-mono">屏幕主光方向:</span>
            <div class="grid grid-cols-5 gap-1">
              <button
                v-for="d in lightDirections"
                :key="d.key"
                type="button"
                @click="selectLightDir(d.key)"
                :class="[
                  'py-1 text-[10px] rounded border font-medium cursor-pointer transition-colors text-center truncate',
                  globalLightDir === d.key
                    ? 'bg-studio-accent/20 border-studio-accent text-studio-cyan font-bold'
                    : 'bg-studio-950 border-studio-800 text-slate-400 hover:text-slate-200'
                ]"
              >
                {{ d.label }}
              </button>
            </div>
          </div>

          <div class="space-y-1">
            <div class="flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span>色温 (Kelvin):</span>
              <span class="text-amber-300 font-bold">{{ globalKelvin }}K</span>
            </div>
            <input
              type="range"
              min="2700"
              max="6500"
              step="100"
              v-model.number="globalKelvin"
              @input="onLightChange"
              class="w-full accent-amber-400 cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 抽屉底栏：小字提示与快捷清空 -->
    <div class="p-3 border-t border-studio-800 bg-studio-950/80 flex items-center justify-between text-xs shrink-0">
      <div class="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
        <StudioIcon name="check" :size="13" />
        <span>已写入配方句，发送前可以改</span>
      </div>
      <button
        v-if="recipePrompt"
        type="button"
        @click="clearRecipe"
        class="text-[11px] text-slate-400 hover:text-rose-400 font-bold underline cursor-pointer transition-colors"
      >
        清空配方
      </button>
    </div>
  </aside>
</template>

<script setup>
import { ref, watch, onMounted, computed, reactive } from 'vue';
import StudioIcon from '@/components/StudioIcon.vue';
import { getToken } from '@/api';

const props = defineProps({
  recipePrompt: { type: String, default: '' },
  targetTag: { type: String, default: '@图1' },
  targetImageThumb: { type: String, default: '' },
  targetImageName: { type: String, default: '' },
  targetImageUrl: { type: String, default: '' },
  initialTab: { type: String, default: 'style' }
});

const emit = defineEmits(['update:recipePrompt', 'close', 'mount-refs', 'unmount-material-refs']);

const hasTargetImage = computed(() => {
  return Boolean(
    props.targetImageUrl ||
    props.targetImageThumb ||
    (props.targetImageName && props.targetImageName !== '未选择' && props.targetImageName !== '未上传' && props.targetImageName !== '空间原图')
  );
});

const currentTab = ref(props.initialTab || 'style');
const activeStyleId = ref('');
const activeStyleName = ref('');
const activeSchemeId = ref('');
const customizedStyleDesc = ref('');
const activeUpscale = ref('');

// 21 个精细风格数据
const fineStyles = ref([]);
const styleSchemes = ref({});
const schemeMountRefsMap = reactive({});
const schemeDataCache = reactive({});

// 换空间相关
const targetSpaceKey = ref('living');
const extractingSurfaces = ref(false);
const surfacesExtracted = ref(false);
const spaceSurfaces = ref([]);
const spaceRecommendations = ref({});

const SPACE_OPTIONS = [
  { key: 'living', label: '客厅' },
  { key: 'bedroom', label: '主卧' },
  { key: 'second_bedroom', label: '次卧' },
  { key: 'dining', label: '餐厅' },
  { key: 'study', label: '书房' },
  { key: 'tea_room', label: '茶室' },
  { key: 'bathroom', label: '卫生间' },
  { key: 'balcony', label: '阳台' }
];

const KIND_LABELS = {
  latex: '乳胶漆',
  wallpaper: '墙纸/布',
  microcement: '微水泥',
  wood: '木纹',
  wood_flooring: '木地板',
  tile: '瓷砖',
  stone: '大理石',
  fabric: '布艺',
  leather: '皮革',
  metal_finish: '金属',
  carpet: '地毯',
  furniture: '家具',
  fixture: '五金配件'
};

function kindLabel(k) {
  return KIND_LABELS[k] || k;
}

function authedUrl(url) {
  if (!url) return '';
  const token = getToken();
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

// 光照控制
const globalLightKeep = ref(true);
const globalLightDir = ref('top');
const globalKelvin = ref(4000);
const lightDirections = [
  { key: 'left', label: '画面左侧' },
  { key: 'upper_left', label: '左上' },
  { key: 'top', label: '正上' },
  { key: 'upper_right', label: '右上' },
  { key: 'right', label: '画面右侧' }
];

function selectLightDir(dirKey) {
  globalLightDir.value = dirKey;
  onLightChange();
}

function getLightSentence() {
  if (globalLightKeep.value) {
    return '保持原图的主光方向和阴影形状。';
  }
  const dirMap = {
    left: '画面左侧',
    upper_left: '左上',
    top: '正上',
    upper_right: '右上',
    right: '画面右侧'
  };
  const dirLabel = dirMap[globalLightDir.value] || '正上';
  return `主光来自${dirLabel}，阴影落向相反的一侧。色温约 ${globalKelvin.value}K。`;
}

function onLightChange() {
  if (currentTab.value === 'style' && activeStyleName.value) {
    writeStyleRecipe(activeStyleName.value, customizedStyleDesc.value);
  } else if (currentTab.value === 'upscale' && activeUpscale.value) {
    selectUpscale(activeUpscale.value);
  } else if (currentTab.value === 'watermark') {
    selectWatermark();
  }
}

// Tab 切换（换空间与风格同级、互斥）
function selectTab(tab) {
  currentTab.value = tab;
  if (tab === 'space') {
    // 选换空间清掉风格句
    activeStyleId.value = '';
    activeStyleName.value = '';
    activeSchemeId.value = '';
    emit('update:recipePrompt', '');
  } else if (tab === 'style') {
    // 选风格清掉换空间句
    emit('update:recipePrompt', '');
    if (activeStyleName.value) {
      writeStyleRecipe(activeStyleName.value, customizedStyleDesc.value);
    }
  } else if (tab === 'upscale' && activeUpscale.value) {
    selectUpscale(activeUpscale.value);
  } else if (currentTab.value === 'watermark') {
    selectWatermark();
  }
}

// 风格列表加载与操作
async function loadStyles() {
  try {
    const token = getToken();
    const res = await fetch('/api/base-library/styles', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      fineStyles.value = json.data;
    }
  } catch (e) {
    console.warn('加载风格列表失败:', e);
  }
}

async function selectFineStyle(st) {
  activeStyleId.value = st.id;
  activeStyleName.value = st.name_zh;
  activeSchemeId.value = '';
  customizedStyleDesc.value = st.description || '保持原有空间结构、构图和主要家具位置。';

  // 1. 如果该风格有方案，拉取真实方案列表
  if (st.scheme_count > 0 && !styleSchemes.value[st.id]) {
    try {
      const token = getToken();
      const res = await fetch(`/api/base-library/schemes?style_id=${encodeURIComponent(st.id)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        styleSchemes.value[st.id] = json.data;
        // 如果有且仅有方案，先默认选中第一个
        if (json.data.length > 0) {
          applyScheme(st, json.data[0]);
          return;
        }
      }
    } catch (_) {}
  }

  // 2. 如果该风格没有方案：只写风格名和风格说明，不挂空参考图
  writeStyleRecipe(st.name_zh, customizedStyleDesc.value);
}

async function applyScheme(st, scheme, forceMount = false) {
  if (!hasTargetImage.value) {
    alert('请先在看图区上传或选择一张室内空间主图作为参考图（图1）');
    return;
  }
  activeSchemeId.value = scheme.id;
  try {
    const token = getToken();
    const tag = props.targetTag || '@图1';
    let data = schemeDataCache[scheme.id];
    if (!data) {
      const res = await fetch(`/api/base-library/schemes/${encodeURIComponent(scheme.id)}/compile?target_tag=${encodeURIComponent(tag)}&start_ref_index=2`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success && json.data) {
        data = json.data;
        schemeDataCache[scheme.id] = data;
      }
    }

    if (data) {
      const light = getLightSentence();
      const isMount = Boolean(forceMount);
      schemeMountRefsMap[scheme.id] = isMount;

      if (isMount) {
        // 多图参考模式 (精准质感)
        const sentence = `${data.prompt_multimodal || data.prompt}${light ? `\n${light}` : ''}`;
        emit('update:recipePrompt', sentence);
        if (Array.isArray(data.refs) && data.refs.length > 0) {
          emit('mount-refs', data.refs.map(r => ({
            name: r.name || `${scheme.name_zh}_材质`,
            url: r.url || r.rel
          })));
        }
      } else {
        // 纯文本轻量配方模式 (默认快速)
        const sentence = `${data.prompt_text || data.prompt}${light ? `\n${light}` : ''}`;
        emit('update:recipePrompt', sentence);
        emit('unmount-material-refs');
      }
    }
  } catch (e) {
    console.warn('编译方案失败:', e);
  }
}

function toggleMountRefs(st, scheme) {
  const current = Boolean(schemeMountRefsMap[scheme.id]);
  applyScheme(st, scheme, !current);
}

function resetStyleDesc(st) {
  customizedStyleDesc.value = st.description || '';
  writeStyleRecipe(st.name_zh, customizedStyleDesc.value);
}

function onStyleDescInput(st) {
  writeStyleRecipe(st.name_zh, customizedStyleDesc.value);
}

function writeStyleRecipe(styleName, desc) {
  const tag = props.targetTag || '@图1';
  const cleanDesc = (desc || '').trim();
  const light = getLightSentence();
  const sentence = `将${tag}改为${styleName}。${cleanDesc ? `${cleanDesc}。` : ''}保持原有空间结构、构图和主要家具位置。${light ? `\n${light}` : ''}`;
  emit('update:recipePrompt', sentence);
}

// 换空间：整图结构化识别与 Lab 色差推荐
async function extractSurfacesFromImage() {
  extractingSurfaces.value = true;
  try {
    const token = getToken();
    const res = await fetch('/api/base-library/space/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        image_base64: props.targetImageUrl || props.targetImageThumb || null
      })
    });
    const json = await res.json();
    if (json.success && json.data) {
      const { surfaces, recommendations, specs } = json.data;
      spaceRecommendations.value = recommendations || {};
      const list = [];
      for (const spec of specs) {
        const s = surfaces[spec.key] || { surface: spec.key, label: spec.label, kind_key: spec.defaultKind, hex: '#CCCCCC' };
        const recs = recommendations[spec.key] || [];
        list.push({
          key: spec.key,
          label: spec.label,
          kind_key: s.kind_key,
          hex: s.hex || '#E0E0E0',
          desc: s.desc || '',
          kinds: spec.kinds || [s.kind_key],
          selected: recs.length ? recs[0] : null
        });
      }
      spaceSurfaces.value = list;
      surfacesExtracted.value = true;
    }
  } catch (e) {
    console.warn('换空间识别失败:', e);
  } finally {
    extractingSurfaces.value = false;
  }
}

async function changeSurfaceKind(item, newKind) {
  item.kind_key = newKind;
  try {
    const token = getToken();
    const res = await fetch(`/api/base-library/space/recommend?surface=${encodeURIComponent(item.key)}&kind_key=${encodeURIComponent(newKind)}&hex=${encodeURIComponent(item.hex || '')}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      spaceRecommendations.value[item.key] = json.data;
      item.selected = json.data.length ? json.data[0] : null;
    }
  } catch (_) {}
}

function confirmSpaceTransferRecipe() {
  const tag = props.targetTag || '@图1';
  const spaceObj = SPACE_OPTIONS.find(s => s.key === targetSpaceKey.value) || { label: '目标空间' };
  const lines = spaceSurfaces.value.map(item => {
    const sel = item.selected;
    const name = sel ? sel.name_zh : (item.desc || kindLabel(item.kind_key));
    return `${item.label}：${name}`;
  });
  const light = getLightSentence();
  const sentence = `将${tag}转换为${spaceObj.label}。不要照拷原图的门窗、构图和主要家具位置，在新空间中沿用原图各表面的材质与色彩：${lines.join('；')}。${light ? `\n${light}` : ''}`;
  emit('update:recipePrompt', sentence);

  // 把确认选中的材质图挂进看图区托盘
  const chosenRefs = spaceSurfaces.value
    .filter(it => it.selected && it.selected.preview_rel)
    .map(it => ({
      name: `${it.label}_${it.selected.name_zh}`,
      url: it.selected.preview_rel
    }));
  if (chosenRefs.length > 0) {
    emit('mount-refs', chosenRefs);
  }
}

function selectUpscale(scale) {
  activeUpscale.value = scale;
  const tag = props.targetTag || '@图1';
  const light = getLightSentence();
  const sentence = `将${tag}的清晰度提升到${scale}。只增强清晰度，不改变构图、物体、材质和颜色。${light ? `\n${light}` : ''}`;
  emit('update:recipePrompt', sentence);
}

function selectWatermark() {
  const tag = props.targetTag || '@图1';
  const light = getLightSentence();
  const sentence = `去除${tag}中的水印和标识。其余画面保持不变。${light ? `\n${light}` : ''}`;
  emit('update:recipePrompt', sentence);
}

function clearRecipe() {
  emit('update:recipePrompt', '');
  activeStyleId.value = '';
  activeStyleName.value = '';
  activeSchemeId.value = '';
  activeUpscale.value = '';
}

onMounted(() => {
  loadStyles();
});
</script>
