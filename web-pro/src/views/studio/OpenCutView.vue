<template>
  <div class="flex-1 flex flex-col min-h-0 bg-studio-950">
    <!-- 工具条：说明 + 重载 + 新窗口 -->
    <div class="h-9 shrink-0 px-4 flex items-center justify-between border-b border-studio-700 bg-studio-900 text-[11px] font-mono text-slate-400">
      <div class="flex items-center gap-2">
        <span class="w-1.5 h-1.5 rounded-full" :class="statusColor"></span>
        <span>{{ statusText }}</span>
        <span class="text-slate-600">·</span>
        <span>同域嵌入 /editor（OpenCut Classic）</span>
      </div>
      <div class="flex items-center gap-3">
        <button type="button" class="hover:text-slate-200 cursor-pointer" @click="reload">重新加载</button>
        <a href="/editor/projects" target="_blank" rel="noreferrer" class="hover:text-slate-200">新窗口打开</a>
      </div>
    </div>

    <!-- 编辑器本体：探活通过才挂载，避免加载到本应用自身造成递归 -->
    <div class="relative flex-1 min-h-0">
      <iframe
        v-if="canMount"
        ref="frameRef"
        :key="frameKey"
        src="/editor/projects"
        class="w-full h-full border-0 bg-studio-950"
        allow="clipboard-read; clipboard-write; fullscreen"
        @load="onLoad"
      ></iframe>

      <!-- 嵌套自检：宁可显示提示，也不再套一层 -->
      <div
        v-else-if="isEmbedded"
        class="absolute left-1/2 top-1/3 -translate-x-1/2 max-w-md rounded-xl border border-rose-600/60 bg-studio-900/95 px-5 py-4 text-xs text-rose-200 shadow-2xl"
      >
        <div class="font-bold mb-1">已阻止页面嵌套</div>
        <p class="leading-relaxed text-rose-100/80">
          当前页面本身已经处在嵌入框里（通常是 /editor 代理未生效，编辑器页面被本应用首页接管）。
          为避免无限套娃，这里不再渲染第二个编辑器。
        </p>
        <a href="/editor/projects" target="_blank" rel="noreferrer" class="mt-3 inline-block rounded bg-rose-600 px-3 py-1 font-bold text-black">
          在新窗口打开
        </a>
      </div>

      <!-- 服务没起来时的兜底提示 -->
      <div
        v-else-if="showHint"
        class="absolute left-1/2 top-1/3 -translate-x-1/2 max-w-lg rounded-xl border border-amber-600/60 bg-studio-900/95 px-5 py-4 text-xs text-amber-200 shadow-2xl"
      >
        <div class="font-bold mb-1">编辑器没有响应</div>
        <p class="leading-relaxed text-amber-100/80">
          剪辑服务（端口 3010）未启动。请在「服务面板」里启动「剪辑编辑器 (OpenCut)」，
          或先执行一次构建：
        </p>
        <code class="mt-2 block rounded bg-black/40 px-2 py-1 text-[11px] text-amber-100">
          cd editor/apps/web &amp;&amp; NEXT_DIST_DIR=.next-build4 npx next build
        </code>
        <button type="button" class="mt-3 rounded bg-amber-600 px-3 py-1 font-bold text-black cursor-pointer" @click="reload">
          我已启动，重新加载
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';

const frameRef = ref(null);
const frameKey = ref(0);
const loaded = ref(false);
const showHint = ref(false);

/**
 * 递归闸门（防"页面套页面"）：
 * 如果 /editor 代理没生效，iframe 会拿到本应用的 index.html，
 * 于是里面又渲染一个 OpenCutView → 再套一层，最后整个首页被叠成一摞。
 * 只要检测到自己在 iframe 里，就绝不渲染第二个编辑器。
 */
const isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
const canMount = ref(false);

const statusText = computed(() => {
  if (isEmbedded) return '检测到嵌套，已停止加载';
  if (showHint.value) return '服务未就绪';
  return loaded.value ? '已加载' : '加载中';
});
const statusColor = computed(() => {
  if (isEmbedded || showHint.value) return 'bg-rose-400';
  return loaded.value ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse';
});

/** 用一次 HEAD 探活：iframe 即使拿到 502 页面也会触发 load，不能作为健康判据。 */
async function checkService() {
  try {
    const res = await fetch('/editor/projects', { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) {
      showHint.value = true;
      return false;
    }
    showHint.value = false;
    return true;
  } catch {
    showHint.value = true;
    return false;
  }
}

async function reload() {
  if (isEmbedded) return;
  loaded.value = false;
  showHint.value = false;
  canMount.value = false;
  const ok = await checkService();
  if (ok) {
    canMount.value = true;
    frameKey.value += 1;
  }
}

function onLoad() {
  loaded.value = true;
}

onMounted(async () => {
  if (isEmbedded) {
    showHint.value = true;
    return;
  }
  const ok = await checkService();
  if (ok) canMount.value = true;
});
</script>
