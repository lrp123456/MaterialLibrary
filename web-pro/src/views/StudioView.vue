<template>
  <div class="flex-1 flex flex-col h-[calc(100vh-56px)] overflow-hidden bg-studio-950 font-sans">
    <!-- AI 创作二级分段导航栏 (高度 48px) -->
    <div class="h-12 bg-studio-900 border-b border-studio-700 px-5 flex items-center justify-between shrink-0 select-none">
      <div class="flex items-center space-x-2">
        <button
          @click="activeSub = 'chat'"
          :class="[
            'px-5 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 cursor-pointer',
            'choice',
            activeSub === 'chat' ? 'is-on font-bold' : 'hover:bg-studio-800'
          ]"
        >
          <span class="choice-mark" aria-hidden="true"></span>
          <StudioIcon name="chat" :size="16" />
          <span>AI 对话式生成</span>
          <span v-if="activeSub === 'chat'" class="choice-now">当前</span>
          <span class="text-xs font-mono opacity-80">豆包/千问创作流</span>
        </button>

        <button
          @click="activeSub = 'quick'"
          :class="[
            'px-5 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 cursor-pointer',
            'choice',
            activeSub === 'quick' ? 'is-on font-bold' : 'hover:bg-studio-800'
          ]"
        >
          <span class="choice-mark" aria-hidden="true"></span>
          <StudioIcon name="wand" :size="16" />
          <span>AI 快捷精准编辑</span>
          <span v-if="activeSub === 'quick'" class="choice-now">当前</span>
          <span class="text-xs font-mono opacity-80">6大专业模式</span>
        </button>
      </div>

      <!-- 右侧指示 -->
      <div class="flex items-center space-x-2 text-xs font-mono text-slate-300">
        <span class="text-slate-400">创作引擎:</span>
        <span class="text-white font-extrabold uppercase px-2 py-0.5 rounded bg-studio-850 border border-studio-700">
          {{ activeSub === 'chat' ? 'CHAT STUDIO' : 'PRECISION INPAINT STUDIO' }}
        </span>
      </div>
    </div>

    <!-- 子工作台内容展示 -->
    <ChatStudio
      v-if="activeSub === 'chat'"
      :initialPayload="chatTargetPayload"
      @sendToPrecisionEdit="handleSendToPrecisionEdit"
      @sendToClip="$emit('sendToClip', $event)"
    />
    <QuickStudio
      v-else-if="activeSub === 'quick'"
      :initialImage="editTargetImage"
    />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import StudioIcon from '../components/StudioIcon.vue';
import ChatStudio from './studio/ChatStudio.vue';
import QuickStudio from './studio/QuickStudio.vue';
import { getAssetImageUrl } from '../api';

const props = defineProps({
  initialPayload: { type: Object, default: null }
});

const emit = defineEmits(['sendToClip']);

const activeSub = ref('chat'); // 'chat' | 'quick'
const editTargetImage = ref('');
const chatTargetPayload = ref(null);

watch(() => props.initialPayload, (payload) => {
  if (payload) {
    if (payload.target === 'quick') {
      activeSub.value = 'quick';
      const rawUrl = payload.item?.url || payload.item?.imgUrl || (payload.item?.fid ? getAssetImageUrl(payload.item.fid, payload.item.mediaToken) : '');
      if (rawUrl) editTargetImage.value = rawUrl;
      else if (typeof payload.item === 'string') editTargetImage.value = payload.item;
    } else if (payload.target === 'chat') {
      activeSub.value = 'chat';
      chatTargetPayload.value = payload.item;
    }
  }
}, { immediate: true });

function handleSendToPrecisionEdit(imageUrl) {
  editTargetImage.value = imageUrl;
  activeSub.value = 'quick';
}
</script>
