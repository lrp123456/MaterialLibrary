<template>
  <!-- 全局语音输入：右侧悬浮麦克风，识别结果写回「最后聚焦的输入框」 -->
  <div class="voice-input-root">
    <!-- 实时字幕 / 结果面板 -->
    <transition name="voice-panel">
      <div
        v-if="panelOpen"
        class="voice-panel"
        :class="themeClass"
      >
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2 text-[13px] font-bold">
            <span class="w-2 h-2 rounded-full" :class="dotClass"></span>
            <span>{{ statusText }}</span>
          </div>
          <button
            class="text-[11px] px-2 py-0.5 rounded border border-studio-700 text-slate-300 hover:text-white"
            @click="closePanel"
          >收起</button>
        </div>

        <div class="voice-text">
          <template v-if="liveText">{{ liveText }}</template>
          <span v-else class="text-slate-400">{{ placeholder }}</span>
        </div>

        <div class="flex items-center justify-between gap-2 mt-3">
          <span class="text-[11px] text-slate-400 font-mono">
            {{ metaText }}
          </span>
          <div class="flex items-center gap-2">
            <button
              v-if="liveText && !recording"
              class="px-3 py-1.5 rounded-lg bg-studio-accent text-white text-[12px] font-bold"
              @click="commitText(liveText)"
            >插入</button>
            <button
              v-if="recording"
              class="px-3 py-1.5 rounded-lg bg-rose-500 text-white text-[12px] font-bold"
              @click="stop"
            >停止并插入</button>
            <button
              v-else
              class="px-3 py-1.5 rounded-lg border border-studio-700 text-[12px] font-bold text-slate-300 hover:text-white"
              @click="start"
            >{{ liveText ? '重录' : '开始' }}</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- 麦克风按钮 -->
    <button
      class="voice-fab"
      :class="{ 'is-recording': recording, 'is-error': !!error }"
      :title="recording ? '停止录音' : '语音输入（自动转文字）'"
      @click="toggle"
    >
      <span v-if="recording" class="voice-ring"></span>
      <StudioIcon name="mic" :size="20" class="relative z-10" />
    </button>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import StudioIcon from './StudioIcon.vue';
import { getToken, getCurrentUser } from '../api.js';

const recording = ref(false);
const panelOpen = ref(false);
const connecting = ref(false);
const error = ref('');
const partial = ref('');
const committed = ref('');
const finalText = ref('');
const latency = ref(0);
const asrReady = ref(false);
const asrModel = ref('');

let ws = null;
let audioCtx = null;
let mediaStream = null;
let processor = null;
let sink = null;
let pendingSamples = [];
let pendingLen = 0;
let lastEditable = null;
let finalResolver = null;

const liveText = computed(() => (recording.value ? `${committed.value}${partial.value}` : (finalText.value || committed.value)).trim());
const placeholder = computed(() => (asrReady.value ? '点右侧麦克风开始说话…' : error.value || '正在检测语音服务…'));

const statusText = computed(() => {
  if (error.value) return '语音服务不可用';
  if (connecting.value) return '连接中…';
  if (recording.value) return '正在聆听';
  if (finalText.value) return '识别完成';
  return asrReady.value ? '语音输入就绪' : '检测中…';
});
const dotClass = computed(() => {
  if (error.value) return 'bg-rose-500';
  if (recording.value) return 'bg-emerald-400 animate-pulse';
  return asrReady.value ? 'bg-studio-accent' : 'bg-amber-400 animate-pulse';
});
const metaText = computed(() => {
  if (error.value) return error.value;
  const bits = [];
  if (asrModel.value) bits.push(asrModel.value.replace('sherpa-onnx-sense-voice-', 'SenseVoice '));
  if (latency.value) bits.push(`${latency.value}ms`);
  bits.push('FunASR · 本地');
  return bits.join(' · ');
});
// 亮色/护眼主题下用浅底深字，避免悬浮面板在浅色界面里糊成一团
const themeClass = computed(() => 'bg-studio-900 text-slate-100 border-studio-700');

function isEditable(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return !el.disabled && !el.readOnly;
  if (tag === 'input') {
    const t = (el.type || 'text').toLowerCase();
    return ['text', 'search', 'url', 'tel', 'email', 'password', 'number', ''].includes(t) && !el.disabled && !el.readOnly;
  }
  return el.isContentEditable === true;
}

function rememberFocus(e) {
  if (isEditable(e.target) && !e.target.closest('.voice-input-root')) lastEditable = e.target;
}

/** 把识别结果写回最后聚焦的输入框，并触发 input 让 Vue 的 v-model 同步 */
function insertIntoFocused(text) {
  const el = lastEditable;
  if (!el || !document.contains(el)) return false;
  try { el.focus(); } catch (_) {}
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    const proto = tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const start = el.selectionStart == null ? el.value.length : el.selectionStart;
    const end = el.selectionEnd == null ? el.value.length : el.selectionEnd;
    const next = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`;
    if (setter) setter.call(el, next); else el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const pos = start + text.length;
    try { el.setSelectionRange(pos, pos); } catch (_) {}
    return true;
  }
  if (el.isContentEditable) {
    try { document.execCommand('insertText', false, text); } catch (_) {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  return false;
}

function commitText(text) {
  const t = String(text || '').trim();
  if (!t) return;
  const ok = insertIntoFocused(t);
  if (!ok) {
    navigator.clipboard?.writeText(t).catch(() => {});
    error.value = '未找到输入框，已复制到剪贴板';
    setTimeout(() => { error.value = ''; }, 2500);
  }
  closePanel();
}

function closePanel() {
  if (recording.value) return;
  panelOpen.value = false;
  partial.value = '';
  committed.value = '';
  finalText.value = '';
}

async function refreshStatus() {
  try {
    const res = await fetch('/api/asr/status', { headers: { Authorization: `Bearer ${getToken()}` } });
    const j = await res.json();
    asrReady.value = !!j.ready;
    asrModel.value = j.model || '';
    if (!j.ready) error.value = j.hint || j.error || '语音服务未启动';
    else error.value = '';
  } catch (e) {
    asrReady.value = false;
    error.value = '语音服务探测失败';
  }
}

function connectWs() {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/api/asr/stream?token=${encodeURIComponent(getToken())}`;
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      try { socket.close(); } catch (_) {}
      reject(new Error('语音通道连接超时'));
    }, 5000);
    socket.onopen = () => {
      clearTimeout(timer);
      socket.send(JSON.stringify({ type: 'start' }));
      resolve(socket);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error('语音通道不可用'));
    };
    socket.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type === 'partial') {
        partial.value = msg.text || '';
      } else if (msg.type === 'commit') {
        committed.value = msg.full || `${committed.value}${msg.text || ''}`;
        partial.value = '';
        if (msg.elapsedMs) latency.value = msg.elapsedMs;
      } else if (msg.type === 'final') {
        finalText.value = msg.text || `${committed.value}${partial.value}`;
        committed.value = msg.text || committed.value;
        partial.value = '';
        if (msg.elapsedMs) latency.value = msg.elapsedMs;
        if (finalResolver) { finalResolver(finalText.value); finalResolver = null; }
      } else if (msg.type === 'error') {
        error.value = msg.message || '识别失败';
        if (finalResolver) { finalResolver(''); finalResolver = null; }
      }
    };
    socket.onclose = () => {
      recording.value = false;
      stopAudio();
    };
  });
}

async function startAudio() {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const source = audioCtx.createMediaStreamSource(mediaStream);
  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  sink = audioCtx.createGain();
  sink.gain.value = 0;
  pendingSamples = [];
  pendingLen = 0;
  processor.onaudioprocess = (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const rawInput = e.inputBuffer.getChannelData(0);
    // 部分浏览器不接受 16k 采样率，AudioContext 会退回 44.1k/48k，
    // 这里按实际采样率做一次线性重采样，保证送给 ASR 的永远是 16k。
    let samples = rawInput;
    const ratio = (audioCtx?.sampleRate || 16000) / 16000;
    if (Math.abs(ratio - 1) > 0.01) {
      const n = Math.max(1, Math.floor(rawInput.length / ratio));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const a = rawInput[i0] || 0;
        const b = rawInput[Math.min(i0 + 1, rawInput.length - 1)] || a;
        out[i] = a * (1 - frac) + b * frac;
      }
      samples = out;
    }
    const i16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    pendingSamples.push(i16);
    pendingLen += i16.length;
    // 200ms 一包：16k * 0.2 = 3200 采样，减少 WS 消息数
    if (pendingLen >= 3200) {
      const merged = new Int16Array(pendingLen);
      let off = 0;
      for (const part of pendingSamples) { merged.set(part, off); off += part.length; }
      pendingSamples = [];
      pendingLen = 0;
      ws.send(merged.buffer);
    }
  };
  source.connect(processor);
  processor.connect(sink);
  sink.connect(audioCtx.destination);
}

function stopAudio() {
  try { processor && processor.disconnect(); } catch (_) {}
  try { sink && sink.disconnect(); } catch (_) {}
  try { mediaStream && mediaStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  try { audioCtx && audioCtx.close(); } catch (_) {}
  processor = null;
  sink = null;
  mediaStream = null;
  audioCtx = null;
  pendingSamples = [];
  pendingLen = 0;
}

async function start() {
  panelOpen.value = true;
  error.value = '';
  finalText.value = '';
  committed.value = '';
  partial.value = '';
  if (!getCurrentUser()) {
    error.value = '请先登录后再使用语音输入';
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    error.value = '当前浏览器不支持麦克风采集';
    return;
  }
  connecting.value = true;
  try {
    ws = await connectWs();
    await startAudio();
    recording.value = true;
    connecting.value = false;
  } catch (e) {
    connecting.value = false;
    recording.value = false;
    error.value = e.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在地址栏允许后重试' : e.message;
    try { ws && ws.close(); } catch (_) {}
    ws = null;
    stopAudio();
  }
}

function stop() {
  if (!recording.value) return;
  recording.value = false;
  // 先停采集，再把最后不到 200ms 的尾巴送出去，然后让服务端收尾
  try {
    if (pendingLen > 0 && ws && ws.readyState === WebSocket.OPEN) {
      const merged = new Int16Array(pendingLen);
      let off = 0;
      for (const part of pendingSamples) { merged.set(part, off); off += part.length; }
      ws.send(merged.buffer);
      pendingSamples = [];
      pendingLen = 0;
    }
  } catch (_) {}
  stopAudio();
  const socket = ws;
  if (!socket) return;
  new Promise((resolve) => {
    finalResolver = resolve;
    setTimeout(() => { if (finalResolver) { finalResolver(committed.value || partial.value); finalResolver = null; } }, 6000);
    try { socket.send(JSON.stringify({ type: 'end' })); } catch (_) { resolve(''); }
  }).then((text) => {
    try { socket.close(); } catch (_) {}
    ws = null;
    const t = String(text || committed.value || partial.value || '').trim();
    if (t) commitText(t);
    else if (!error.value) error.value = '没有识别到内容，请靠近麦克风再说一次';
  });
}

function toggle() {
  if (recording.value) stop();
  else start();
}

onMounted(() => {
  document.addEventListener('focusin', rememberFocus, true);
  refreshStatus();
  setInterval(refreshStatus, 30000);
});
onBeforeUnmount(() => {
  document.removeEventListener('focusin', rememberFocus, true);
  try { ws && ws.close(); } catch (_) {}
  stopAudio();
});
</script>

<style scoped>
.voice-input-root {
  position: fixed;
  right: 14px;
  top: 46%;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 10px;
}
.voice-fab {
  position: relative;
  width: 46px;
  height: 46px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgb(var(--studio-accent-rgb, 99 102 241));
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.28);
  border: 1px solid rgb(255 255 255 / 0.18);
  cursor: pointer;
  transition: transform 0.15s ease, background 0.2s ease;
}
.voice-fab:hover { transform: scale(1.06); }
.voice-fab.is-recording { background: #e11d48; }
.voice-fab.is-error { background: #64748b; }
.voice-ring {
  position: absolute;
  inset: -6px;
  border-radius: 9999px;
  border: 2px solid rgb(225 29 72 / 0.55);
  animation: voice-pulse 1.4s ease-out infinite;
}
@keyframes voice-pulse {
  0% { transform: scale(0.9); opacity: 0.9; }
  100% { transform: scale(1.35); opacity: 0; }
}
.voice-panel {
  width: 320px;
  padding: 12px 14px;
  border-radius: 14px;
  border-width: 1px;
  border-style: solid;
  box-shadow: 0 18px 48px rgb(0 0 0 / 0.35);
  backdrop-filter: blur(6px);
}
.voice-text {
  min-height: 46px;
  max-height: 140px;
  overflow-y: auto;
  font-size: 13.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.voice-panel-enter-active, .voice-panel-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.voice-panel-enter-from, .voice-panel-leave-to { opacity: 0; transform: translateX(12px); }
</style>
