<template>
  <div class="message-list-viewport flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
    <template v-if="messages && messages.length">
      <ChatMessageCard
        v-for="msg in messages"
        :key="msg.id"
        :msg="msg"
        @cancel="$emit('cancel', $event)"
        @preview="$emit('preview', $event)"
        @preview-layer="$emit('preview-layer', $event)"
        @retry="$emit('retry', $event)"
      />
    </template>

    <div v-else class="h-full flex flex-col items-center justify-center text-slate-500 space-y-2">
      <StudioIcon name="sparkles" :size="32" class="text-studio-700" />
      <p class="text-xs font-mono">开启你的 AI 空间创作与影视多轨生成会话</p>
    </div>
  </div>
</template>

<script setup>
import ChatMessageCard from './ChatMessageCard.vue';

defineProps({
  messages: {
    type: Array,
    default: () => [],
  },
});

defineEmits(['cancel', 'preview', 'preview-layer', 'retry']);
</script>
