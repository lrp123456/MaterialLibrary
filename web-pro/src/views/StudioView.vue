<template>
  <div class="view-root studio-view flex-1 min-h-0 flex flex-col overflow-hidden bg-studio-950 font-sans">
    <ChatStudio
      :initialPayload="chatTargetPayload"
      @sendToClip="$emit('sendToClip', $event)"
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

const emit = defineEmits(['sendToClip']);

const chatTargetPayload = ref(null);

watch(() => props.initialPayload, (payload) => {
  if (payload) {
    if (payload.target === 'quick') {
      // 规范：target === 'quick' 时不切走，改为挂上该图并通知 ChatStudio 打开右抽屉
      const rawUrl = payload.item?.url || payload.item?.imgUrl || (payload.item?.fid ? getAssetImageUrl(payload.item.fid, payload.item.mediaToken) : '');
      const itemObj = typeof payload.item === 'object' ? { ...payload.item } : { url: String(payload.item || '') };
      if (rawUrl) itemObj.url = rawUrl;
      itemObj._openDrawer = true;
      chatTargetPayload.value = itemObj;
    } else if (payload.target === 'chat') {
      const items = Array.isArray(payload.items) ? payload.items : (payload.item ? [payload.item] : []);
      chatTargetPayload.value = items.length === 1 ? items[0] : (items.length ? items : null);
    } else {
      chatTargetPayload.value = payload;
    }
  }
}, { immediate: true });
</script>
