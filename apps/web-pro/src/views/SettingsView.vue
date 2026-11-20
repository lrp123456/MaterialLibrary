<template>
  <div class="view-root settings-view flex-1 min-h-0 flex flex-col overflow-hidden bg-studio-950 p-7 overflow-y-auto scrollbar-thin font-sans">
    <div class="max-w-4xl mx-auto space-y-7 w-full">
      <!-- 页面标题 -->
      <div class="flex items-center justify-between pb-4 border-b border-studio-700">
        <div>
          <h2 class="text-lg font-bold text-white flex items-center gap-2.5 font-mono">
            <StudioIcon name="settings" :size="20" class="text-studio-accent" />
            系统设置与偏好配置
          </h2>
          <p class="text-xs text-slate-400 mt-1">管理用户工作台网络回退、创作初始默认参数与外部中枢连接</p>
        </div>
        <div class="flex items-center space-x-2 text-xs">
          <span
            class="w-2.5 h-2.5 rounded-full"
            :class="probing ? 'bg-amber-400 animate-pulse' : online ? 'bg-studio-emerald animate-pulse' : 'bg-red-500'"
          ></span>
          <span :class="online ? 'text-emerald-400' : 'text-red-400'" class="font-mono font-bold">
            {{ probing ? '正在探测服务器…' : online ? '后端服务连接正常' : '服务不可达' }}
          </span>
        </div>
      </div>

      <!-- 运维收归提示条：将通道治理、灰度发布与网关规则全部移交 apps/ops-hub:3790 -->
      <div class="p-4 rounded-xl bg-studio-900 border border-studio-cyan/40 flex items-center justify-between shadow-sm">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-studio-cyan/20 flex items-center justify-center text-studio-cyan font-mono font-bold text-sm">
            HUB
          </div>
          <div>
            <div class="text-xs font-bold text-white">平台运维与发布治理中枢已升级独立</div>
            <div class="text-[11px] text-slate-400">AI 算力引擎状态、灰度发布分发、网关分流与 NAS 挂载已统一收归运维平台 (端口 3790)</div>
          </div>
        </div>
        <a
          :href="opsHubUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="px-3.5 py-1.5 rounded-lg bg-studio-cyan text-studio-950 font-bold text-xs hover:brightness-110 transition-all flex items-center gap-1 cursor-pointer"
        >
          <span>前往运维中枢</span>
          <span>&rarr;</span>
        </a>
      </div>

      <!-- 模块 1：服务端连接与三级自动回退 -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
            <StudioIcon name="cloud" :size="16" class="text-studio-accent" />
            服务器连接与三级自动回退
          </h3>
          <span
            class="text-xs px-2.5 py-0.5 rounded-full font-mono font-bold"
            :class="online ? 'text-emerald-300 bg-emerald-400/10 border border-emerald-400/40' : 'text-red-300 bg-red-400/10 border border-red-400/40'"
          >
            {{ online ? '已连接' : '断线' }}
          </span>
        </div>

        <p class="text-xs text-slate-300 leading-relaxed">
          工作台网络层默认直连，按「同源网关 → 本机直连 → 局域网直连 → 公网」顺序自动探测并平滑回退。
        </p>

        <div class="flex items-end gap-2.5 pt-1">
          <div class="flex-1">
            <label class="text-slate-300 font-semibold text-xs block mb-1.5">公网 / 备用服务器地址</label>
            <input
              v-model="manualServerInput"
              type="text"
              placeholder="http://127.0.0.1:30001"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2.5 text-white font-mono text-xs outline-none focus:border-studio-accent"
            />
          </div>
          <button
            type="button"
            class="px-4 py-2.5 rounded-lg bg-studio-accent text-white font-bold text-xs cursor-pointer whitespace-nowrap hover:brightness-110"
            @click="saveServerAddress"
          >
            保存并探测
          </button>
        </div>
      </div>

      <!-- 模块 2：AI 创作工坊默认偏好设置 -->
      <div class="p-6 rounded-2xl bg-studio-900 border border-studio-700 space-y-4 shadow-sm">
        <h3 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide font-mono">
          <StudioIcon name="sliders" :size="16" class="text-studio-indigo" />
          工作室创作全局默认参数
        </h3>
        <p class="text-xs text-slate-300 leading-relaxed">
          集中控制 Web 工作室新建会话或重置时的初始默认模型、画幅比例与清晰度。
        </p>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div>
            <label class="text-slate-400 text-xs block mb-1 font-mono">默认生图/视频模型</label>
            <select
              v-model="defaultModel"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2 text-slate-200 text-xs font-mono outline-none"
            >
              <option value="wan-2.1-t2v-plus">Wan 2.1 文生视频 (Plus)</option>
              <option value="wan-2.1-i2v-plus">Wan 2.1 图生视频 (Plus)</option>
              <option value="qwen-omni-v1">Qwen 图像理解与生成</option>
            </select>
          </div>

          <div>
            <label class="text-slate-400 text-xs block mb-1 font-mono">默认画幅比例</label>
            <select
              v-model="defaultRatio"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2 text-slate-200 text-xs font-mono outline-none"
            >
              <option value="16:9">16:9 (横屏宽银幕)</option>
              <option value="9:16">9:16 (竖屏短视频)</option>
              <option value="1:1">1:1 (正方形方图)</option>
              <option value="4:3">4:3 (经典影视)</option>
            </select>
          </div>

          <div>
            <label class="text-slate-400 text-xs block mb-1 font-mono">默认输出清晰度</label>
            <select
              v-model="defaultResolution"
              class="w-full bg-studio-950 border border-studio-700 rounded-lg p-2 text-slate-200 text-xs font-mono outline-none"
            >
              <option value="720p">720P 高清 (平衡推荐)</option>
              <option value="1080p">1080P 超清</option>
              <option value="4k">4K 极致</option>
            </select>
          </div>
        </div>

        <div class="flex justify-end pt-2">
          <button
            type="button"
            class="px-4 py-2 rounded-lg bg-studio-800 hover:bg-studio-750 border border-studio-700 text-white font-bold text-xs cursor-pointer"
            @click="savePreferences"
          >
            {{ saveSuccess ? '✓ 已保存' : '保存偏好' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';

const online = ref(true);
const probing = ref(false);
const manualServerInput = ref('');
const defaultModel = ref('wan-2.1-t2v-plus');
const defaultRatio = ref('16:9');
const defaultResolution = ref('720p');
const saveSuccess = ref(false);

const opsHubUrl = computed(() => {
  const host = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1';
  return `http://${host}:3790`;
});

function saveServerAddress() {
  if (manualServerInput.value) {
    localStorage.setItem('ml_custom_server_url', manualServerInput.value.trim());
  } else {
    localStorage.removeItem('ml_custom_server_url');
  }
}

function savePreferences() {
  localStorage.setItem('ml_studio_pref_model', defaultModel.value);
  localStorage.setItem('ml_studio_pref_ratio', defaultRatio.value);
  localStorage.setItem('ml_studio_pref_res', defaultResolution.value);
  saveSuccess.value = true;
  setTimeout(() => {
    saveSuccess.value = false;
  }, 2000);
}

onMounted(() => {
  manualServerInput.value = localStorage.getItem('ml_custom_server_url') || '';
  defaultModel.value = localStorage.getItem('ml_studio_pref_model') || 'wan-2.1-t2v-plus';
  defaultRatio.value = localStorage.getItem('ml_studio_pref_ratio') || '16:9';
  defaultResolution.value = localStorage.getItem('ml_studio_pref_res') || '720p';
});
</script>
