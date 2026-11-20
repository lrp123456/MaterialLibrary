<template>
  <div class="quick-studio-root h-full flex flex-col bg-studio-950 p-6 overflow-y-auto scrollbar-thin font-sans">
    <div class="max-w-5xl mx-auto w-full space-y-6">
      <div class="flex items-center justify-between pb-4 border-b border-studio-800">
        <div>
          <h3 class="text-base font-bold text-white font-mono flex items-center gap-2">
            <StudioIcon name="zap" :size="18" class="text-studio-accent" />
            <span>AI 精准创作模式 (6大智能管线)</span>
          </h3>
          <p class="text-xs text-slate-400 mt-1">选择特定功能模式，一键注入参数与模板至创作草稿</p>
        </div>
      </div>

      <!-- 6 大精准模式卡片网格 -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <QuickModeCard
          v-for="mode in modes"
          :key="mode.id"
          :mode="mode"
          @select="handleSelectMode"
        />
      </div>

      <!-- 选定模式详细注入预览 -->
      <div v-if="selectedMode" class="p-5 rounded-2xl bg-studio-900 border border-studio-700 space-y-4">
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-bold text-white font-mono flex items-center gap-2">
            <span>已选模式: {{ selectedMode.title }}</span>
          </h4>
          <button type="button" class="text-xs text-slate-400 hover:text-white" @click="selectedMode = null">
            取消选择
          </button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="text-xs text-slate-400 block mb-1 font-mono">预设引导词</label>
            <textarea
              v-model="promptBuffer"
              rows="2"
              class="w-full bg-studio-950 border border-studio-700 rounded-xl p-2.5 text-xs text-white outline-none focus:border-studio-accent font-mono"
            />
          </div>

          <div class="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              class="px-5 py-2 rounded-xl bg-studio-accent text-white text-xs font-bold hover:brightness-110 active:scale-95 transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
              @click="injectToComposer"
            >
              <StudioIcon name="send" :size="14" />
              <span>注入创作草稿 (WYSIWYG)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import QuickModeCard from '../../components/studio/quick/QuickModeCard.vue';

const emit = defineEmits(['inject-to-composer', 'close']);

const modes = [
  {
    id: 'restyle',
    title: '风格重绘 (Restyle)',
    description: '保持原图结构与深度轮廓，重构材质质感与艺术风格',
    icon: 'palette',
    presetModel: 'wan-2.1-t2v-plus',
    defaultPrompt: '极简北欧侘寂风，天然微水泥墙面，原木肌理，柔和漫射日光',
  },
  {
    id: 'outpaint',
    title: '空间扩图 (Outpaint)',
    description: '保持中心主体不变，外向无缝扩展画幅与视线边缘',
    icon: 'maximize',
    presetModel: 'qwen-omni-v1',
    defaultPrompt: '无缝向外延展空间，广角大景深视野，延伸周围家具与光照',
  },
  {
    id: 'inpaint',
    title: '局部重绘 (Inpaint)',
    description: '圈选目标家具或表面，替换指定物件或修复瑕疵',
    icon: 'brush',
    presetModel: 'qwen-omni-v1',
    defaultPrompt: '将选区替换为现代极简布艺双人沙发，米白色质感面料',
  },
  {
    id: 'upscale',
    title: '超分高清 (Upscale)',
    description: 'AI 像素级超分辨率重建，消除噪点，补充超精细纹理',
    icon: 'sparkles',
    presetModel: 'wan-2.1-i2v-plus',
    defaultPrompt: '超清细节重建，8K 渲染精度，清晰边缘锐化',
  },
  {
    id: 'colorization',
    title: '线稿上色 (Colorize)',
    description: '空间方案手绘白模或 CAD 线框，智能匹配真实色彩光泽',
    icon: 'sliders',
    presetModel: 'wan-2.1-t2v-plus',
    defaultPrompt: '室内软装色彩搭配，温暖米黄主色调，胡桃木深色对比',
  },
  {
    id: 'recolor',
    title: '空间换色 (Recolor)',
    description: '保持空间光照与阴影，将选定材质/墙色平滑置换',
    icon: 'image',
    presetModel: 'qwen-omni-v1',
    defaultPrompt: '将背景墙置换为莫兰迪灰绿色，保留自然凹凸阴影',
  },
];

const selectedMode = ref(null);
const promptBuffer = ref('');

function handleSelectMode(mode) {
  selectedMode.value = mode;
  promptBuffer.value = mode.defaultPrompt;
}

function injectToComposer() {
  if (!selectedMode.value) return;
  // 严格 WYSIWYG：不绕过直接发送，注入到草稿中由用户确认
  emit('inject-to-composer', {
    prompt: promptBuffer.value,
    modelKey: selectedMode.value.presetModel,
  });
  selectedMode.value = null;
}
</script>
