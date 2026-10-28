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
        <span class="px-2 py-0.5 rounded bg-studio-cyan/15 text-studio-cyan font-mono font-bold text-xs shrink-0">
          {{ targetTag || '@图1' }}
        </span>
        <span v-if="targetImageName" class="text-slate-400 truncate text-[11px]" :title="targetImageName">
          {{ targetImageName }}
        </span>
      </div>
      <div v-if="targetImageThumb" class="w-7 h-7 rounded border border-studio-700 overflow-hidden shrink-0">
        <img :src="targetImageThumb" class="w-full h-full object-cover" alt="" />
      </div>
    </div>

    <!-- 顶部 3 个功能 Tab 切换 -->
    <div class="p-3 border-b border-studio-800 shrink-0">
      <div class="grid grid-cols-3 gap-1 bg-studio-950 p-1 rounded-xl border border-studio-800 text-xs font-bold">
        <button
          type="button"
          @click="selectTab('style')"
          :class="[
            'py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer',
            currentTab === 'style'
              ? 'bg-studio-850 text-white shadow-sm border border-studio-700'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          <StudioIcon name="palette" :size="14" />
          <span>风格</span>
        </button>

        <button
          type="button"
          @click="selectTab('upscale')"
          :class="[
            'py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer',
            currentTab === 'upscale'
              ? 'bg-studio-850 text-white shadow-sm border border-studio-700'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          <StudioIcon name="maximize" :size="14" />
          <span>超分</span>
        </button>

        <button
          type="button"
          @click="selectTab('watermark')"
          :class="[
            'py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer',
            currentTab === 'watermark'
              ? 'bg-studio-850 text-white shadow-sm border border-studio-700'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          <StudioIcon name="trash" :size="14" />
          <span>去水印</span>
        </button>
      </div>
    </div>

    <!-- 中部滚动区 -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
      <!-- ================= Tab 1: 风格转换 ================= -->
      <div v-if="currentTab === 'style'" class="space-y-3">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-300">官方标准空间风格 (6 款)</span>
          <span class="text-[10px] text-slate-500 font-mono">点击即写配方</span>
        </div>

        <!-- 6 个官方风格卡片 -->
        <div class="grid grid-cols-1 gap-2.5">
          <div
            v-for="st in OFFICIAL_STYLES"
            :key="st.name"
            @click="selectStyle(st)"
            :class="[
              'rounded-xl border p-3 cursor-pointer transition-all space-y-2 select-none relative overflow-hidden',
              activeStyleName === st.name
                ? 'border-studio-accent bg-studio-accent/10 shadow-md ring-1 ring-studio-accent/30'
                : 'border-studio-800 bg-studio-950/70 hover:border-studio-700 hover:bg-studio-950'
            ]"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full" :class="st.dotClass"></span>
                <span class="font-bold text-xs text-white">{{ st.name }}</span>
              </div>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-studio-900 border border-studio-800 text-slate-400 font-mono">
                {{ st.tag }}
              </span>
            </div>

            <p class="text-[11px] text-slate-400 leading-snug line-clamp-1">
              {{ st.summary }}
            </p>

            <!-- 选中展开：2 行可微调的锚定描述 -->
            <div
              v-if="activeStyleName === st.name"
              class="pt-2 border-t border-studio-800/80 space-y-1.5 animate-in fade-in duration-200"
              @click.stop
            >
              <div class="flex items-center justify-between text-[10px] text-slate-400">
                <span class="font-bold text-studio-cyan">风格锚定描述（可微调）:</span>
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
                @input="onStyleDescInput(st.name)"
                class="w-full bg-studio-900 border border-studio-700 rounded-lg p-2 text-xs text-slate-100 font-sans outline-none focus:border-studio-accent leading-relaxed resize-none scrollbar-thin"
              ></textarea>
            </div>
          </div>
        </div>

        <!-- 自定义风格折叠卡 -->
        <div class="pt-2 border-t border-studio-800 space-y-2">
          <div
            @click="showCustomStyleForm = !showCustomStyleForm"
            class="flex items-center justify-between p-3 rounded-xl border border-dashed border-studio-700 bg-studio-950/40 hover:bg-studio-950 cursor-pointer transition-colors"
          >
            <div class="flex items-center gap-2 text-xs font-bold text-studio-cyan">
              <StudioIcon name="plus" :size="13" />
              <span>添加自定义空间风格</span>
            </div>
            <StudioIcon :name="showCustomStyleForm ? 'chevronDown' : 'chevronRight'" :size="14" class="text-slate-400" />
          </div>

          <!-- 自定义风格表单 -->
          <div
            v-if="showCustomStyleForm"
            class="p-3 rounded-xl border border-studio-700 bg-studio-950 space-y-2.5 animate-in fade-in duration-150"
          >
            <div class="space-y-1">
              <label class="text-[11px] font-bold text-slate-300">风格名称</label>
              <input
                v-model="newStyleName"
                type="text"
                placeholder="例如: 赛博朋克原木、新岭南新中式"
                class="w-full bg-studio-900 border border-studio-750 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-studio-accent"
              />
            </div>

            <div class="space-y-1">
              <label class="text-[11px] font-bold text-slate-300">风格锚定描述</label>
              <textarea
                v-model="newStyleDesc"
                rows="2"
                placeholder="详细特征描述，如色彩、主材质、光影形态等"
                class="w-full bg-studio-900 border border-studio-750 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-studio-accent resize-none scrollbar-thin leading-relaxed"
              ></textarea>
            </div>

            <div class="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                @click="applyCustomStyleOnly"
                :disabled="!newStyleName.trim()"
                class="px-3 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-750 text-slate-200 text-xs font-bold cursor-pointer disabled:opacity-40 transition-colors"
              >
                仅写入配方
              </button>
              <button
                type="button"
                @click="saveAndApplyCustomStyle"
                :disabled="!newStyleName.trim()"
                class="px-3 py-1.5 rounded-lg bg-studio-accent hover:brightness-110 text-white text-xs font-bold cursor-pointer disabled:opacity-40 transition-all shadow-sm"
              >
                保存并写入
              </button>
            </div>
          </div>

          <!-- 已保存的个人自定义风格列表 -->
          <div v-if="savedCustomStyles.length" class="space-y-1.5 pt-1">
            <span class="text-[11px] font-bold text-slate-400">已保存的个人风格 ({{ savedCustomStyles.length }})</span>
            <div
              v-for="(cs, idx) in savedCustomStyles"
              :key="idx"
              @click="selectCustomStyle(cs)"
              :class="[
                'p-2.5 rounded-lg border flex items-center justify-between cursor-pointer transition-colors',
                activeStyleName === cs.name
                  ? 'border-studio-accent bg-studio-accent/15 text-white'
                  : 'border-studio-800 bg-studio-950/60 text-slate-300 hover:border-studio-700'
              ]"
            >
              <div class="min-w-0 pr-2">
                <div class="text-xs font-bold truncate">{{ cs.name }}</div>
                <div class="text-[10px] text-slate-400 truncate">{{ cs.desc }}</div>
              </div>
              <button
                type="button"
                @click.stop="deleteSavedStyle(idx)"
                class="p-1 text-slate-500 hover:text-rose-400 cursor-pointer shrink-0"
                title="删除此风格"
              >
                <StudioIcon name="trash" :size="12" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ================= Tab 2: 超分辨率提升 ================= -->
      <div v-else-if="currentTab === 'upscale'" class="space-y-4">
        <div class="space-y-1">
          <div class="font-bold text-xs text-slate-200">超分辨率清晰度提升</div>
          <p class="text-[11px] text-slate-400 leading-relaxed">
            提升目标参考图的视觉精度与纹理细节，锁定构图与家具陈设不变。
          </p>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="scale in ['2K', '4K', '8K']"
            :key="scale"
            type="button"
            @click="selectUpscale(scale)"
            :class="[
              'p-3.5 rounded-xl border flex flex-col items-center justify-center gap-1 cursor-pointer transition-all',
              activeUpscale === scale
                ? 'border-studio-accent bg-studio-accent/15 text-white shadow-md ring-1 ring-studio-accent/30'
                : 'border-studio-800 bg-studio-950/70 text-slate-300 hover:border-studio-700 hover:bg-studio-950'
            ]"
          >
            <span class="font-mono text-base font-extrabold">{{ scale }}</span>
            <span class="text-[10px] text-slate-400">
              {{ scale === '2K' ? '日常高清' : (scale === '4K' ? '精修汇报' : '印刷画册') }}
            </span>
          </button>
        </div>

        <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1.5 text-xs">
          <span class="font-bold text-studio-cyan flex items-center gap-1.5">
            <StudioIcon name="sliders" :size="13" />
            超分配方公式
          </span>
          <p class="font-mono text-[11px] text-slate-300 leading-relaxed">
            将{{ targetTag || '@图1' }}的清晰度提升到{{ activeUpscale || '4K' }}。只增强清晰度，不改变构图、物体、材质和颜色。
          </p>
        </div>
      </div>

      <!-- ================= Tab 3: 一键去水印 ================= -->
      <div v-else-if="currentTab === 'watermark'" class="space-y-4">
        <div class="space-y-1">
          <div class="font-bold text-xs text-slate-200">一键去除水印与标识</div>
          <p class="text-[11px] text-slate-400 leading-relaxed">
            自动消除画面中的台标、Logo、拍摄日期等水印覆层，精准修复底图背景。
          </p>
        </div>

        <button
          type="button"
          @click="selectWatermark"
          class="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-studio-accent to-studio-indigo hover:brightness-110 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-studio-accent/20 cursor-pointer transition-all"
        >
          <StudioIcon name="sparkles" :size="15" />
          <span>生成一键去水印配方</span>
        </button>

        <div class="p-3 rounded-xl bg-studio-950 border border-studio-800 space-y-1.5 text-xs">
          <span class="font-bold text-studio-cyan flex items-center gap-1.5">
            <StudioIcon name="check" :size="13" />
            去水印配方公式
          </span>
          <p class="font-mono text-[11px] text-slate-300 leading-relaxed">
            去除{{ targetTag || '@图1' }}中的水印和标识。其余画面保持不变。
          </p>
        </div>
      </div>

      <!-- ================= 整图光线控制 (全 Tab 通用附加子句) ================= -->
      <div class="pt-3 border-t border-studio-800/80 space-y-3">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-300">整图光线控制</span>
          <label class="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
            <input type="checkbox" v-model="globalLightKeep" @change="onLightChange" class="rounded border-studio-700 bg-studio-900 text-studio-accent" />
            <span>保持原图光线</span>
          </label>
        </div>

        <div v-if="!globalLightKeep" class="space-y-3 p-3 rounded-xl bg-studio-950/70 border border-studio-800 text-xs">
          <div>
            <span class="text-[11px] text-slate-400 block mb-1.5">主光来向（屏幕方向）：</span>
            <div class="grid grid-cols-5 gap-1 text-[10px]">
              <button
                v-for="d in lightDirections"
                :key="d.key"
                type="button"
                @click="selectLightDir(d.key)"
                :class="[
                  'py-1.5 rounded-lg border text-center transition cursor-pointer',
                  globalLightDir === d.key
                    ? 'bg-studio-accent border-studio-accent text-white font-bold'
                    : 'border-studio-800 bg-studio-900 text-slate-400 hover:text-slate-200'
                ]"
              >
                {{ d.label }}
              </button>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>色温微调：</span>
              <span class="font-mono text-studio-cyan font-bold">{{ globalKelvin }}K</span>
            </div>
            <input
              type="range"
              min="2700"
              max="6500"
              step="100"
              v-model.number="globalKelvin"
              @input="onLightChange"
              class="w-full accent-studio-accent cursor-pointer"
            />
            <div class="flex justify-between text-[9px] text-slate-500 font-mono mt-1">
              <span @click="selectKelvin(2700)" class="cursor-pointer hover:text-slate-300">2700K 暖黄</span>
              <span @click="selectKelvin(3000)" class="cursor-pointer hover:text-slate-300">3000K 暖白</span>
              <span @click="selectKelvin(4000)" class="cursor-pointer hover:text-slate-300">4000K 自然</span>
              <span @click="selectKelvin(5000)" class="cursor-pointer hover:text-slate-300">5000K 冷白</span>
              <span @click="selectKelvin(6500)" class="cursor-pointer hover:text-slate-300">6500K 日光</span>
            </div>
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
import { ref, computed, watch, onMounted } from 'vue';
import StudioIcon from '@/components/StudioIcon.vue';

const props = defineProps({
  recipePrompt: { type: String, default: '' },
  targetTag: { type: String, default: '@图1' },
  targetImageThumb: { type: String, default: '' },
  targetImageName: { type: String, default: '' },
  initialTab: { type: String, default: 'style' }
});

const emit = defineEmits(['update:recipePrompt', 'close']);

const currentTab = ref(props.initialTab || 'style');
const activeStyleName = ref('');
const customizedStyleDesc = ref('');
const activeUpscale = ref('');

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

function selectKelvin(k) {
  globalKelvin.value = k;
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
  return `主光来自${dirLabel}，阴影落向相反的一侧。这是这张照片的屏幕方向，不是罗盘方位。色温约 ${globalKelvin.value}K。`;
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

// 6 款官方风格定义
const OFFICIAL_STYLES = [
  {
    name: '日式侘寂',
    tag: '质朴 · 留白',
    summary: '质朴素雅、留白禅意、自然原生质感',
    desc: '采用粗粝微水泥、自然未打磨木材与素色棉麻软装，低饱和大地色系，强调光影留白与自然残缺之美。',
    dotClass: 'bg-stone-400'
  },
  {
    name: '极简原木',
    tag: '温润 · 通透',
    summary: '温暖温润、天然木纹、清爽明亮',
    desc: '大面积使用白橡木或原木材质，搭配暖白色乳胶漆与米白布艺，线条简约干净，采光充沛通透。',
    dotClass: 'bg-amber-400'
  },
  {
    name: '微水泥极简',
    tag: '一体 · 雕塑',
    summary: '无缝一体、克制高级、纯粹几何',
    desc: '墙面与地面采用浅灰微水泥无缝包裹，极窄踢脚线与内嵌隐形灯带，家具造型极具雕塑感与建筑感。',
    dotClass: 'bg-slate-400'
  },
  {
    name: '包豪斯工业',
    tag: '结构 · 机能',
    summary: '结构理性、金属线条、硬朗机能',
    desc: '裸露清水混凝土与深色钢结构，搭配经典镀铬钢管皮椅与几何明快色块，强调形式追随功能。',
    dotClass: 'bg-neutral-400'
  },
  {
    name: '现代轻奢',
    tag: '奢华 · 大理石',
    summary: '精致奢华、大理石金属、品质细节',
    desc: '选用高光鱼肚白大理石、拉丝香槟金金属饰条与丝绒面料，隐藏式高级泛光照明，营造优雅高级格调。',
    dotClass: 'bg-amber-300'
  },
  {
    name: '北欧斯堪的纳维亚',
    tag: '亲和 · 宜居',
    summary: '舒适惬意、明亮色彩、自然亲和',
    desc: '明快浅木搭配粉灰、鼠尾草绿等柔和点缀，几何图案地毯与蓬松羊毛织物，注重温馨宜居的生活氛围。',
    dotClass: 'bg-emerald-400'
  }
];

// 自定义风格相关
const showCustomStyleForm = ref(false);
const newStyleName = ref('');
const newStyleDesc = ref('');
const savedCustomStyles = ref([]);

function loadSavedCustomStyles() {
  try {
    const raw = localStorage.getItem('studio_custom_styles');
    if (raw) savedCustomStyles.value = JSON.parse(raw);
  } catch (e) {
    savedCustomStyles.value = [];
  }
}

function persistCustomStyles() {
  try {
    localStorage.setItem('studio_custom_styles', JSON.stringify(savedCustomStyles.value));
  } catch (e) {
    console.warn('保存个人风格失败:', e);
  }
}

function saveAndApplyCustomStyle() {
  const name = newStyleName.value.trim();
  const desc = newStyleDesc.value.trim() || '保持原有空间结构、构图和主要家具位置。';
  if (!name) return;

  const existingIdx = savedCustomStyles.value.findIndex(s => s.name === name);
  if (existingIdx >= 0) {
    savedCustomStyles.value[existingIdx].desc = desc;
  } else {
    savedCustomStyles.value.push({ name, desc });
  }
  persistCustomStyles();

  activeStyleName.value = name;
  customizedStyleDesc.value = desc;
  writeStyleRecipe(name, desc);
  showCustomStyleForm.value = false;
  newStyleName.value = '';
  newStyleDesc.value = '';
}

function applyCustomStyleOnly() {
  const name = newStyleName.value.trim();
  const desc = newStyleDesc.value.trim() || '保持原有空间结构、构图和主要家具位置。';
  if (!name) return;
  activeStyleName.value = name;
  customizedStyleDesc.value = desc;
  writeStyleRecipe(name, desc);
  showCustomStyleForm.value = false;
}

function selectCustomStyle(cs) {
  activeStyleName.value = cs.name;
  customizedStyleDesc.value = cs.desc;
  writeStyleRecipe(cs.name, cs.desc);
}

function deleteSavedStyle(idx) {
  savedCustomStyles.value.splice(idx, 1);
  persistCustomStyles();
}

function selectTab(tab) {
  currentTab.value = tab;
  if (tab === 'upscale' && activeUpscale.value) {
    selectUpscale(activeUpscale.value);
  } else if (tab === 'watermark') {
    selectWatermark();
  } else if (tab === 'style' && activeStyleName.value) {
    writeStyleRecipe(activeStyleName.value, customizedStyleDesc.value);
  }
}

function selectStyle(st) {
  activeStyleName.value = st.name;
  customizedStyleDesc.value = st.desc;
  writeStyleRecipe(st.name, st.desc);
}

function resetStyleDesc(st) {
  customizedStyleDesc.value = st.desc;
  writeStyleRecipe(st.name, st.desc);
}

function onStyleDescInput(styleName) {
  writeStyleRecipe(styleName, customizedStyleDesc.value);
}

function writeStyleRecipe(styleName, desc) {
  const tag = props.targetTag || '@图1';
  const cleanDesc = (desc || '').trim();
  const light = getLightSentence();
  const sentence = `将${tag}改为${styleName}。${cleanDesc}保持原有空间结构、构图和主要家具位置。${light ? `\n${light}` : ''}`;
  emit('update:recipePrompt', sentence);
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
  activeStyleName.value = '';
  activeUpscale.value = '';
}

// 当目标图标号改变时，如已选定了操作，自动更新配方里的 @图N
watch(() => props.targetTag, (newTag) => {
  if (currentTab.value === 'style' && activeStyleName.value) {
    writeStyleRecipe(activeStyleName.value, customizedStyleDesc.value);
  } else if (currentTab.value === 'upscale' && activeUpscale.value) {
    selectUpscale(activeUpscale.value);
  } else if (currentTab.value === 'watermark') {
    selectWatermark();
  }
});

onMounted(() => {
  loadSavedCustomStyles();
});
</script>
