<template>
  <div class="result-actions">
    <div class="result-actions-row">
      <button type="button" class="result-action is-create" :disabled="created || creating" @click="$emit('create')">
        <StudioIcon name="star" :size="14" />
        <span>{{ created ? '已入创作库' : (creating ? '写入中…' : '入创作库') }}</span>
      </button>
      <button type="button" class="result-action is-library" :disabled="saved || saving || saveDisabled" @click="$emit('library')">
        <StudioIcon name="archive" :size="14" />
        <span>{{ saved ? '已入素材库' : (saving ? '写入中…' : '入素材库') }}</span>
      </button>
      <button type="button" class="result-action" :disabled="retrying" @click="$emit('retry')">
        <StudioIcon name="rotateRight" :size="14" />
        <span>重新生成</span>
      </button>
      <button type="button" class="result-action" @click="$emit('reedit')">
        <StudioIcon name="edit" :size="14" />
        <span>重新编辑</span>
      </button>
    </div>
    <p v-if="reason" class="result-action-reason">{{ reason }}</p>
  </div>
</template>

<script setup>
import StudioIcon from './StudioIcon.vue';

defineProps({
  created: { type: Boolean, default: false },
  creating: { type: Boolean, default: false },
  saved: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  saveDisabled: { type: Boolean, default: false },
  retrying: { type: Boolean, default: false },
  reason: { type: String, default: '' },
});

defineEmits(['create', 'library', 'retry', 'reedit']);
</script>

<style scoped>
.result-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.result-actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.result-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.72);
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.result-action:hover:not(:disabled) {
  border-color: rgba(125, 211, 252, 0.7);
  color: white;
}
.result-action:disabled {
  opacity: 0.55;
  cursor: default;
}
.result-action.is-create:not(:disabled) {
  color: #fcd34d;
}
.result-action.is-library:not(:disabled) {
  color: #6ee7b7;
}
.result-action-reason {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #fcd34d;
}
</style>
