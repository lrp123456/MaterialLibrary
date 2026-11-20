<template>
  <div class="rounded-xl bg-surface border border-outline-variant p-3 space-y-2 text-xs">
    <div class="flex items-center justify-between text-[11px] font-semibold text-white border-b border-outline-variant/60 pb-1.5">
      <div class="flex items-center gap-1.5">
        <span class="material-symbols-outlined text-sm text-primary">analytics</span>
        <span>批次图片统计总表</span>
        <span class="text-[10px] text-on-surface-variant font-normal font-mono">(共 {{ summary?.totalImages || 0 }} 张图片)</span>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="(summary?.totalFailures || 0) > 0" class="px-2 py-0.5 rounded-full bg-error/20 text-error text-[10px] font-bold">
          {{ summary.totalFailures }} 个节点失败
        </span>
        <span v-else class="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px]">
          无失败
        </span>
      </div>
    </div>

    <!-- 三栏总表布局：闸门 / 失败 / 终态 -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-0.5">
      <!-- 1. 闸门 5 分类 -->
      <div class="bg-surface-low rounded-lg p-2 space-y-1 border border-outline-variant/40">
        <div class="text-[10px] font-medium text-on-surface-variant flex items-center justify-between">
          <span>闸门分类</span>
          <span class="material-symbols-outlined text-xs text-outline">door_front</span>
        </div>
        <div class="grid grid-cols-5 gap-1 text-center font-mono">
          <div class="bg-surface rounded p-1">
            <div class="text-[9px] text-on-surface-variant">室内</div>
            <div class="text-xs font-bold text-white">{{ summary?.gate?.interior || 0 }}</div>
          </div>
          <div class="bg-surface rounded p-1">
            <div class="text-[9px] text-on-surface-variant">单品</div>
            <div class="text-xs font-bold text-white">{{ summary?.gate?.furniture || 0 }}</div>
          </div>
          <div class="bg-surface rounded p-1">
            <div class="text-[9px] text-on-surface-variant">材质</div>
            <div class="text-xs font-bold text-white">{{ summary?.gate?.material || 0 }}</div>
          </div>
          <div class="bg-surface rounded p-1">
            <div class="text-[9px] text-on-surface-variant">室外</div>
            <div class="text-xs font-bold text-white">{{ summary?.gate?.exterior || 0 }}</div>
          </div>
          <div class="bg-surface rounded p-1">
            <div class="text-[9px] text-error">排除</div>
            <div class="text-xs font-bold text-error">{{ summary?.gate?.excluded || 0 }}</div>
          </div>
        </div>
      </div>

      <!-- 2. 失败节点分类 -->
      <div class="bg-surface-low rounded-lg p-2 space-y-1 border border-outline-variant/40">
        <div class="text-[10px] font-medium text-on-surface-variant flex items-center justify-between">
          <span>失败分布 (按节点)</span>
          <span class="material-symbols-outlined text-xs text-outline">report_problem</span>
        </div>
        <div v-if="failureEntries.length" class="flex flex-wrap gap-1 max-h-12 overflow-y-auto pr-0.5">
          <span
            v-for="[nodeType, count] in failureEntries"
            :key="nodeType"
            class="px-1.5 py-0.5 rounded bg-error/15 border border-error/30 text-[10px] text-error font-mono flex items-center gap-1"
          >
            <span>{{ nodeLabel(nodeType) }}:</span>
            <strong class="font-bold">{{ count }}</strong>
          </span>
        </div>
        <div v-else class="text-[11px] text-on-surface-variant/80 py-1.5 flex items-center gap-1">
          <span class="material-symbols-outlined text-xs text-primary">check_circle</span>
          <span>全链路无失败节点</span>
        </div>
      </div>

      <!-- 3. 终态分布 -->
      <div class="bg-surface-low rounded-lg p-2 space-y-1 border border-outline-variant/40">
        <div class="text-[10px] font-medium text-on-surface-variant flex items-center justify-between">
          <span>资产终态</span>
          <span class="material-symbols-outlined text-xs text-outline">verified</span>
        </div>
        <div class="grid grid-cols-3 gap-1 text-center font-mono">
          <div class="bg-surface rounded p-1">
            <div class="text-[9px] text-primary">入库就绪</div>
            <div class="text-xs font-bold text-primary">{{ summary?.finalStatus?.ready || 0 }}</div>
          </div>
          <div class="bg-surface rounded p-1">
            <div class="text-[9px] text-outline">闸门排除</div>
            <div class="text-xs font-bold text-outline">{{ summary?.finalStatus?.excluded || 0 }}</div>
          </div>
          <div class="bg-surface rounded p-1">
            <div class="text-[9px] text-tertiary">处理中</div>
            <div class="text-xs font-bold text-tertiary">{{ summary?.finalStatus?.processing || 0 }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { NODE_TYPE_NAMES } from '../lineage-narrator'

const props = defineProps({
  summary: {
    type: Object,
    default: () => ({
      totalImages: 0,
      gate: { interior: 0, furniture: 0, material: 0, exterior: 0, excluded: 0 },
      finalStatus: { ready: 0, excluded: 0, processing: 0 },
      failures: {},
      totalFailures: 0
    })
  }
})

const failureEntries = computed(() => {
  const f = props.summary?.failures || {}
  return Object.entries(f).filter(([_, count]) => count > 0)
})

function nodeLabel(type) {
  return NODE_TYPE_NAMES[type] || type
}
</script>
