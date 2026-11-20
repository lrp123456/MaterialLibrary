<template>
  <div
    class="message-card group relative p-4 rounded-2xl border transition-all duration-200"
    :class="[
      msg.role === 'user'
        ? 'bg-studio-900/40 border-studio-800 ml-12 text-slate-100'
        : 'bg-studio-900 border-studio-700/80 mr-12 text-slate-200 shadow-md',
      { 'border-red-500/40 bg-red-950/10': msg.status === 'failed' }
    ]"
  >
    <!-- 卡片头部信息 -->
    <div class="flex items-center justify-between mb-2 text-xs text-slate-400">
      <div class="flex items-center gap-2">
        <span class="font-bold text-xs uppercase tracking-wider font-mono text-studio-accent">
          {{ msg.role === 'user' ? '用户提示词' : (msg.modelKey || 'AI 创作者') }}
        </span>
        <span v-if="msg.status === 'running' || msg.status === 'queued'" class="px-1.5 py-0.5 rounded text-[10px] bg-studio-cyan/20 text-studio-cyan font-mono animate-pulse">
          {{ msg.status === 'queued' ? '排队中…' : (msg.stage || '正在生成…') }}
        </span>
        <span v-else-if="msg.status === 'cancelled'" class="px-1.5 py-0.5 rounded text-[10px] bg-slate-750 text-slate-400 font-mono">
          已取消
        </span>
      </div>

      <!-- 取消操作按钮（先裁决后落态，cancellable 为 false 时禁止再次误点） -->
      <button
        v-if="(msg.status === 'running' || msg.status === 'queued') && msg.cancellable !== false"
        type="button"
        class="px-2 py-0.5 rounded bg-studio-800 hover:bg-red-500/20 text-slate-300 hover:text-red-300 text-xs font-mono transition-colors border border-studio-700"
        @click="$emit('cancel', msg.jobId || msg.id)"
      >
        取消任务
      </button>
    </div>

    <!-- 用户提示词与 @混排 标签 -->
    <div v-if="msg.prompt" class="text-sm leading-relaxed mb-3 whitespace-pre-wrap">
      {{ msg.prompt }}
    </div>

    <!-- 媒体渲染区域（图片 / 视频） -->
    <div v-if="msg.mediaUrl || msg.videoUrl" class="rounded-xl overflow-hidden bg-studio-950 border border-studio-800 mb-3 relative group/media">
      <video
        v-if="msg.videoUrl"
        :src="msg.videoUrl"
        controls
        class="w-full max-h-96 object-contain"
      />
      <img
        v-else-if="msg.mediaUrl"
        :src="msg.mediaUrl"
        :alt="msg.prompt"
        class="w-full max-h-96 object-contain cursor-pointer"
        @click="$emit('preview', msg)"
      />
    </div>

    <!-- Seedream 5.0 图层分解栈展示 -->
    <div v-if="msg.layerStack && msg.layerStack.length" class="layer-stack-box p-2.5 rounded-xl bg-studio-950/80 border border-studio-800 mb-3 space-y-1.5">
      <div class="text-[11px] font-mono text-slate-400 flex items-center justify-between">
        <span>图层分解栈 ({{ msg.layerStack.length }} 层)</span>
        <span class="text-studio-accent text-[10px]">Seedream 5.0</span>
      </div>
      <div class="flex gap-2 overflow-x-auto py-1">
        <div
          v-for="(layer, lIdx) in msg.layerStack"
          :key="lIdx"
          class="shrink-0 w-16 h-16 rounded border border-studio-700 bg-studio-900 overflow-hidden relative cursor-pointer"
          @click="$emit('preview-layer', layer)"
        >
          <img v-if="layer.url" :src="layer.url" :alt="layer.name || `图层 ${lIdx}`" class="w-full h-full object-cover" />
          <span class="absolute bottom-0 inset-x-0 bg-studio-950/80 text-[8px] text-center truncate px-0.5 text-slate-300">
            {{ layer.name || `L${lIdx + 1}` }}
          </span>
        </div>
      </div>
    </div>

    <!-- 错误排查与文案清洗建议 -->
    <div v-if="msg.error" class="p-3 rounded-xl bg-red-950/30 border border-red-500/30 text-xs text-red-300 space-y-1">
      <div class="font-bold flex items-center gap-1.5">
        <span>⚠️ 生成遇到异常</span>
      </div>
      <p class="leading-relaxed font-mono">
        {{ sanitizeError(msg.error) }}
      </p>
      <div v-if="/HTTP 429|service is busy/i.test(msg.error)" class="text-amber-300 text-[11px]">
        建议：当前上游算力高峰繁忙，请稍等 10-30 秒后重试。
      </div>
      <div v-else-if="/aborted due to timeout/i.test(msg.error)" class="text-amber-300 text-[11px]">
        建议：高画质排队渲染等待超时，已为您安全停止并归还并发配额。
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  msg: {
    type: Object,
    required: true,
  },
});

defineEmits(['cancel', 'preview', 'preview-layer', 'retry']);

function sanitizeError(err) {
  if (!err) return '';
  const s = String(err);
  // 必须清理旧错误消息尾部的调试参数
  if (s.includes('实际请求参数')) {
    return s.split('实际请求参数')[0].trim();
  }
  return s;
}
</script>
