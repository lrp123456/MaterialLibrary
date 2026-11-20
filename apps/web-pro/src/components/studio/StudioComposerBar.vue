<template>
  <div class="composer-bar-container border-t border-studio-800 bg-studio-900/90 backdrop-blur-md p-3.5 space-y-3">
    <!-- 顶部动态模型参数条 -->
    <DynamicModelParamBar
      v-model:modelKey="modelKey"
      v-model:aspectRatio="aspectRatio"
      v-model:resolution="resolution"
    />

    <!-- ZCode 风格 Skills 挂载条 -->
    <div v-if="skills && skills.length" class="skills-registry flex items-center gap-1.5 overflow-x-auto py-1">
      <span class="text-[10px] font-mono text-slate-400 uppercase tracking-wider shrink-0">技能:</span>
      <button
        v-for="skill in skills"
        :key="skill.id"
        type="button"
        class="px-2 py-0.5 rounded-full text-[11px] font-mono border transition-all cursor-pointer whitespace-nowrap"
        :class="activeSkillIds.includes(skill.id)
          ? 'bg-studio-accent text-white border-studio-accent shadow-sm'
          : 'bg-studio-800 text-slate-300 border-studio-700 hover:border-slate-500'"
        @click="$emit('toggle-skill', skill.id)"
      >
        {{ skill.label }}
      </button>
    </div>

    <!-- 引用素材托盘 -->
    <ReferenceTray
      v-if="referenceChips && referenceChips.length"
      :items="referenceChips"
      @remove="$emit('remove-chip', $event)"
    />

    <!-- 错误拦截提示（死芯片/无效参数阻断） -->
    <div v-if="composerError" class="p-2 rounded-lg bg-red-950/40 border border-red-500/40 text-xs text-red-300 flex items-center gap-2">
      <span class="font-bold">⚠️</span>
      <span>{{ composerError }}</span>
    </div>

    <!-- 输入与发送区域 -->
    <div class="relative flex items-end gap-2 bg-studio-950 border border-studio-700/80 rounded-2xl p-2.5 focus-within:border-studio-accent transition-colors"
         :class="{ 'border-red-500/80 ring-1 ring-red-500/50': hasInvalidChip }">
      <textarea
        v-model="promptText"
        rows="2"
        placeholder="描述画面细节、镜头运动与风格光影，输入 @ 可以选择素材，支持 @视频 与 @音频 混排引用…"
        class="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none resize-none max-h-36 scrollbar-thin"
        @keydown.enter.exact.prevent="handleSend"
      />

      <div class="flex items-center gap-2 shrink-0">
        <!-- 进度提示（仅看当前会话） -->
        <span v-if="currentGenerating && !hasGeneratingPlaceholder" class="text-xs text-studio-cyan font-mono animate-pulse">
          生成中…
        </span>

        <!-- 发送/生成按钮 -->
        <button
          type="button"
          :disabled="currentGenerating || uploadingCrop"
          class="px-4 py-2 rounded-xl bg-studio-accent text-white font-bold text-xs hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
          :class="{ 'opacity-50 cursor-not-allowed': hasInvalidChip }"
          @click="handleSend"
        >
          <StudioIcon name="send" :size="14" />
          <span>{{ currentGenerating ? '排队中…' : '立即生成' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import DynamicModelParamBar from '../DynamicModelParamBar.vue';
import ReferenceTray from './ReferenceTray.vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  currentGenerating: { type: Boolean, default: false },
  uploadingCrop: { type: Boolean, default: false },
  hasGeneratingPlaceholder: { type: Boolean, default: false },
  hasInvalidChip: { type: Boolean, default: false },
  composerError: { type: String, default: '' },
  referenceChips: { type: Array, default: () => [] },
  skills: { type: Array, default: () => [] },
  activeSkillIds: { type: Array, default: () => [] },
});

const emit = defineEmits([
  'update:modelValue',
  'send',
  'remove-chip',
  'toggle-skill',
]);

const promptText = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const modelKey = defineModel('modelKey', { default: 'wan-2.1-t2v-plus' });
const aspectRatio = defineModel('aspectRatio', { default: '16:9' });
const resolution = defineModel('resolution', { default: '720p' });

function handleSend() {
  emit('send');
}
</script>
