<template>
  <div class="flex-1 flex flex-col min-h-0 bg-studio-950 relative overflow-hidden">
    <!-- 编辑器本体：探活通过才挂载，占满整个工作区高宽 -->
    <iframe
      v-if="canMount"
      ref="frameRef"
      :key="frameKey"
      :src="iframeSrc"
      class="w-full h-full border-0 bg-transparent flex-1"
      allow="clipboard-read; clipboard-write; fullscreen"
      @load="onLoad"
    ></iframe>

    <!-- 加载中遮罩指示条 (极简优雅，仅在初次加载中显示) -->
    <div
      v-if="canMount && !loaded"
      class="absolute inset-0 bg-studio-950 flex flex-col items-center justify-center space-y-3 z-10"
    >
      <div class="w-8 h-8 rounded-full border-2 border-studio-accent border-t-transparent animate-spin"></div>
      <div class="text-xs text-slate-400 font-mono tracking-wider">正在加载剪辑工作台...</div>
    </div>

    <!-- 嵌套自检：防递归嵌入 -->
    <div
      v-else-if="isEmbedded"
      class="absolute left-1/2 top-1/3 -translate-x-1/2 max-w-md rounded-xl border border-rose-600/60 bg-studio-900/95 px-5 py-4 text-xs text-rose-200 shadow-2xl"
    >
      <div class="font-bold mb-1">已阻止页面嵌套</div>
      <p class="leading-relaxed text-rose-100/80">
        当前页面本身已经处在嵌入框里。为避免界面重叠，已阻止渲染。
      </p>
      <a href="/editor/projects" target="_blank" rel="noreferrer" class="mt-3 inline-block rounded bg-rose-600 px-3 py-1 font-bold text-black">
        在新窗口打开
      </a>
    </div>

    <!-- 服务未启动时的兜底卡片 -->
    <div
      v-else-if="showHint"
      class="absolute left-1/2 top-1/3 -translate-x-1/2 max-w-lg rounded-xl border border-amber-600/60 bg-studio-900/95 px-6 py-5 text-xs text-amber-200 shadow-2xl"
    >
      <div class="font-bold text-sm mb-1.5 flex items-center space-x-2">
        <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
        <span>剪辑服务未就绪</span>
      </div>
      <p class="leading-relaxed text-amber-100/80">
        剪辑编辑器后台服务（端口 3010）未运行。请先在「服务控制台」中启动「剪辑编辑器 (OpenCut)」。
      </p>
      <div class="mt-4 flex items-center space-x-3">
        <button
          type="button"
          class="rounded-lg bg-amber-500 hover:bg-amber-400 px-4 py-1.5 font-bold text-black transition-all cursor-pointer"
          @click="reload"
        >
          我已启动，刷新连接
        </button>
        <a href="/editor/projects" target="_blank" rel="noreferrer" class="text-xs text-amber-300 hover:underline">
          在新标签页中排查
        </a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch, computed } from 'vue';

const props = defineProps({
  initialPayload: { type: Object, default: null }
});

const frameRef = ref(null);
const frameKey = ref(0);
const loaded = ref(false);
const showHint = ref(false);

const isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
const canMount = ref(false);

const iframeSrc = computed(() => {
  const token = typeof localStorage !== 'undefined' ? (localStorage.getItem('ml_token') || '') : '';
  return token ? `/editor/projects?token=${encodeURIComponent(token)}` : '/editor/projects';
});

/** 探活：HEAD 请求校验 /editor/projects 是否存活 */
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

/** 向 iframe 发送当前主题、适老化模式、缩放档位和 Token */
function syncThemeToFrame() {
  if (!frameRef.value || !frameRef.value.contentWindow) return;
  const currentTheme = localStorage.getItem('material_theme') || 'dark';
  const isSenior = localStorage.getItem('ml_senior_mode') === 'true';
  const seniorZoom = Number(localStorage.getItem('ml_senior_zoom')) || 1;
  const token = localStorage.getItem('ml_token') || '';
  frameRef.value.contentWindow.postMessage(
    {
      type: 'MLS_THEME_CHANGE',
      theme: currentTheme,
      seniorMode: isSenior,
      seniorZoom,
      token
    },
    '*'
  );
}

function syncAuthToFrame() {
  if (!frameRef.value || !frameRef.value.contentWindow) return;
  const token = localStorage.getItem('ml_token') || '';
  frameRef.value.contentWindow.postMessage(
    { type: 'MLS_AUTH_TOKEN', token },
    '*'
  );
}

function sendPayloadToFrame(payload) {
  if (!payload || !frameRef.value || !frameRef.value.contentWindow) return;
  frameRef.value.contentWindow.postMessage(
    { type: 'MLS_IMPORT_ASSET', asset: payload },
    '*'
  );
}

function onLoad() {
  loaded.value = true;
  syncThemeToFrame();
  syncAuthToFrame();
  if (props.initialPayload) {
    setTimeout(() => sendPayloadToFrame(props.initialPayload), 300);
  }
}

function onWindowMessage(event) {
  if (event.data?.type === 'MLS_REQUEST_TOKEN') {
    syncAuthToFrame();
    syncThemeToFrame();
  }
}

// 监听外层主题变化（通过 storage 事件或 MutationObserver）
let themeObserver = null;
onMounted(async () => {
  window.addEventListener('message', onWindowMessage);
  if (isEmbedded) {
    showHint.value = true;
    return;
  }
  const ok = await checkService();
  if (ok) canMount.value = true;

  // 观察主系统 <html> 上的 class（主题/适老开关）与 style（zoom 缩放档位）变化以实时同步到 iframe
  themeObserver = new MutationObserver(() => {
    syncThemeToFrame();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style']
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onWindowMessage);
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});

watch(() => props.initialPayload, (newPayload) => {
  if (newPayload && loaded.value) {
    sendPayloadToFrame(newPayload);
  }
});
</script>
