<template>
  <canvas ref="canvasRef" class="editor-waveform" />
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getAudioBuffer } from '../../editor/compositor.js';

const props = defineProps({
  audioUrl: { type: String, default: '' },
  trimStart: { type: Number, default: 0 },
  duration: { type: Number, default: 1 },
  speed: { type: Number, default: 1 },
  volume: { type: Number, default: 100 },
  fadeIn: { type: Number, default: 0 },
  fadeOut: { type: Number, default: 0 },
  color: { type: String, default: '#34d399' },
});

const canvasRef = ref(null);
let observer = null;
let raf = null;
let buffer = null;
let loading = false;

async function load() {
  if (!props.audioUrl || loading) return;
  loading = true;
  buffer = await getAudioBuffer(props.audioUrl);
  loading = false;
  draw();
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const parentW = Math.max(40, Math.round(canvas.parentElement?.clientWidth || 120));
  const parentH = Math.max(16, Math.round(canvas.parentElement?.clientHeight || 28));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== parentW * dpr || canvas.height !== parentH * dpr) {
    canvas.width = parentW * dpr;
    canvas.height = parentH * dpr;
    canvas.style.width = `${parentW}px`;
    canvas.style.height = `${parentH}px`;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, parentW, parentH);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, parentH / 2);
  ctx.lineTo(parentW, parentH / 2);
  ctx.stroke();

  if (!buffer) return;
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const sourceStart = Math.max(0, props.trimStart) * sampleRate;
  const sourceSpan = Math.max(0.001, props.duration * Math.max(0.01, props.speed)) * sampleRate;
  const samplesPerPx = Math.max(1, sourceSpan / parentW);
  const amp = (parentH / 2 - 2) * Math.max(0.05, Math.min(1.5, (props.volume == null ? 100 : props.volume) / 100));
  ctx.fillStyle = props.color;
  for (let x = 0; x < parentW; x += 1) {
    const start = Math.floor(sourceStart + x * samplesPerPx);
    const end = Math.min(data.length, Math.floor(start + samplesPerPx));
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i += 1) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const top = parentH / 2 - max * amp;
    const bottom = parentH / 2 - min * amp;
    ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
  }

  // 音量/淡入淡出包络线
  const total = Math.max(0.001, props.duration);
  const fin = Math.max(0, props.fadeIn || 0);
  const fout = Math.max(0, props.fadeOut || 0);
  if (fin > 0 || fout > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(0, parentH - 2);
    if (fin > 0) ctx.lineTo((fin / total) * parentW, 2);
    else ctx.lineTo(0, 2);
    const outX = fout > 0 ? ((total - fout) / total) * parentW : parentW;
    ctx.lineTo(outX, 2);
    ctx.lineTo(parentW, parentH - 2);
    ctx.stroke();
  }
}

function scheduleDraw() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = null; draw(); });
}

onMounted(() => {
  observer = new ResizeObserver(scheduleDraw);
  if (canvasRef.value?.parentElement) observer.observe(canvasRef.value.parentElement);
  load();
  draw();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  if (raf) cancelAnimationFrame(raf);
});

watch(() => [props.audioUrl, props.trimStart, props.duration, props.speed, props.volume, props.fadeIn, props.fadeOut], () => {
  load();
  scheduleDraw();
}, { deep: true });
</script>

<style scoped>
.editor-waveform {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  border-radius: inherit;
}
</style>
