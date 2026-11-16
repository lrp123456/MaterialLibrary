<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none"
    @click.self="$emit('close')"
  >
    <div class="relative max-w-3xl w-full max-h-[90vh] bg-studio-900 border border-studio-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden font-sans text-slate-200">
      <!-- 模态框顶栏 -->
      <div class="h-14 px-5 border-b border-studio-700 flex items-center justify-between shrink-0 bg-studio-950/70">
        <div class="flex items-center gap-2.5">
          <span class="p-1.5 rounded-lg bg-rose-500/10 text-rose-400">
            <StudioIcon name="warning" :size="16" />
          </span>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-sm text-white">生成任务诊断与原始日志</span>
              <span class="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 font-mono text-[10px] font-bold">
                {{ jobStatusLabel }}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          @click="$emit('close')"
          class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-studio-800 cursor-pointer transition-colors"
          title="关闭 (Esc)"
        >
          <StudioIcon name="close" :size="16" />
        </button>
      </div>

      <!-- 主体滚动区 -->
      <div class="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin text-xs">
        <!-- 块 1：基本信息与耗时指标 -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div class="p-3 rounded-xl border border-studio-800 bg-studio-950/60 flex flex-col justify-between">
            <span class="text-slate-400 text-[11px]">任务 ID</span>
            <div class="flex items-center justify-between mt-1.5 font-mono text-slate-200 text-xs font-semibold">
              <span class="truncate" :title="resolvedJobId">{{ displayJobId }}</span>
              <button
                v-if="resolvedJobId"
                type="button"
                @click="copyText(resolvedJobId, '任务 ID')"
                class="ml-1 text-slate-400 hover:text-studio-accent p-0.5"
                title="复制任务 ID"
              >
                <StudioIcon name="copy" :size="11" />
              </button>
            </div>
          </div>

          <div class="p-3 rounded-xl border border-studio-800 bg-studio-950/60 flex flex-col justify-between">
            <span class="text-slate-400 text-[11px]">生成耗时</span>
            <span class="mt-1.5 font-mono text-amber-300 text-xs font-bold">
              {{ formattedDuration }}
            </span>
          </div>

          <div class="p-3 rounded-xl border border-studio-800 bg-studio-950/60 flex flex-col justify-between">
            <span class="text-slate-400 text-[11px]">调用模型</span>
            <span class="mt-1.5 font-mono text-cyan-300 text-xs font-semibold truncate" :title="modelName">
              {{ modelName || '未知模型' }}
            </span>
          </div>

          <div class="p-3 rounded-xl border border-studio-800 bg-studio-950/60 flex flex-col justify-between">
            <span class="text-slate-400 text-[11px]">生成模态</span>
            <span class="mt-1.5 font-sans text-slate-300 text-xs font-semibold">
              {{ modalityLabel }}
            </span>
          </div>
        </div>

        <!-- 块 1.5：三段式阶段耗时拆解（渲染 / 超分 / 系统开销） -->
        <div v-if="stageTiming" class="rounded-xl border border-emerald-900/50 bg-emerald-950/15 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-bold text-emerald-200 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
              阶段耗时拆解（渲染 / 超分 / 系统开销）
            </span>
            <span class="text-[11px] text-slate-400 font-mono">总耗时 {{ formatStageMs(stageTiming.totalMs) }}</span>
          </div>

          <div class="grid grid-cols-3 gap-2 font-mono text-[11px]">
            <div class="p-2.5 rounded-lg bg-studio-900 border border-studio-800">
              <div class="text-slate-400 text-[10px] mb-1">云端渲染</div>
              <div class="text-cyan-300 font-bold text-sm">{{ formatStageMs(stageTiming.renderMs) }}</div>
              <div v-if="stageTiming.renderUpstreamMs != null" class="text-[10px] text-slate-500 mt-0.5">百炼官方计时</div>
            </div>
            <div class="p-2.5 rounded-lg bg-studio-900 border border-studio-800">
              <div class="text-slate-400 text-[10px] mb-1">超分处理</div>
              <div class="text-violet-300 font-bold text-sm">{{ stageTiming.srMs != null ? formatStageMs(stageTiming.srMs) : '未触发' }}</div>
              <div v-if="stageTiming.sr" class="text-[10px] text-slate-500 mt-0.5">处理 {{ formatStageMs(stageTiming.sr.processingMs) }}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-studio-900 border border-studio-800">
              <div class="text-slate-400 text-[10px] mb-1">系统开销</div>
              <div class="text-amber-300 font-bold text-sm">{{ formatStageMs(stageTiming.systemMs) }}</div>
              <div class="text-[10px] text-slate-500 mt-0.5">含排队 {{ formatStageMs(stageTiming.queueMs) }}</div>
            </div>
          </div>

          <!-- 细分项：仅在有万相/SR 明细时展示 -->
          <div v-if="stageTimingDetail" class="p-2.5 rounded-lg bg-studio-900/70 border border-studio-800 font-mono text-[10px] text-slate-400 leading-relaxed select-text">
            {{ stageTimingDetail }}
          </div>
        </div>

        <!-- 块 2：全链路时间戳流转 -->
        <div class="rounded-xl border border-studio-700 bg-studio-950 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-bold text-slate-300 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-studio-cyan"></span>
              时间戳流转（生成时序追踪）
            </span>
            <span v-if="loading" class="text-[11px] text-studio-accent flex items-center gap-1">
              <StudioIcon name="refresh" :size="11" class="animate-spin" />
              正在同步服务端最新日志...
            </span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px]">
            <div class="p-2.5 rounded-lg bg-studio-900 border border-studio-800">
              <div class="text-slate-400 text-[10px] mb-1">1. 提交入队 (Created)</div>
              <div class="text-slate-200 font-semibold">{{ formatTime(timestamps.createdAt) }}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-studio-900 border border-studio-800">
              <div class="text-slate-400 text-[10px] mb-1">2. 开始执行 (Started)</div>
              <div class="text-slate-200 font-semibold">{{ formatTime(timestamps.startedAt) }}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-studio-900 border border-studio-800">
              <div class="text-slate-400 text-[10px] mb-1">3. 异常结束 (Finished)</div>
              <div class="text-rose-300 font-semibold">{{ formatTime(timestamps.completedAt) }}</div>
            </div>
          </div>
        </div>

        <!-- 块 3：根本原因与诊断分析 -->
        <div class="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4 space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="font-bold text-rose-200 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-rose-400"></span>
              错误原因定位与分析
            </span>
            <span v-if="errorCode" class="px-2 py-0.5 rounded bg-rose-900/40 text-rose-300 font-mono text-[10px]">
              CODE: {{ errorCode }}
            </span>
          </div>

          <!-- 原始错误消息 -->
          <div class="p-3 rounded-lg bg-rose-950/40 border border-rose-900/60 font-mono text-rose-200 text-xs leading-relaxed select-text">
            {{ rawErrorMessage }}
          </div>

          <!-- 智能诊断建议 -->
          <div class="p-3 rounded-lg bg-studio-950/80 border border-studio-800 text-slate-300 text-xs leading-relaxed space-y-1">
            <div class="font-bold text-amber-300 flex items-center gap-1.5">
              <StudioIcon name="info" :size="13" />
              <span>排查指引与根因解读：</span>
            </div>
            <div class="text-slate-300 pl-4">{{ diagnosticGuide }}</div>
          </div>
        </div>

        <!-- 块 4：请求参数摘要 -->
        <div v-if="requestParamsSummary" class="rounded-xl border border-studio-700 bg-studio-950 p-4 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-bold text-slate-300 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-studio-accent"></span>
              生成请求参数快照
            </span>
          </div>
          <div class="p-3 rounded-lg bg-studio-900 border border-studio-800 font-mono text-slate-300 text-xs leading-relaxed whitespace-pre-wrap select-text">
            {{ requestParamsSummary }}
          </div>
        </div>

        <!-- 块 5：原始返回日志 JSON (带一键复制) -->
        <div class="rounded-xl border border-studio-700 bg-studio-950 p-4 space-y-2">
          <div class="flex items-center justify-between">
            <button
              type="button"
              @click="showRawJson = !showRawJson"
              class="font-bold text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
            >
              <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span>原始日志与完整数据包 (JSON)</span>
              <span class="text-[11px] text-slate-400 font-normal">
                {{ showRawJson ? '收起' : '展开' }}
              </span>
            </button>

            <button
              type="button"
              @click="copyFullLog"
              class="text-[11px] font-bold text-slate-400 hover:text-studio-accent flex items-center gap-1 cursor-pointer transition-colors"
            >
              <StudioIcon name="copy" :size="12" hoverMorph />
              <span>{{ copied ? '已复制！' : '复制完整日志' }}</span>
            </button>
          </div>

          <pre
            v-if="showRawJson"
            class="p-3 rounded-lg bg-studio-900 border border-studio-800 font-mono text-slate-300 text-[11px] leading-relaxed max-h-72 overflow-y-auto scrollbar-thin select-text whitespace-pre-wrap break-words"
          >{{ formattedFullJson }}</pre>
        </div>
      </div>

      <!-- 底部操作栏 -->
      <div class="h-14 px-5 border-t border-studio-700 flex items-center justify-between shrink-0 bg-studio-950/70">
        <span class="text-[11px] text-slate-500 font-mono">
          状态同步时间: {{ formatTime(Date.now()) }}
        </span>

        <div class="flex items-center gap-2">
          <button
            type="button"
            @click="copyFullLog"
            class="px-3 py-1.5 rounded-lg border border-studio-700 bg-studio-800 hover:bg-studio-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1"
          >
            <StudioIcon name="copy" :size="12" />
            <span>{{ copied ? '已复制日志' : '一键复制日志' }}</span>
          </button>
          <button
            type="button"
            @click="$emit('close')"
            class="px-4 py-1.5 rounded-lg bg-studio-accent hover:bg-studio-accent/90 text-white text-xs font-bold cursor-pointer transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import StudioIcon from './StudioIcon.vue';
import { fetchGenJob } from '../api.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
  msg: { type: Object, default: () => ({}) },
});

defineEmits(['close']);

const loading = ref(false);
const serverJob = ref(null);
const showRawJson = ref(true);
const copied = ref(false);

const resolvedJobId = computed(() => {
  if (serverJob.value?.job_id) return serverJob.value.job_id;
  if (props.msg?.jobId) return props.msg.jobId;
  const id = props.msg?.id || '';
  if (id.startsWith('genmsg_')) return id.replace(/^genmsg_/, '');
  return '';
});

const displayJobId = computed(() => {
  const jid = resolvedJobId.value;
  if (!jid) return '本地未分配 (Direct)';
  return jid.length > 20 ? `${jid.slice(0, 10)}...${jid.slice(-8)}` : jid;
});

const jobStatusLabel = computed(() => {
  if (props.msg?.isCancelled || serverJob.value?.status === 'cancelled') return '已取消';
  if (serverJob.value?.status === 'succeeded') return '已成功';
  return '生成未成功 (Failed)';
});

const modelName = computed(() => {
  return serverJob.value?.model || props.msg?.modelKey || props.msg?.model || props.msg?.retryModel || '';
});

const modalityLabel = computed(() => {
  const m = serverJob.value?.modality || props.msg?.modality || 'video';
  if (m === 'video' || m === 'text_to_video') return '视频生成 (Video)';
  if (m === 'image' || m === 'text_to_image') return '图像生成 (Image)';
  if (m === 'music' || m === 'audio') return '音乐/音频 (Audio)';
  return m;
});

const timestamps = computed(() => {
  const s = serverJob.value || {};
  const m = props.msg || {};
  const r = m.rawError || {};
  const timing = r.timing || {};

  const createdAt = s.created_at || timing.createdAt || m.startTime || m.created_at || null;
  const startedAt = s.started_at || timing.startedAt || createdAt;
  const completedAt = s.completed_at || timing.completedAt || m.updated_at || null;

  return { createdAt, startedAt, completedAt };
});

const formattedDuration = computed(() => {
  const s = serverJob.value;
  const durationMs = s?.duration_ms
    || (timestamps.value.completedAt && timestamps.value.startedAt
      ? timestamps.value.completedAt - timestamps.value.startedAt
      : null);

  if (durationMs == null || durationMs <= 0) {
    if (s?.duration_sec) return `${s.duration_sec} 秒`;
    return '未获取到精确耗时';
  }

  const sec = Math.round(durationMs / 1000);
  if (sec < 60) return `${sec} 秒 (${(durationMs / 1000).toFixed(1)}s)`;
  const m = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${m} 分 ${remSec} 秒 (共 ${sec}s)`;
});

const stageTiming = computed(() => {
  const t = serverJob.value?.result?.timing;
  if (!t || typeof t !== 'object' || t.totalMs == null) return null;
  return t;
});

const stageTimingDetail = computed(() => {
  const t = stageTiming.value;
  if (!t) return '';
  const parts = [];
  const w = t.wan;
  if (w && (w.submitMs != null || w.downloadMs != null)) {
    const seg = [];
    if (w.prepareMs != null) seg.push(`参考图准备 ${formatStageMs(w.prepareMs)}`);
    if (w.submitMs != null) seg.push(`任务提交 ${formatStageMs(w.submitMs)}`);
    if (w.pollCount != null) seg.push(`轮询 ${w.pollCount} 次`);
    if (w.pollDetectMs != null) seg.push(`发现延迟 ${formatStageMs(w.pollDetectMs)}`);
    if (w.downloadMs != null) seg.push(`原片下载 ${formatStageMs(w.downloadMs)}`);
    if (seg.length) parts.push(`万相：${seg.join(' / ')}`);
  }
  if (t.sr) {
    const s = t.sr;
    const seg = [];
    if (s.uploadMs != null) seg.push(`上传 ${formatStageMs(s.uploadMs)}`);
    if (s.processingMs != null) seg.push(`云端处理 ${formatStageMs(s.processingMs)}`);
    if (s.downloadMs != null) seg.push(`成片下载 ${formatStageMs(s.downloadMs)}`);
    if (seg.length) parts.push(`超分：${seg.join(' / ')}`);
  }
  return parts.join('　');
});

function formatStageMs(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  const sec = Number(ms) / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${m}m${String(rem).padStart(2, '0')}s`;
}

const rawErrorMessage = computed(() => {
  const sErr = serverJob.value?.error;
  if (sErr && typeof sErr === 'object') {
    return sErr.message || sErr.error || JSON.stringify(sErr);
  }
  if (props.msg?.rawError?.message) return props.msg.rawError.message;
  return String(props.msg?.content || '未知错误').replace(/^生成遇到问题[:：]\s*/, '').trim();
});

const errorCode = computed(() => {
  const sErr = serverJob.value?.error;
  if (sErr && typeof sErr === 'object') {
    return sErr.code || sErr.status || sErr.upstreamStatus || null;
  }
  return props.msg?.rawError?.code || null;
});

const diagnosticGuide = computed(() => {
  const text = `${rawErrorMessage.value} ${errorCode.value || ''}`.toLowerCase();
  if (/terminated|moov atom|premature close/i.test(text)) {
    return '【产物下载中断 (TypeError: terminated)】：该任务在云端大模型上已完成渲染计算，但在从云端向服务器下载高码率 MP4（数十 MB）时，因网络抖动或代理通道断开导致数据流提前终止。系统现已配置直连国内加速与 3 次断点重试加固。建议稍后重试一次。';
  }
  if (/aborted due to timeout|timeout|timed out|超时/i.test(text)) {
    return '【本地等待超时 (TimeoutError)】：任务在等待网络传输或下载产物阶段达到等待上限。云端算力在高峰期渲染长视频（如 15 秒高清）耗时较长，或国内大文件拉取受到代理限速。已自动增大等待宽限；上游若已生成完可重新拉取。';
  }
  if (/429|busy|rate limit|限流|繁忙/i.test(text)) {
    return '【上游通道限流 (429 Too Many Requests)】：服务商接口并发或队列已满，请求未被扣费。系统已配置退避重试，稍等 1~2 分钟再点重试即可。';
  }
  if (/401|403|unauthorized|forbidden|api.?key/i.test(text)) {
    return '【鉴权认证失败 (401/403)】：模型通道 API Key 失效、余额不足或未配置。请前往「设置 → 运行时配置」检查对应厂商凭据。';
  }
  return '【常规生成异常】：请查看下方完整日志数据，确认提示词格式、分辨率参数与参考图公网地址是否合规。';
});

const requestParamsSummary = computed(() => {
  const p = serverJob.value?.payload || props.msg?.retryParams || props.msg?.params || {};
  const parts = [];
  if (p.model) parts.push(`模型: ${p.model}`);
  if (p.duration) parts.push(`时长: ${p.duration}s`);
  if (p.resolution || p.size) parts.push(`分辨率: ${p.resolution || p.size}`);
  if (p.ratio) parts.push(`画幅: ${p.ratio}`);
  if (Array.isArray(p.imageUrls) && p.imageUrls.length) parts.push(`参考图: ${p.imageUrls.length} 张`);
  if (p.genMode || p.mode) parts.push(`模式: ${p.genMode || p.mode}`);
  return parts.length ? parts.join(' ｜ ') : '';
});

const formattedFullJson = computed(() => {
  const data = {
    jobId: resolvedJobId.value,
    status: serverJob.value?.status || (props.msg?.isError ? 'failed' : 'unknown'),
    model: modelName.value,
    modality: modalityLabel.value,
    timestamps: timestamps.value,
    duration: formattedDuration.value,
    error: {
      message: rawErrorMessage.value,
      code: errorCode.value,
      upstreamStatus: serverJob.value?.error?.upstreamStatus || props.msg?.rawError?.upstreamStatus || null,
      requestId: serverJob.value?.error?.requestId || props.msg?.rawError?.requestId || null,
      stack: serverJob.value?.error?.stack || props.msg?.rawError?.stack || null,
    },
    serverJob: serverJob.value || undefined,
    messageContext: {
      id: props.msg?.id,
      role: props.msg?.role,
      userPrompt: props.msg?.userPrompt || props.msg?.retryPrompt || undefined,
      params: props.msg?.params || props.msg?.retryParams || undefined,
      refs: props.msg?.refs || props.msg?.retryRefs || undefined,
    }
  };
  return JSON.stringify(data, null, 2);
});

function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  const Y = d.getFullYear();
  const M = pad(d.getMonth() + 1);
  const D = pad(d.getDate());
  const h = pad(d.getHours());
  const m = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

async function copyText(text, label = '内容') {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(String(text));
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch (_) {}
}

function copyFullLog() {
  copyText(formattedFullJson.value, '完整日志');
}

watch(
  () => [props.visible, props.msg],
  async ([vis, msg]) => {
    if (!vis) {
      serverJob.value = null;
      return;
    }
    const jobId = msg?.jobId || (msg?.id && msg.id.startsWith('genmsg_') ? msg.id.replace('genmsg_', '') : '');
    if (jobId) {
      loading.value = true;
      try {
        const res = await fetchGenJob(jobId);
        if (res && res.job) {
          serverJob.value = res.job;
        }
      } catch (e) {
        console.warn('拉取任务诊断信息失败:', e.message);
      } finally {
        loading.value = false;
      }
    }
  },
  { immediate: true }
);
</script>
