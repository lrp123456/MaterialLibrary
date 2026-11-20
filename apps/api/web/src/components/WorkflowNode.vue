<template>
  <div
    class="w-[220px] rounded-2xl border bg-surface p-3 shadow-md select-none"
    :class="frameClass"
  >
    <Handle type="target" :position="Position.Left" class="wf-handle" />
    <Handle type="source" :position="Position.Right" class="wf-handle" />

    <div class="flex items-center justify-between gap-1">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="w-2 h-2 rounded-full shrink-0" :class="dotClass"></span>
        <span class="text-[11px] font-bold text-white truncate">{{ data.name }}</span>
      </div>
      <span v-if="data.statusLabel" class="text-[9px] px-1.5 py-0.5 rounded-md shrink-0" :class="badgeClass">{{ data.statusLabel }}</span>
    </div>
    <p class="text-[10px] text-on-surface-variant mt-1.5 font-mono truncate">{{ data.nodeType }}</p>
    <p v-if="data.model" class="text-[10px] text-on-surface-variant truncate">{{ data.model }}</p>
    <p v-if="data.ratioLine" class="text-[10px] text-primary mt-1">{{ data.ratioLine }}</p>
    <div class="mt-2 pt-2 border-t border-outline-variant/60 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px] text-on-surface-variant">
      <span>入队 {{ data.stats?.total || 0 }}</span>
      <span class="text-primary">成功 {{ data.stats?.done || 0 }}</span>
      <span>跳过 {{ data.stats?.skipped || 0 }}</span>
      <span :class="(data.stats?.failed || 0) ? 'text-error' : ''">失败 {{ data.stats?.failed || 0 }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps({
  data: { type: Object, default: () => ({}) }
})

const status = computed(() => props.data.status || (props.data.enabled === false ? 'skip' : 'idle'))

const frameClass = computed(() => {
  const s = status.value
  if (props.data.selected) return 'border-primary ring-2 ring-primary/40'
  if (s === 'not_reached' || s === 'unreachable') return 'border-dashed border-outline-variant/50 opacity-50'
  if (s === 'run' || s === 'running') return 'border-tertiary ring-1 ring-tertiary/40'
  if (s === 'err' || s === 'failed') return 'border-error ring-1 ring-error/30'
  if (s === 'ok' || s === 'done') return 'border-primary/60 ring-1 ring-primary/20'
  if (s === 'skip' || s === 'skipped' || props.data.enabled === false) return 'border-outline-variant/40 opacity-60'
  return 'border-outline-variant'
})

const dotClass = computed(() => {
  const s = status.value
  if (s === 'not_reached' || s === 'unreachable') return 'bg-outline/20'
  if (s === 'run' || s === 'running') return 'bg-tertiary animate-pulse'
  if (s === 'err' || s === 'failed') return 'bg-error'
  if (s === 'ok' || s === 'done') return 'bg-primary'
  if (s === 'skip' || s === 'skipped' || props.data.enabled === false) return 'bg-outline'
  return 'bg-primary'
})

const badgeClass = computed(() => {
  const s = status.value
  if (s === 'not_reached' || s === 'unreachable') return 'bg-surface/50 text-outline/50'
  if (s === 'run' || s === 'running') return 'bg-tertiary/20 text-tertiary'
  if (s === 'err' || s === 'failed') return 'bg-error/20 text-error'
  if (s === 'ok' || s === 'done') return 'bg-primary/20 text-primary'
  if (s === 'queued') return 'bg-surface-high text-on-surface-variant'
  if (s === 'skip' || s === 'skipped') return 'bg-surface-high text-outline'
  return 'bg-surface-high text-outline'
})
</script>

<style scoped>
.wf-handle {
  width: 10px;
  height: 10px;
  background: #4d8eff;
  border: 2px solid #181c22;
}
</style>
