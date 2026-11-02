<template>
  <div class="view-root studio-view flex-1 min-h-0 flex flex-col overflow-hidden bg-studio-950 font-sans">
    <ChatStudio
      :initialPayload="chatTargetPayload"
      @sendToClip="$emit('sendToClip', $event)"
      @payload-consumed="$emit('payloadConsumed')"
    />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import ChatStudio from './studio/ChatStudio.vue';
import { getAssetImageUrl } from '../api';

const props = defineProps({
  initialPayload: { type: Object, default: null }
});

const emit = defineEmits(['sendToClip', 'payloadConsumed']);

const chatTargetPayload = ref(null);

watch(() => props.initialPayload, (payload) => {
  if (!payload) return;
  if (payload.target === 'quick') {
    // target === 'quick' 只开右抽屉，不新建会话；URL 在这里规范一次
    const rawUrl = payload.item?.url || payload.item?.imgUrl || (payload.item?.fid ? getAssetImageUrl(payload.item.fid, payload.item.mediaToken) : '');
    const itemObj = typeof payload.item === 'object' ? { ...payload.item } : { url: String(payload.item || '') };
    if (rawUrl) itemObj.url = rawUrl;
    itemObj._openDrawer = true;
    chatTargetPayload.value = { target: 'quick', items: [itemObj] };
    return;
  }
  // chat / 其它形态原样透传，由 ChatStudio 统一解包，避免单件 payload 丢 target
  chatTargetPayload.value = payload;
}, { immediate: true });
</script>
