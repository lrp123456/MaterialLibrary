<template>
  <div class="space-y-3 text-xs">
    <!-- 资产卡片头 -->
    <div class="flex items-start gap-3 bg-surface rounded-xl p-3 border border-outline-variant">
      <div class="w-16 h-20 rounded-lg bg-surface-high border border-outline-variant overflow-hidden shrink-0 flex items-center justify-center relative">
        <img
          v-if="asset?.fid"
          :src="api.imageUrl(asset.fid)"
          :alt="asset.file_name"
          class="w-full h-full object-cover"
          @error="(e) => e.target.style.display = 'none'"
        />
        <span class="material-symbols-outlined text-outline text-xl absolute">image</span>
      </div>
      <div class="min-w-0 flex-1 space-y-1">
        <div class="flex items-center justify-between gap-1">
          <h4 class="font-bold text-white text-xs truncate" :title="asset?.file_name || asset?.fid">
            {{ asset?.file_name || asset?.fid }}
          </h4>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0" :class="assetStatusBadgeClass(asset?.status)">
            {{ asset?.status }}
          </span>
        </div>
        <p class="text-[10px] text-outline font-mono truncate">FID: {{ asset?.fid }}</p>
        <p class="text-[10px] text-on-surface-variant flex items-center gap-2">
          <span>类别: {{ categoryLabel(asset?.category) }}</span>
          <span v-if="asset?.dominant_color">颜色: {{ asset.dominant_color }}</span>
        </p>
      </div>
    </div>

    <!-- 查重聚类信息（若有） -->
    <div v-if="cluster && cluster.members?.length" class="bg-surface rounded-xl p-3 border border-outline-variant space-y-1.5 text-[11px]">
      <div class="flex items-center justify-between text-on-surface-variant">
        <span class="font-semibold text-white flex items-center gap-1">
          <span class="material-symbols-outlined text-xs text-primary">burst_mode</span>
          <span>查重聚合组 (共 {{ cluster.members.length }} 张)</span>
        </span>
        <span class="text-[10px] text-outline">{{ cluster.reason || '同场景连拍' }}</span>
      </div>
      <div class="flex gap-1.5 overflow-x-auto py-1">
        <div
          v-for="m in cluster.members.slice(0, 10)"
          :key="m.fid"
          class="w-10 h-10 rounded border overflow-hidden shrink-0 relative"
          :class="m.fid === asset?.fid ? 'border-primary ring-1 ring-primary' : 'border-outline-variant'"
          :title="`${m.file_name || m.fid}${m.is_representative ? ' (代表图)' : ''}`"
        >
          <img :src="api.imageUrl(m.fid)" class="w-full h-full object-cover" />
          <span v-if="m.is_representative" class="absolute bottom-0 right-0 bg-primary text-white text-[8px] px-0.5 rounded-tl font-bold">主</span>
        </div>
      </div>
    </div>

    <!-- 单张有序生命周期全路径 -->
    <div class="space-y-2">
      <div class="flex items-center justify-between text-[11px] font-semibold text-white px-1">
        <span class="flex items-center gap-1">
          <span class="material-symbols-outlined text-xs text-primary">route</span>
          <span>全链路生命周期</span>
        </span>
        <span class="text-[10px] text-outline font-normal">按工作流节点顺序展示</span>
      </div>

      <div class="space-y-2">
        <div
          v-for="(step, idx) in steps"
          :key="step.nodeId || idx"
          class="rounded-xl border p-2.5 space-y-1.5 transition"
          :class="stepContainerClass(step)"
        >
          <div class="flex items-center justify-between gap-1">
            <div class="flex items-center gap-2 min-w-0">
              <span class="w-2 h-2 rounded-full shrink-0" :class="stepDotClass(step.status)"></span>
              <span class="font-bold text-white text-xs truncate">{{ step.nodeName }}</span>
              <span class="text-[10px] text-outline font-mono">({{ step.nodeType }})</span>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <span v-if="step.durationMs" class="text-[10px] text-outline font-mono">{{ step.durationMs }}ms</span>
              <span class="px-1.5 py-0.2 rounded text-[10px] font-mono font-medium" :class="stepBadgeClass(step.status)">
                {{ stepStatusLabel(step.status) }}
              </span>
            </div>
          </div>

          <!-- 一行人话解读 -->
          <div class="text-[11px] pl-4 flex items-start gap-1" :class="stepNarrativeTextClass(step.status)">
            <span class="material-symbols-outlined text-xs mt-0.5 shrink-0">{{ stepIcon(step.status) }}</span>
            <span class="leading-relaxed">{{ step.narrative }}</span>
          </div>

          <!-- 原始 JSON 抽屉（可折叠） -->
          <details v-if="step.record" class="pl-4 pt-1">
            <summary class="cursor-pointer text-[10px] text-outline hover:text-white select-none transition">
              查看节点原始入参 / 输出 JSON
            </summary>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
              <div>
                <span class="text-[9px] text-outline block mb-0.5">输入 (Input)</span>
                <pre class="bg-surface-low rounded p-2 overflow-auto max-h-36 text-[10px] text-on-surface-variant font-mono">{{ JSON.stringify(step.input || {}, null, 2) }}</pre>
              </div>
              <div>
                <span class="text-[9px] text-outline block mb-0.5">输出 (Output)</span>
                <pre class="bg-surface-low rounded p-2 overflow-auto max-h-36 text-[10px] text-on-surface-variant font-mono">{{ JSON.stringify(step.output || {}, null, 2) }}</pre>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { api } from '../api'
import { buildAssetLineagePath, CATEGORY_LABELS } from '../lineage-narrator'

const props = defineProps({
  workflowNodes: { type: Array, default: () => [] },
  asset: { type: Object, default: () => null },
  nodeRuns: { type: Array, default: () => [] },
  cluster: { type: Object, default: () => null }
})

const steps = computed(() => {
  return buildAssetLineagePath(props.workflowNodes, props.nodeRuns, props.asset)
})

function categoryLabel(cat) {
  return CATEGORY_LABELS[cat] || cat || '未分类'
}

function assetStatusBadgeClass(st) {
  if (st === 'ready' || st === 'ready_with_flags') return 'bg-primary/20 text-primary border border-primary/30'
  if (st === 'excluded') return 'bg-outline/20 text-outline border border-outline-variant'
  return 'bg-tertiary/20 text-tertiary border border-tertiary/30'
}

function stepContainerClass(step) {
  const s = step.status
  if (s === 'unreachable') return 'bg-surface/50 border-outline-variant/30 opacity-60'
  if (s === 'failed') return 'bg-surface border-error/50 ring-1 ring-error/20'
  if (s === 'running') return 'bg-surface border-tertiary/50 ring-1 ring-tertiary/20'
  if (s === 'queued') return 'bg-surface border-tertiary/30'
  if (s === 'skipped') return 'bg-surface border-outline-variant/50'
  return 'bg-surface border-outline-variant'
}

function stepDotClass(st) {
  if (st === 'done') return 'bg-primary'
  if (st === 'failed') return 'bg-error'
  if (st === 'running') return 'bg-tertiary animate-pulse'
  if (st === 'queued') return 'bg-tertiary'
  if (st === 'skipped') return 'bg-outline'
  return 'bg-outline/30'
}

function stepBadgeClass(st) {
  if (st === 'done') return 'bg-primary/20 text-primary'
  if (st === 'failed') return 'bg-error/20 text-error'
  if (st === 'running') return 'bg-tertiary/20 text-tertiary'
  if (st === 'queued') return 'bg-surface text-on-surface-variant'
  if (st === 'skipped') return 'bg-surface text-outline'
  return 'bg-surface/50 text-outline/50'
}

function stepStatusLabel(st) {
  const map = {
    done: '完成',
    failed: '失败',
    running: '运行中',
    queued: '排队中',
    skipped: '跳过',
    unreachable: '未到达'
  }
  return map[st] || st
}

function stepNarrativeTextClass(st) {
  if (st === 'failed') return 'text-error'
  if (st === 'done') return 'text-on-surface'
  if (st === 'skipped') return 'text-on-surface-variant'
  if (st === 'unreachable') return 'text-outline/70'
  return 'text-tertiary'
}

function stepIcon(st) {
  if (st === 'done') return 'check'
  if (st === 'failed') return 'close'
  if (st === 'skipped') return 'fast_forward'
  if (st === 'running') return 'progress_activity'
  if (st === 'queued') return 'schedule'
  return 'remove'
}
</script>
