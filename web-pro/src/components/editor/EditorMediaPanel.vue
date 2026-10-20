<template>
  <aside class="w-80 bg-studio-900 border-r border-studio-750/80 flex flex-col shrink-0 overflow-hidden">
    <div class="h-10 bg-studio-950 border-b border-studio-800 flex items-center px-1.5 gap-0.5 shrink-0 overflow-x-auto">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="px-2 py-1 rounded text-[11px] font-medium shrink-0 whitespace-nowrap cursor-pointer"
        :class="state.selectedMediaTab === tab.key ? 'bg-studio-accent text-white font-bold shadow' : 'text-slate-400 hover:text-slate-200'"
        @click="state.selectedMediaTab = tab.key"
      >{{ tab.label }}</button>
    </div>

    <div class="flex-1 overflow-y-auto p-2.5 custom-scroll">
      <!-- 素材池 -->
      <template v-if="state.selectedMediaTab === 'media'">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] font-bold text-slate-300">工程素材池 ({{ mediaItems.length }})</span>
        </div>
        <p class="text-[10px] text-slate-500 mb-2">这里是素材库里的成片和原片。点一下加入轨道。缺文件的条目不能当片源。</p>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="item in mediaItems"
            :key="item.id"
            class="group relative rounded-xl overflow-hidden border border-studio-750 hover:border-studio-accent bg-studio-950 aspect-[16/10] cursor-pointer transition-all text-left"
            :title="`${item.name} · ${item.type} · ${(item.duration || 0).toFixed(2)}s`"
            @click="addMediaClip(item)"
          >
            <img v-if="item.type === 'image' && item.url" :src="mediaSrc(item)" class="w-full h-full object-cover" />
            <div v-else-if="item.missing" class="w-full h-full flex items-center justify-center text-[11px] text-rose-300">缺片源</div>
            <div v-else class="w-full h-full flex items-center justify-center text-3xl text-slate-500">
              {{ item.type === 'video' ? '🎞' : '🎵' }}
            </div>
            <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent flex flex-col justify-end p-1.5">
              <span class="text-[10px] font-medium text-slate-100 truncate">{{ item.name }}</span>
              <span class="text-[9px] text-studio-cyan font-mono">{{ item.type }} · {{ (item.duration || 5).toFixed(1) }}s</span>
            </div>
            <div class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-studio-accent text-white px-1 py-0.5 rounded text-[9px] font-bold">加入</div>
          </button>
        </div>
        <div v-if="!mediaItems.length" class="text-xs text-slate-500 mt-6 text-center">素材库里还没有可上轨的图片、视频或音频。</div>
      </template>

      <!-- 文字 -->
      <template v-else-if="state.selectedMediaTab === 'text'">
        <div class="space-y-2">
          <button class="preset-card" @click="addTextClip('室内空间漫游', { name: '大标题', fontSize: 64, color: '#ffffff', fontWeight: 800, y: -26 })">
            <span class="text-lg font-extrabold">室内空间漫游</span><span class="text-[10px] text-slate-400">大标题 · 64px</span>
          </button>
          <button class="preset-card" @click="addTextClip('自然采光 · 材质 · 动线', { name: '副标题', fontSize: 34, color: '#a5f3fc', fontWeight: 600 })">
            <span class="text-sm font-bold text-cyan-300">自然采光 · 材质 · 动线</span><span class="text-[10px] text-slate-400">副标题 · 34px</span>
          </button>
          <button class="preset-card" @click="addTextClip('双击右侧检查器修改文字', { name: '字幕', fontSize: 30, color: '#ffffff', fontWeight: 600, y: 36 })">
            <span class="text-sm">双击检查器修改文字</span><span class="text-[10px] text-slate-400">字幕 · 30px</span>
          </button>
        </div>
      </template>

      <!-- 贴纸 -->
      <template v-else-if="state.selectedMediaTab === 'sticker'">
        <p class="text-[10px] text-slate-500 mb-2">点击贴纸加入图形轨，可在检查器调整位置/缩放/旋转。</p>
        <div class="grid grid-cols-4 gap-2">
          <button v-for="s in stickers" :key="s" class="aspect-square rounded-xl border border-studio-750 bg-studio-950 hover:border-studio-accent text-2xl flex items-center justify-center cursor-pointer" @click="addStickerClip(s)">{{ s }}</button>
        </div>
      </template>

      <!-- 图形 -->
      <template v-else-if="state.selectedMediaTab === 'graphic'">
        <p class="text-[10px] text-slate-500 mb-2">矢量图形加入图形轨，可加遮罩与关键帧。</p>
        <div class="grid grid-cols-2 gap-2">
          <button v-for="g in graphics" :key="g.kind" class="rounded-xl border border-studio-750 bg-studio-950 hover:border-studio-accent p-3 cursor-pointer flex flex-col items-center gap-1" @click="addGraphicClip(g.kind)">
            <span class="text-2xl text-cyan-300">{{ g.icon }}</span>
            <span class="text-[11px] text-slate-300">{{ g.label }}</span>
          </button>
        </div>
      </template>

      <!-- 效果 -->
      <template v-else-if="state.selectedMediaTab === 'effect'">
        <p class="text-[10px] text-slate-500 mb-2">效果片段加入效果轨，覆盖时段内对整幅合成画面生效。</p>
        <button class="w-full rounded-xl border border-studio-750 bg-studio-950 hover:border-studio-accent p-3 text-left cursor-pointer" @click="addEffectClip(9)">
          <div class="text-sm font-bold text-cyan-300">模糊 Blur</div>
          <div class="text-[10px] text-slate-400 mt-1">可调 0–40px，时段覆盖全轨合成画面。</div>
        </button>
        <button class="w-full rounded-xl border border-studio-750 bg-studio-950 hover:border-studio-accent p-3 text-left cursor-pointer mt-2" @click="addEffectClip(20)">
          <div class="text-sm font-bold text-cyan-300">强模糊 Blur Strong</div>
          <div class="text-[10px] text-slate-400 mt-1">20px 起始强度。</div>
        </button>
      </template>

      <!-- 音频 -->
      <template v-else-if="state.selectedMediaTab === 'audio'">
        <p class="text-[10px] text-slate-500 mb-2">音频素材加入音频轨；视频素材可先加入视频轨再右键“分离音频”。</p>
        <div class="space-y-2">
          <button
            v-for="item in audioItems"
            :key="item.id"
            class="w-full rounded-xl border border-studio-750 bg-studio-950 hover:border-emerald-500 p-2.5 text-left cursor-pointer flex items-center justify-between gap-2"
            @click="addAudioClip(item)"
          >
            <div class="min-w-0">
              <div class="text-xs font-bold text-emerald-300 truncate">♪ {{ item.name }}</div>
              <div class="text-[10px] text-slate-400 font-mono">{{ item.type }} · {{ (item.duration || 0).toFixed(2) }}s</div>
            </div>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 shrink-0">加入音频轨</span>
          </button>
        </div>
      </template>
    </div>
  </aside>
</template>

<script setup>
import { computed, ref } from 'vue';
import {
  addAudioClip, addEffectClip, addGraphicClip, addMediaClip, addStickerClip,
  addTextClip, state, uploadMediaFile, notify,
} from '../../editor/store.js';

const tabs = [
  { key: 'media', label: '素材池' },
  { key: 'text', label: '文字' },
  { key: 'sticker', label: '贴纸' },
  { key: 'graphic', label: '图形' },
  { key: 'effect', label: '效果' },
  { key: 'audio', label: '音频' },
];
const stickers = ['⭐', '❤️', '✦', '🌿', '💡', '🏠', '🪑', '🪴', '🖼', '☀️', '🎯', '💎'];
const graphics = [
  { kind: 'ring', label: '圆环', icon: '◎' },
  { kind: 'circle', label: '圆形', icon: '●' },
  { kind: 'triangle', label: '三角', icon: '▲' },
  { kind: 'bar', label: '线条', icon: '▬' },
];
const fileInput = ref(null);
const mediaItems = computed(() => state.serverMedia);
const audioItems = computed(() => state.serverMedia.filter((m) => m.type === 'audio' || (m.type === 'video' && m.hasAudio)));

function mediaSrc(item) {
  const url = item?.url || '';
  if (!url || url.includes('token=')) return url;
  let token = '';
  try { token = localStorage.getItem('ml_token') || ''; } catch { token = ''; }
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}
function triggerUpload() { fileInput.value?.click(); }
async function onFiles(e) {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    try {
      await uploadMediaFile(f);
      notify(`已导入 ${f.name}`, 'ok');
    } catch (err) {
      notify(`导入失败：${err.message}`, 'error');
    }
  }
  e.target.value = '';
}
</script>

<style scoped>
.preset-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid var(--theme-border);
  background: var(--theme-bg-subtle);
  cursor: pointer;
}
.preset-card:hover { border-color: var(--theme-accent-primary); }
.custom-scroll::-webkit-scrollbar { width: 7px; }
</style>
