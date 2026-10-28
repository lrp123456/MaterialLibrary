<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none"
    @click.self="$emit('close')"
  >
    <div class="relative max-w-4xl w-full max-h-[90vh] bg-studio-900 border border-studio-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden font-sans">
      <!-- 模态框顶栏 -->
      <div class="h-14 px-5 border-b border-studio-700 flex items-center justify-between shrink-0 bg-studio-950/50">
        <div class="flex items-center gap-2.5">
          <StudioIcon name="sliders" :size="16" class="text-studio-accent" />
          <span class="font-bold text-sm text-white">模型请求审查与方言预览</span>
          <span class="px-2 py-0.5 rounded bg-studio-cyan/15 text-studio-cyan font-mono text-[10px] font-bold">
            全链路透传审查
          </span>
        </div>

        <button
          type="button"
          @click="$emit('close')"
          class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-studio-800 cursor-pointer transition-colors"
          title="关闭审查 (Esc)"
        >
          <StudioIcon name="close" :size="16" />
        </button>
      </div>

      <!-- 主体滚动区：四块核心内容展示 -->
      <div class="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin text-xs">
        <!-- 块 1：你写的原文 -->
        <div class="rounded-xl border border-studio-700 bg-studio-950 p-4 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-bold text-slate-300 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-studio-accent"></span>
              1. 你写的原文
            </span>
            <button
              type="button"
              @click="copyText(previewData?.rawPrompt || previewData?.prompt || '')"
              class="text-[11px] font-bold text-slate-400 hover:text-studio-accent flex items-center gap-1 cursor-pointer transition-colors"
            >
              <StudioIcon name="copy" :size="12" hoverMorph />
              <span>复制原文</span>
            </button>
          </div>
          <div class="p-3 rounded-lg bg-studio-900 border border-studio-800 font-sans text-slate-100 text-xs leading-relaxed whitespace-pre-wrap select-text">
            {{ previewData?.rawPrompt || previewData?.prompt || '（无正文内容）' }}
          </div>
        </div>

        <!-- 块 2：方言编译后的正文 -->
        <div class="rounded-xl border border-studio-700 bg-studio-950 p-4 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-bold text-studio-cyan flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-studio-cyan"></span>
              2. 供应商方言编译后正文
            </span>
            <button
              type="button"
              @click="copyText(previewData?.dialectPrompt || previewData?.compiledPrompt || '')"
              class="text-[11px] font-bold text-slate-400 hover:text-studio-cyan flex items-center gap-1 cursor-pointer transition-colors"
            >
              <StudioIcon name="copy" :size="12" hoverMorph />
              <span>复制方言结果</span>
            </button>
          </div>
          <div class="p-3 rounded-lg bg-studio-900 border border-studio-800 font-mono text-cyan-200 text-xs leading-relaxed whitespace-pre-wrap select-text">
            {{ previewData?.dialectPrompt || previewData?.compiledPrompt || '（编译结果为空）' }}
          </div>
        </div>

        <!-- 块 3：图列表清单 -->
        <div class="rounded-xl border border-studio-700 bg-studio-950 p-4 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-bold text-slate-300 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
              3. 参考图片挂载清单 ({{ (previewData?.images || []).length }} 张)
            </span>
            <span class="text-[10px] text-slate-500 font-mono">已剔除敏感 Token Query</span>
          </div>

          <div v-if="!previewData?.images || !previewData?.images.length" class="py-4 text-center text-slate-500 font-medium">
            本次请求未挂载任何参考图
          </div>
          <div v-else class="space-y-1.5">
            <div
              v-for="(img, idx) in previewData.images"
              :key="idx"
              class="flex items-center justify-between p-2.5 rounded-lg bg-studio-900 border border-studio-800 gap-3"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <span class="px-2 py-0.5 rounded bg-studio-cyan/15 text-studio-cyan font-mono text-[11px] font-bold shrink-0">
                  {{ img.tag || `@图${idx + 1}` }}
                </span>
                <span
                  :class="[
                    'px-1.5 py-0.5 rounded text-[10px] font-bold font-mono uppercase shrink-0',
                    img.source === 'history' ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30' : 'bg-emerald-400/15 text-emerald-300 border border-emerald-400/30'
                  ]"
                >
                  {{ img.source === 'history' ? '历史沿用 (history)' : '当前看图区 (stage)' }}
                </span>
                <span
                  v-if="img.isWireframe"
                  class="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-rose-500/15 text-rose-300 border border-rose-500/30 shrink-0"
                >
                  纯线框交付
                </span>
                <span class="font-mono text-slate-300 text-[11px] truncate select-text" :title="img.path">
                  {{ img.path }}
                </span>
              </div>

              <a
                :href="img.fullUrl || img.path"
                target="_blank"
                rel="noreferrer"
                class="text-studio-accent hover:underline text-[11px] font-bold shrink-0 cursor-pointer"
                @click.prevent="openDeliveryImage(img)"
              >
                核对交付图 ↗
              </a>
            </div>
          </div>
        </div>

        <!-- 块 4：请求头、JSON 正文与 cURL 指令 -->
        <div class="rounded-xl border border-studio-700 bg-studio-950 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-bold text-slate-300 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-studio-rose"></span>
              4. 请求详情 (已严格脱敏: Authorization / API_KEY 均遮蔽)
            </span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                @click="copyText(previewData?.request?.curl || '')"
                class="px-2.5 py-1 rounded bg-studio-850 hover:bg-studio-800 border border-studio-700 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
              >
                <StudioIcon name="copy" :size="12" hoverMorph />
                <span>复制 cURL</span>
              </button>
            </div>
          </div>

          <!-- 请求头 -->
          <div class="space-y-1">
            <div class="text-[10px] font-bold text-slate-400 font-mono">HEADERS:</div>
            <pre class="p-2.5 rounded-lg bg-studio-900 border border-studio-800 font-mono text-[11px] text-slate-300 overflow-x-auto select-text">{{ JSON.stringify(previewData?.request?.headers || {}, null, 2) }}</pre>
          </div>

          <!-- JSON 正文 -->
          <div class="space-y-1">
            <div class="text-[10px] font-bold text-slate-400 font-mono">JSON BODY:</div>
            <pre class="p-2.5 rounded-lg bg-studio-900 border border-studio-800 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-48 scrollbar-thin select-text">{{ JSON.stringify(previewData?.request?.body || {}, null, 2) }}</pre>
          </div>

          <!-- cURL 脚本 -->
          <div class="space-y-1">
            <div class="text-[10px] font-bold text-slate-400 font-mono">CURL REPRODUCE:</div>
            <pre class="p-2.5 rounded-lg bg-studio-900 border border-studio-800 font-mono text-[11px] text-emerald-300/90 overflow-x-auto select-text whitespace-pre-wrap">{{ previewData?.request?.curl || '' }}</pre>
          </div>
        </div>
      </div>

      <!-- 底部关闭按钮行 -->
      <div class="h-14 px-5 border-t border-studio-700 flex items-center justify-between shrink-0 bg-studio-950/60">
        <span class="text-xs text-slate-400 font-medium">
          {{ copied ? '✓ 已复制到剪贴板' : '所有请求参数均与实际发出请求完全一致' }}
        </span>
        <button
          type="button"
          @click="$emit('close')"
          class="px-5 py-2 rounded-xl bg-studio-850 hover:bg-studio-800 text-white font-bold text-xs border border-studio-700 cursor-pointer transition-colors"
        >
          完成审查
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import StudioIcon from './StudioIcon.vue';

defineProps({
  visible: { type: Boolean, default: false },
  previewData: { type: Object, default: null }
});

defineEmits(['close']);

const copied = ref(false);

function openDeliveryImage(img) {
  const url = img?.fullUrl || img?.path;
  if (!url) return;
  if (url.startsWith('data:')) {
    try {
      const comma = url.indexOf(',');
      const mime = url.slice(5, comma).split(';')[0];
      const byteChars = atob(url.slice(comma + 1));
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: mime });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
      return;
    } catch (e) {
      console.warn('转换为 Blob 预览失败，回退打开:', e);
    }
  }
  window.open(url, '_blank');
}

function copyText(str) {
  if (!str) return;
  navigator.clipboard.writeText(str).then(() => {
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  });
}
</script>
